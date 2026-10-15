import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma, Brand } from '@prisma/client';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { EventOutboxService } from '../../events/event.outbox';
import { EventTypes } from '../../events/events.constants';
import { PrismaService } from '../../../database/prisma.service';
import { BRAND_SORT_KEYS, BrandQueryDto } from '../dto/brand-query.dto';
import { BrandResponseDto } from '../dto/brand-response.dto';
import { CreateBrandDto } from '../dto/create-brand.dto';
import { UpdateBrandDto } from '../dto/update-brand.dto';

/** Identity-only payload accepted from upstream (field-ownership contract). */
export interface BrandUpstreamInput {
  upstream_brand_id: string;
  upstream_agency_id: string;
  brand_name: string;
  industry_category?: string | null;
  contact_email?: string | null;
  /** Attribution: which upstream portal produced this write. */
  upstream_portal?: string;
}

export interface BrandComplianceView {
  id: string;
  brand_name: string;
  industry_category: string | null;
  contact_email: string | null;
  upstream_brand_id: string | null;
  upstream_agency_id: string | null;
  /** Government-owned overlay — readable upstream, never writable by it. */
  government: {
    is_active: boolean;
    auto_approve: boolean;
    is_flagged: boolean;
  };
}

export interface BrandListFilters {
  search?: string;
  flag_status?: 'flagged' | 'unflagged';
  auto_approval?: 'on' | 'off';
  activity?: 'active' | 'stopped';
  industry?: string;
}

export interface BrandExportRow {
  id: string;
  brand_name: string;
  industry_category: string | null;
  contact_email: string | null;
  is_active: boolean;
  auto_approve: boolean;
  is_flagged: boolean;
  agency_name: string | null;
  updated_at: Date;
}

interface KillSwitchResult {
  brand: BrandResponseDto;
  revoked_adverts_count: number;
}

type BrandWithAgency = Brand & {
  agency?: {
    upstreamAgencyId: string;
    agencyName: string;
    city: string | null;
    address: string | null;
  } | null;
};

/** Shared list/export predicate: search + flag + auto-approve + activity + industry. */
export function buildBrandWhere(filters: BrandListFilters): Prisma.BrandWhereInput {
  const search = filters.search?.trim();
  return {
    ...(search ? { brandName: { contains: search, mode: 'insensitive' as const } } : {}),
    ...(filters.flag_status ? { isFlagged: filters.flag_status === 'flagged' } : {}),
    ...(filters.auto_approval ? { autoApprove: filters.auto_approval === 'on' } : {}),
    ...(filters.activity ? { isActive: filters.activity === 'active' } : {}),
    ...(filters.industry
      ? { industryCategory: { equals: filters.industry, mode: 'insensitive' as const } }
      : {}),
  };
}

/** UI sort keys mapped to Prisma — never passes raw client input to orderBy. */
export function brandOrderBy(
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'desc',
): Prisma.BrandOrderByWithRelationInput {
  if (sortBy !== undefined && !(BRAND_SORT_KEYS as readonly string[]).includes(sortBy)) {
    throw new BadRequestException(`sortBy must be one of: ${BRAND_SORT_KEYS.join(', ')}`);
  }
  if (sortBy === 'name') return { brandName: sortOrder };
  if (sortBy === 'updated') return { updatedAt: sortOrder };
  return { brandName: 'asc' };
}

/**
 * Brand oversight: identity is a projection of upstream data while the
 * compliance overlay (is_active / auto_approve / is_flagged) is mastered here.
 * Every mutation emits brand.* events; the kill-switch additionally cascades
 * advert.auto_revoked for each non-revoked advert of the brand.
 */
