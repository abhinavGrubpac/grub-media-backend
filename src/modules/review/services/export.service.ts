import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildCreativeWhere } from './review.service';

/** One row of the version history block in the export document. */
export interface CreativeExportVersionRow {
  id: string;
  version_number: number;
  media_url: string;
  media_type: string;
  media_name: string | null;
  file_size_bytes: number | null;
  status: string;
  uploaded_on: Date | null;
  uploaded_by: string | null;
  last_action: string | null;
  last_action_by: string | null;
  last_action_at: Date | null;
  comments: string | null;
  reason: string | null;
}

/**
 * Full projection used by the export document (PDF) and the CSV fallback.
 * Mirrors the fields the product asked for: thumbnail, creative id, industry,
 * media name, agency, location, uploaded on, last action by, approval status
 * plus the complete version history.
 */
export interface CreativeExportRow {
  id: string;
  creative_name: string;
  industry: string | null;
  brand_name: string;
  media_name: string | null;
  agency_name: string | null;
  location: string | null;
  uploaded_on: Date | null;
  last_action_by: string | null;
  last_action_at: Date | null;
  approval_status: string;
  thumbnail_url: string | null;
  versions: CreativeExportVersionRow[];
}

export interface CreativeExportFilters {
  status?: string;
  brand_id?: string;
  industry?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  actor_id?: string;
  ids?: string[];
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCreatives(filters: CreativeExportFilters): Promise<CreativeExportRow[]> {
    const status = normalizeCreativeStatusFilter(filters.status);
    const currentVersionIds = status
      ? await currentVersionIdsForStatus(this.prisma, status)
      : undefined;
    const where = buildCreativeWhere(filters, status ? { currentVersionIds } : {});
    const creatives = await this.prisma.client.creative.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        brand: true,
        versions: {
          // Newest first: the first row is the current version.
          orderBy: { versionNumber: 'desc' },
          include: { actions: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (creatives.length === 0) return [];

    const creativeIds = creatives.map((creative) => creative.id);
    const [agencies, geo] = await Promise.all([
      this.fetchAgencies(
        creatives.map((creative) => creative.upstreamAgencyId ?? creative.brand.upstreamAgencyId),
      ),
      this.fetchCreativeGeo(creativeIds),
    ]);

    const actorIds = new Set<string>();
    for (const creative of creatives) {
      for (const version of creative.versions) {
        if (version.createdBy) actorIds.add(version.createdBy);
        for (const action of version.actions) actorIds.add(action.actorId);
      }
    }
    const actorNames = await this.resolveActorNames([...actorIds]);

    return creatives.map((creative) => {
      const versions = creative.versions;
      const currentVersion =
        versions.find((version) => version.id === creative.currentVersionId) ?? versions[0];
      const latestAction = this.latestAction(versions);
      const agency =
        agencies.get(creative.upstreamAgencyId ?? creative.brand.upstreamAgencyId ?? '') ?? null;
      const location = geo.get(creative.id) ?? creative.brand.address ?? null;

      return {
        id: creative.id,
        creative_name: creative.creativeName,
        industry: creative.brand.industryCategory ?? null,
        brand_name: creative.brand.brandName,
        media_name: currentVersion?.mediaName ?? null,
        agency_name: agency?.agencyName ?? null,
        location,
        uploaded_on: currentVersion?.createdAt ?? null,
        last_action_by: latestAction ? (actorNames.get(latestAction.actorId) ?? null) : null,
        last_action_at: latestAction?.createdAt ?? null,
        approval_status: currentVersion?.status ?? 'NO_VERSION',
        thumbnail_url: currentVersion?.mediaUrl ?? null,
        versions: versions.map((version) => {
          const latest = this.latestAction([version]);
          return {
            id: version.id,
            version_number: version.versionNumber,
            media_url: version.mediaUrl,
            media_type: version.mediaType,
            media_name: version.mediaName ?? null,
            file_size_bytes: version.fileSizeBytes ?? null,
            status: version.status,
            uploaded_on: version.createdAt,
            uploaded_by: actorNames.get(version.createdBy) ?? version.createdBy ?? null,
            last_action: latest?.action ?? null,
            last_action_by: latest ? (actorNames.get(latest.actorId) ?? null) : null,
            last_action_at: latest?.createdAt ?? null,
            comments: latest?.comments ?? null,
            reason: latest?.reason ?? null,
          };
        }),
      };
    });
  }

  /** Newest review action across a creative's whole version thread. */
  private latestAction(
    versions: Array<{
      actions: Array<{
        actorId: string;
        createdAt: Date;
        action: string;
        comments: string | null;
        reason: string | null;
      }>;
    }>,
  ): {
    actorId: string;
    createdAt: Date;
    action: string;
    comments: string | null;
    reason: string | null;
  } | null {
    let latest: {
      actorId: string;
      createdAt: Date;
      action: string;
      comments: string | null;
      reason: string | null;
    } | null = null;
    for (const version of versions) {
      for (const action of version.actions) {
        if (!latest || action.createdAt.getTime() > latest.createdAt.getTime()) {
          latest = action;
        }
      }
    }
    return latest;
  }

  /** Batched agency lookup, keyed by upstream agency id. */
  private async fetchAgencies(upstreamIds: Array<string | null>) {
    const ids = [...new Set(upstreamIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.agencyRef.findMany({
      where: { upstreamAgencyId: { in: ids } },
    });
    return new Map(rows.map((row) => [row.upstreamAgencyId, row]));
  }

  /**
   * First hoarding address (falls back to city) per creative. Uses the same
   * relation the review list's Location column uses so the export matches
   * what the reviewer sees on screen.
   */
  private async fetchCreativeGeo(creativeIds: string[]): Promise<Map<string, string>> {
    if (creativeIds.length === 0) return new Map();
    const rows = await this.prisma.client.advert.findMany({
      where: { version: { is: { creativeId: { in: creativeIds } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        addressText: true,
        cityName: true,
        zoneName: true,
        version: { select: { creativeId: true } },
      },
    });
    const geo = new Map<string, { addresses: Set<string>; cities: Set<string> }>();
    for (const row of rows) {
      const creativeId = row.version.creativeId;
      const entry = geo.get(creativeId) ?? {
        addresses: new Set<string>(),
        cities: new Set<string>(),
      };
      const address = row.addressText?.trim();
      if (address) entry.addresses.add(address);
      const city = row.cityName?.trim();
      if (city) entry.cities.add(city);
      const zone = row.zoneName?.trim();
      if (zone) entry.cities.add(zone);
      geo.set(creativeId, entry);
    }
    return new Map(
      [...geo].map(([creativeId, entry]) => {
        const parts = entry.addresses.size > 0 ? [...entry.addresses] : [...entry.cities];
        return [creativeId, parts.slice(0, 3).join('; ')];
      }),
    );
  }

  private async resolveActorNames(actorIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(actorIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((user) => {
        const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        return [user.id, name || 'Unknown user'];
      }),
    );
  }
}

/** Prisma JSON helper kept exported for callers that build ad-hoc filters. */
export type ExportWhereInput = Prisma.CreativeWhereInput;
