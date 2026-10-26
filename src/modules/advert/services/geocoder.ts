import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';

/** Coordinates a search text resolved to (city centroids are stable). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Forward geocoding ("Nashik" -> coordinates) backing the city+radius search
 * in Advert Control. Industry-standard approach: delegate place resolution to
 * a dedicated geocoder (OpenStreetMap Nominatim, default) instead of guessing
 * centroids in code.
 *
 * Robustness contract, tuned for how it is consumed by advert search:
 * - Caches successes for 30 days and misses for 1 hour (Redis when the app has
 *   it, otherwise an in-process map), so repeated UI lookups never re-hit the
 *   provider.
 * - Spaces live requests at least ~1.1s apart to respect the Nominatim usage
 *   policy (max 1 request/second, identifiable User-Agent required).
 * - NEVER throws and never 500s the search: an unreachable provider or an
 *   unknown place resolves to null and the caller degrades gracefully
 *   (falls back to the plain text search).
 */
@Injectable()
export class Geocoder {
  private readonly logger = new Logger(Geocoder.name);

  /** Swappable in tests; defaults to the Node 18+ global fetch. */
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch;

  private readonly baseUrl =
    process.env.GEOCODE_BASE_URL?.trim() || 'https://nominatim.openstreetmap.org';
  private readonly userAgent =
    'grub-media-backend/1.0 (GrubPac media backend; contact: support@grubpac.com)';

  /** Successes are stable (city centroids): cache them for 30 days. */
  private static readonly HIT_TTL_SECONDS = 30 * 24 * 60 * 60;
  /** Misses (unknown place / transient provider outage): retry after an hour. */
  private static readonly MISS_TTL_SECONDS = 60 * 60;
  /** Nominatim usage policy: max 1 request per second. */
  private static readonly MIN_REQUEST_INTERVAL_MS = 1100;
  private static readonly TIMEOUT_MS = 5000;
  private static readonly MEMORY_CACHE_MAX = 2000;

  private readonly memory = new Map<string, GeoPoint | null>();
  private lastRequestAt = 0;

  constructor(@Optional() private readonly redis?: RedisService) {}

  /**
   * Resolves a place name to coordinates, or null when it cannot be resolved.
   * India-scoped (`countrycodes=in`) — every deployed site of this product is
   * in India and geo queries are Indian city names.
   */
  async geocodePlace(search: string): Promise<GeoPoint | null> {
    const name = search.trim();
    if (name.length === 0 || name.length > 200) return null;
    // Cache key is lowercased so 'Nashik' and 'nashik' share one entry; the
    // provider query keeps the user's original casing, which improves
    // place-name match quality.
    const cacheKey = `geocode:in:${name.toLowerCase()}`;

    const cached = await this.readCache(cacheKey);
    if (cached !== undefined) return cached;

    return this.resolveLive(name, cacheKey);
  }

  private validatePoint(raw: { lat: string | number; lon: string | number }): GeoPoint | null {
    const lat = typeof raw.lat === 'string' ? Number.parseFloat(raw.lat) : raw.lat;
    const lng = typeof raw.lon === 'string' ? Number.parseFloat(raw.lon) : raw.lon;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }
    return { lat, lng };
  }

  private async readCache(cacheKey: string): Promise<GeoPoint | null | undefined> {
    const fromMemory = this.memory.get(cacheKey);
    if (fromMemory !== undefined) return fromMemory;
    if (!this.redis?.isAvailable()) return undefined;
    const raw = await this.redis.get(cacheKey);
    if (raw === null) return undefined;
    if (raw === 'null') {
      this.memory.set(cacheKey, null);
      return null;
    }
    try {
      const point = JSON.parse(raw) as GeoPoint;
      if (
        point &&
        typeof point.lat === 'number' &&
        typeof point.lng === 'number' &&
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng)
      ) {
        this.memory.set(cacheKey, point);
        return point;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async resolveLive(name: string, cacheKey: string): Promise<GeoPoint | null> {
    await this.throttle();
    const url =
      `${this.baseUrl}/search?` +
      new URLSearchParams({
        q: name,
        format: 'json',
        limit: '1',
        countrycodes: 'in',
        accept_language: 'en',
      }).toString();
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(Geocoder.TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Geocoder ${this.baseUrl} responded ${response.status} for "${name}"`);
        return null; // Do not cache provider failure as a miss beyond the short TTL.
      }
      const body = (await response.json()) as Array<{ lat: string; lon: string }>;
      const hit = Array.isArray(body) && body.length > 0 ? this.validatePoint(body[0]) : null;
      this.putCache(cacheKey, hit, true);
      return hit;
    } catch (error) {
      this.logger.warn(`Geocoder unreachable for "${name}": ${String(error)}`);
      return null;
    }
  }

  /** Writes both tiers; provider outages are cached only briefly (miss TTL). */
  private async putCache(
    cacheKey: string,
    hit: GeoPoint | null,
    cacheable: boolean,
  ): Promise<void> {
    this.memory.set(cacheKey, hit);
    if (this.memory.size > Geocoder.MEMORY_CACHE_MAX) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    if (this.redis?.isAvailable() && cacheable) {
      await this.redis.set(
        cacheKey,
        hit === null ? 'null' : JSON.stringify(hit),
        hit === null ? Geocoder.MISS_TTL_SECONDS : Geocoder.HIT_TTL_SECONDS,
      );
    }
  }

  /**
   * Spaces live requests at least ~1.1s apart (Nominatim policy).
   * Cache hits never wait in this queue.
   */
  private async throttle(): Promise<void> {
    if (this.lastRequestAt === 0) {
      this.lastRequestAt = Date.now();
      return;
    }
    const waitMs = this.lastRequestAt + Geocoder.MIN_REQUEST_INTERVAL_MS - Date.now();
    this.lastRequestAt = Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
