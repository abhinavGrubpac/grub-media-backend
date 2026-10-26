import { Logger } from '@nestjs/common';
import { IMAGE_UPLOAD_MAX_BYTES, dHashFromImage } from './image-hash';

/** Network budget for fetching one creative image while indexing. */
export const IMAGE_HASH_FETCH_TIMEOUT_MS = 8_000;

/**
 * Hosts the API may fetch a creative image from. Media URLs are stored as
 * client/upstream input, so indexing is restricted to the configured media
 * bucket instead of becoming an arbitrary-URL fetch (SSRF).
 */
export function allowedImageHosts(bucket: string | undefined, region = 'ap-south-1'): string[] {
  if (!bucket) return [];
  return [`${bucket}.s3.${region}.amazonaws.com`, `${bucket}.s3.amazonaws.com`];
}

/**
 * Best-effort dHash for a creative media URL. Returns null when the URL is
 * outside the configured bucket, the object is unreachable/oversized, or the
 * bytes are not a decodable image. Callers must never fail a booking or a
 * review decision because indexing failed.
 */
export async function dHashFromImageUrl(
  mediaUrl: string | null | undefined,
  allowedHosts: string[],
  logger?: Logger,
): Promise<string | null> {
  if (!mediaUrl || allowedHosts.length === 0) return null;

  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_HASH_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (declaredLength > IMAGE_UPLOAD_MAX_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > IMAGE_UPLOAD_MAX_BYTES) return null;

    return await dHashFromImage(bytes);
  } catch (err) {
    logger?.warn(
      `Could not index creative image ${url.origin}${url.pathname}: ${(err as Error).message}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