@Injectable()
export class BrandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
  ) {}

  async findAll(
    query: Pick<
      BrandQueryDto,
      'page' | 'limit' | 'search' | 'flag_status' | 'auto_approval' | 'activity' | 'industry'
    > &
      Partial<Pick<BrandQueryDto, 'sortOrder' | 'sortBy'>>,
  ): Promise<Paginated<BrandResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { skip, take } = toSkipTake({ page, limit, sortOrder: query.sortOrder ?? 'desc' });
    const where = buildBrandWhere(query);
    const [brands, total] = await Promise.all([
      this.prisma.client.brand.findMany({
        where,
        orderBy: brandOrderBy(query.sortBy, query.sortOrder ?? 'asc'),
        skip,
        take,
      }),
      this.prisma.client.brand.count({ where }),
    ]);
    const enriched = await this.withAgencies(brands);
    return {
      data: enriched.map((brand) => this.toResponse(brand)),
      meta: buildMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<BrandResponseDto> {
    const brand = await this.prisma.client.brand.findUnique({ where: { id } });
    if (!brand) throw new NotFoundException(`Brand with ID ${id} not found`);
    const [enriched] = await this.withAgencies([brand]);
    return this.toResponse(enriched);
  }

  /** Distinct industry categories for the filter dropdown. */
  async industries(): Promise<string[]> {
    const rows = await this.prisma.client.brand.findMany({
      where: { industryCategory: { not: null } },
      select: { industryCategory: true },
      distinct: ['industryCategory'],
      orderBy: { industryCategory: 'asc' },
    });
    return rows.map((row) => row.industryCategory as string).filter(Boolean);
  }

  /** Flat projection used by the CSV export (same filter set as list). */
  async exportBrands(filters: BrandListFilters): Promise<BrandExportRow[]> {
    const where = buildBrandWhere(filters);
    const brands = await this.prisma.client.brand.findMany({
      where,
      orderBy: { brandName: 'asc' },
    });
    const enriched = await this.withAgencies(brands);
    return enriched.map((brand) => ({
      id: brand.id,
      brand_name: brand.brandName,
      industry_category: brand.industryCategory,
      contact_email: brand.contactEmail,
      is_active: brand.isActive,
      auto_approve: brand.autoApprove,
      is_flagged: brand.isFlagged,
      agency_name: brand.agency?.agencyName ?? null,
      updated_at: brand.updatedAt,
    }));
  }

  async create(dto: CreateBrandDto): Promise<BrandResponseDto> {
    const brand = await this.prisma.$transaction(async (tx) => {
      const created = await tx.brand.create({
        data: {
          brandName: dto.brand_name,
          industryCategory: dto.industry_category ?? null,
          contactEmail: dto.contact_email ?? null,
          logoUrl: dto.logo_url ?? null,
          address: dto.address ?? null,
          isActive: dto.is_active ?? true,
          autoApprove: dto.auto_approve ?? false,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.brandCreated,
        entityType: 'Brand',
        entityId: created.id,
        payload: {
          brand_id: created.id,
          brand_name: created.brandName,
          industry_category: created.industryCategory,
          auto_approve: created.autoApprove,
        },
      });
      return created;
    });
    const [enriched] = await this.withAgencies([brand]);
    return this.toResponse(enriched);
  }

  async update(id: string, dto: UpdateBrandDto): Promise<BrandResponseDto> {
    const brand = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.brand.findUnique({ where: { id } });
      if (!previous) throw new NotFoundException(`Brand with ID ${id} not found`);
      const updated = await tx.brand.update({
        where: { id },
        data: {
          ...(dto.brand_name !== undefined ? { brandName: dto.brand_name } : {}),
          ...(dto.industry_category !== undefined
            ? { industryCategory: dto.industry_category }
            : {}),
          ...(dto.contact_email !== undefined ? { contactEmail: dto.contact_email } : {}),
          ...(dto.logo_url !== undefined ? { logoUrl: dto.logo_url } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
          ...(dto.auto_approve !== undefined ? { autoApprove: dto.auto_approve } : {}),
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.brandUpdated,
        entityType: 'Brand',
        entityId: updated.id,
        payload: {
          oldValue: {
            brand_name: previous.brandName,
            industry_category: previous.industryCategory,
            contact_email: previous.contactEmail,
            logo_url: (previous as { logoUrl?: string | null }).logoUrl ?? null,
            address: (previous as { address?: string | null }).address ?? null,
            auto_approve: previous.autoApprove,
            is_active: previous.isActive,
          },
          newValue: {
            brand_name: updated.brandName,
            industry_category: updated.industryCategory,
            contact_email: updated.contactEmail,
            logo_url: (updated as { logoUrl?: string | null }).logoUrl ?? null,
            address: (updated as { address?: string | null }).address ?? null,
            auto_approve: updated.autoApprove,
            is_active: updated.isActive,
          },
        },
      });
      return updated;
    });
    const [enriched] = await this.withAgencies([brand]);
    return this.toResponse(enriched);
  }

  async setFlag(id: string, isFlagged: boolean, actorId?: string): Promise<BrandResponseDto> {
    const brand = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.brand.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Brand with ID ${id} not found`);
      const updated = await tx.brand.update({
        where: { id },
        data: {
          isFlagged,
          flaggedBy: isFlagged ? (actorId ?? existing.flaggedBy) : null,
          flaggedOn: isFlagged ? new Date() : null,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: isFlagged
          ? EventTypes.brandNonCompliantFlagged
          : EventTypes.brandNonCompliantUnflagged,
        entityType: 'Brand',
        entityId: updated.id,
        payload: {
          brand_id: updated.id,
          brand_name: updated.brandName,
          is_flagged: updated.isFlagged,
        },
      });
      return updated;
    });
    const [enriched] = await this.withAgencies([brand]);
    return this.toResponse(enriched);
  }

  /**
   * Global kill-switch. Deactivation cascades every non-revoked advert of the
   * brand to REVOKED (advert.auto_revoked per advert, reason brand_kill_switch)
   * and upstream must honour it. Reactivation does not resurrect adverts.
   */
  async killSwitch(id: string, isActive: boolean): Promise<KillSwitchResult> {
    const result = await this.prisma.$transaction(async (tx): Promise<KillSwitchResult> => {
      const existing = await tx.brand.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Brand with ID ${id} not found`);

      let revokedIds: string[] = [];
      if (!isActive) {
        const adverts = await tx.advert.findMany({
          where: { version: { creative: { brandId: id } }, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (adverts.length > 0) {
          await tx.advert.updateMany({
            where: { id: { in: adverts.map((advert) => advert.id) } },
            data: { status: 'REVOKED' },
          });
          revokedIds = adverts.map((advert) => advert.id);
        }
      }

      const brand = await tx.brand.update({ where: { id }, data: { isActive } });
      await this.outbox.emitInTx(tx, {
        eventType: isActive ? EventTypes.brandReactivated : EventTypes.brandDeactivated,
        entityType: 'Brand',
        entityId: brand.id,
        payload: {
          brand_id: brand.id,
          brand_name: brand.brandName,
          is_active: brand.isActive,
          revoked_adverts_count: revokedIds.length,
        },
      });
      for (const advertId of revokedIds) {
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.advertAutoRevoked,
          entityType: 'Advert',
          entityId: advertId,
          key: advertId,
          payload: { advert_id: advertId, brand_id: brand.id, reason: 'brand_kill_switch' },
        });
      }
      const [enriched] = await this.withAgencies([brand]);
      return { brand: this.toResponse(enriched), revoked_adverts_count: revokedIds.length };
    });
    return result;
  }

  /**
   * Upstream intake write (UPSTREAM_INTEGRATION_API.md §4.2). Idempotent on
   * upstream_brand_id. Only identity fields are accepted — the government
   * overlay (is_active / auto_approve / is_flagged) is never writable upstream.
   */
  async upsertFromUpstream(
    input: BrandUpstreamInput,
  ): Promise<{ brand: BrandResponseDto; created: boolean }> {
    const agency = await this.prisma.client.agencyRef.findUnique({
      where: { upstreamAgencyId: input.upstream_agency_id },
    });
    if (!agency) {
      throw new NotFoundException(
        `Unknown upstream agency ${input.upstream_agency_id}; push it via PUT /intake/agencies first`,
      );
    }

    const existing = await this.prisma.client.brand.findUnique({
      where: { upstreamBrandId: input.upstream_brand_id },
    });
    if (!existing) {
      const nameOwner = await this.prisma.client.brand.findUnique({
        where: { brandName: input.brand_name },
      });
      if (nameOwner) {
        throw new ConflictException(
          `Brand name "${input.brand_name}" already exists locally; reconcile the rename upstream`,
        );
      }
      const brand = await this.prisma.$transaction(async (tx) => {
        const created = await tx.brand.create({
          data: {
            brandName: input.brand_name,
            industryCategory: input.industry_category ?? null,
            contactEmail: input.contact_email ?? null,
            upstreamBrandId: input.upstream_brand_id,
            upstreamAgencyId: input.upstream_agency_id,
          },
        });
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.brandCreated,
          entityType: 'Brand',
          entityId: created.id,
          actorId: input.upstream_portal,
          payload: {
            brand_id: created.id,
            brand_name: created.brandName,
            industry_category: created.industryCategory,
            auto_approve: created.autoApprove,
            origin: 'upstream',
          },
        });
        return created;
      });
      const [enriched] = await this.withAgencies([brand]);
      return { brand: this.toResponse(enriched), created: true };
    }

    const changed =
      existing.brandName !== input.brand_name ||
      existing.industryCategory !== (input.industry_category ?? null) ||
      existing.contactEmail !== (input.contact_email ?? null) ||
      existing.upstreamAgencyId !== input.upstream_agency_id;
    if (!changed) {
      const [enriched] = await this.withAgencies([existing]);
      return { brand: this.toResponse(enriched), created: false };
    }

    if (existing.brandName !== input.brand_name) {
      const nameOwner = await this.prisma.client.brand.findUnique({
        where: { brandName: input.brand_name },
      });
      if (nameOwner) {
        throw new ConflictException(
          `Brand name "${input.brand_name}" already exists locally; reconcile the rename upstream`,
        );
      }
    }

    const brand = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.brand.update({
        where: { id: existing.id },
        data: {
          brandName: input.brand_name,
          industryCategory: input.industry_category ?? null,
          contactEmail: input.contact_email ?? null,
          upstreamAgencyId: input.upstream_agency_id,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.brandUpdated,
        entityType: 'Brand',
        entityId: updated.id,
        actorId: input.upstream_portal,
        payload: {
          oldValue: {
            brand_name: existing.brandName,
            industry_category: existing.industryCategory,
            contact_email: existing.contactEmail,
          },
          newValue: {
            brand_name: updated.brandName,
            industry_category: updated.industryCategory,
            contact_email: updated.contactEmail,
          },
          origin: 'upstream',
        },
      });
      return updated;
    });
    const [enriched] = await this.withAgencies([brand]);
    return { brand: this.toResponse(enriched), created: false };
  }

  /** Compliance read-back for the upstream GET contract (§4.2). */
  async findOneByUpstreamId(upstreamBrandId: string): Promise<BrandComplianceView> {
    const brand = await this.prisma.client.brand.findUnique({ where: { upstreamBrandId } });
    if (!brand) throw new NotFoundException(`Brand with upstream ID ${upstreamBrandId} not found`);
    return {
      id: brand.id,
      brand_name: brand.brandName,
      industry_category: brand.industryCategory,
      contact_email: brand.contactEmail,
      upstream_brand_id: brand.upstreamBrandId,
      upstream_agency_id: brand.upstreamAgencyId,
      government: {
        is_active: brand.isActive,
        auto_approve: brand.autoApprove,
        is_flagged: brand.isFlagged,
      },
    };
  }

  /**
   * Agency + location enrichment: joins AgencyRef by upstreamAgencyId so the
   * list can render agency name/city/address without a second call.
   */
  private async withAgencies(brands: Brand[]): Promise<BrandWithAgency[]> {
    const ids = [...new Set(brands.map((b) => b.upstreamAgencyId).filter(Boolean))] as string[];
    if (ids.length === 0) return brands.map((b) => ({ ...b, agency: null }));
    const agencies = await this.prisma.client.agencyRef.findMany({
      where: { upstreamAgencyId: { in: ids } },
    });
    const byUpstream = new Map(agencies.map((a) => [a.upstreamAgencyId, a]));
    return brands.map((brand) => {
      const agency = brand.upstreamAgencyId ? byUpstream.get(brand.upstreamAgencyId) : undefined;
      return {
        ...brand,
        agency: agency
          ? {
              upstreamAgencyId: agency.upstreamAgencyId,
              agencyName: agency.agencyName,
              city: agency.city,
              address: agency.address,
            }
          : null,
      };
    });
  }

  private toResponse(brand: BrandWithAgency): BrandResponseDto {
    return plainToInstance(
      BrandResponseDto,
      {
        id: brand.id,
        brand_name: brand.brandName,
        industry_category: brand.industryCategory,
        contact_email: brand.contactEmail,
        logo_url: (brand as { logoUrl?: string | null }).logoUrl ?? null,
        address: (brand as { address?: string | null }).address ?? null,
        is_active: brand.isActive,
        auto_approve: brand.autoApprove,
        is_flagged: brand.isFlagged,
        flagged_by: brand.flaggedBy ?? null,
        flagged_on: brand.flaggedOn ?? null,
        upstream_brand_id: brand.upstreamBrandId,
        upstream_agency_id: brand.upstreamAgencyId,
        agency: brand.agency
          ? {
              upstream_agency_id: brand.agency.upstreamAgencyId,
              agency_name: brand.agency.agencyName,
              city: brand.agency.city,
              address: brand.agency.address,
            }
          : null,
        created_at: brand.createdAt,
        updated_at: brand.updatedAt,
      },
      { excludeExtraneousValues: true },
    );
  }
}
