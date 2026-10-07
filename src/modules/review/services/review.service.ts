import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Prisma, ReviewStatus } from '@prisma/client';
import { Paginated } from '../../../common/dto/paginated';
import { buildMeta, toSkipTake } from '../../../common/utils/paginate';
import { PrismaService } from '../../../database/prisma.service';
import { EventOutboxService } from '../../events/event.outbox';
import { EventTypes } from '../../events/events.constants';
import { CreativeQueryDto } from '../dto/creative-query.dto';
import {
  CreativeResponseDto,
  CreativeVersionResponseDto,
  ReviewActionResponseDto,
} from '../dto/creative-response.dto';
import { CreateCreativeDto } from '../dto/create-creative.dto';
import { UploadVersionDto } from '../dto/upload-version.dto';
import {
  actionTypeFor,
  assertValidTakeAction,
  assertWithdrawable,
  statusForAction,
} from '../transitions';

export interface TakeActionInput {
  action: string;
  comments?: string;
  expectedVersion?: number;
}

export interface CreativeUpstreamInput {
  upstream_creative_id: string;
  upstream_agency_id: string;
  upstream_brand_id: string;
  creative_name: string;
  campaign_ref?: string | null;
  upstream_portal?: string;
}

export interface WithdrawVersionInput {
  upstream_version_id?: string;
  version_id?: string;
  reason?: string;
  upstream_event_id?: string;
  upstream_portal?: string;
}

const REVIEW_EVENT_BY_ACTION = {
  APPROVE: EventTypes.reviewApproved,
  REJECT: EventTypes.reviewRejected,
  HOLD: EventTypes.reviewOnHold,
  REQUEST_CHANGES: EventTypes.reviewNeedsChanges,
} as const;

type CreativeWithBrandAndVersions = Prisma.CreativeGetPayload<{
  include: { brand: true; versions: { include: { actions: true } } };
}>;

/**
 * Creative review lifecycle (REQUIREMENTS.md §3.1, WORKFLOWS.md §1).
 *
 * Operator actions derive the actor from the JWT (never from the request
 * body) so the ReviewAction trail cannot be spoofed. Upstream-facing methods
 * (upsertThread / uploadVersion / withdrawVersion) are idempotent on
 * upstream_*_id and are the service contract for the future intake module.
 */
@Injectable()
export class CreativeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EventOutboxService,
  ) {}

  async findAll(query: CreativeQueryDto): Promise<Paginated<CreativeResponseDto>> {
    const { skip, take } = toSkipTake(query);
    const where: Prisma.CreativeWhereInput = {
      ...(query.brand_id ? { brandId: query.brand_id } : {}),
      ...(query.search ? { creativeName: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.status ? { versions: { some: { status: query.status } } } : {}),
    };
    const [creatives, total] = await Promise.all([
      this.prisma.client.creative.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          brand: true,
          versions: {
            orderBy: { versionNumber: 'desc' },
            take: 1,
            include: { actions: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      }),
      this.prisma.client.creative.count({ where }),
    ]);

    const actorNames = await this.resolveActorNames(
      this.collectActorIds(creatives.flatMap((creative) => creative.versions)),
    );
    const data = creatives.map((creative) => {
      const response = this.toCreativeResponse(creative, actorNames);
      const latestAction = creative.versions[0]?.actions[0];
      return {
        ...response,
        last_action_by: latestAction ? (actorNames.get(latestAction.actorId) ?? null) : null,
        last_action_at: latestAction ? latestAction.createdAt : null,
      };
    });
    return { data, meta: buildMeta(total, query.page, query.limit) };
  }

  async createCreative(dto: CreateCreativeDto, actorId: string): Promise<CreativeResponseDto> {
    const brand = await this.prisma.client.brand.findUnique({ where: { id: dto.brand_id } });
    if (!brand) throw new NotFoundException(`Brand with ID ${dto.brand_id} not found`);

    const creative = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creative.create({
        data: {
          brandId: dto.brand_id,
          creativeName: dto.creative_name,
          externalRefId: dto.external_ref_id ?? null,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeCreated,
        entityType: 'Creative',
        entityId: created.id,
        actorId,
        key: created.id,
        payload: {
          creative_id: created.id,
          brand_id: created.brandId,
          creative_name: created.creativeName,
        },
      });
      return created;
    });
    return this.toCreativeResponse({ ...creative, brand, versions: [] }, new Map());
  }

  /**
   * Adds a version to the approval thread. Versions auto-increment inside the
   * same thread; uploading over an APPROVED latest version conflicts (409) and
   * brand.auto_approve bypasses the review queue instantly.
   */
  async uploadVersion(
    creativeId: string,
    dto: UploadVersionDto & {
      upstream_version_id?: string;
      submitted_at?: Date | null;
    },
    actorId: string,
  ): Promise<{ version: CreativeVersionResponseDto; replayed: boolean }> {
    if (dto.upstream_version_id) {
      const replay = await this.prisma.client.creativeVersion.findUnique({
        where: { upstreamVersionId: dto.upstream_version_id },
      });
      if (replay) return { version: this.toVersionResponse(replay, new Map()), replayed: true };
    }

    const creative = await this.prisma.client.creative.findUnique({
      where: { id: creativeId },
      include: { brand: true },
    });
    if (!creative) throw new NotFoundException(`Creative with ID ${creativeId} not found`);

    const latest = await this.prisma.client.creativeVersion.findFirst({
      where: { creativeId },
      orderBy: { versionNumber: 'desc' },
    });
    if (latest?.status === ReviewStatus.APPROVED) {
      throw new ConflictException(
        'Current version is APPROVED; a new version cannot be uploaded until the decision is reset',
      );
    }
    const nextVersionNumber = latest ? latest.versionNumber + 1 : 1;
    const autoApprove = creative.brand?.autoApprove === true;
    const status = autoApprove ? ReviewStatus.APPROVED : ReviewStatus.PENDING;

    const version = await this.prisma.$transaction(async (tx) => {
      const created = await tx.creativeVersion.create({
        data: {
          creativeId,
          versionNumber: nextVersionNumber,
          mediaUrl: dto.media_url,
          mediaType: dto.media_type,
          status,
          createdBy: actorId,
          upstreamVersionId: dto.upstream_version_id ?? null,
          submittedAt: dto.submitted_at ?? null,
        },
      });
      await tx.creative.update({
        where: { id: creativeId },
        data: { currentVersionId: created.id },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.versionUploaded,
        entityType: 'CreativeVersion',
        entityId: created.id,
        actorId,
        key: creativeId,
        payload: {
          creative_id: creativeId,
          version_id: created.id,
          version_number: created.versionNumber,
          media_url: created.mediaUrl,
          media_type: created.mediaType,
          auto_approved: autoApprove,
          notes: dto.notes ?? null,
          upstream_version_id: dto.upstream_version_id ?? null,
          submitted_at: dto.submitted_at ? dto.submitted_at.toISOString() : null,
        },
      });
      if (autoApprove) {
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.reviewAutoApproved,
          entityType: 'CreativeVersion',
          entityId: created.id,
          actorId,
          key: creativeId,
          payload: {
            version_id: created.id,
            creative_id: creativeId,
            reason: 'brand.auto_approve',
          },
        });
      }
      return created;
    });
    return { version: this.toVersionResponse(version, new Map()), replayed: false };
  }

  /**
   * Records a review decision. Optimistic locking via expectedVersion: the
   * first write wins, the loser gets 409. REJECT/NEEDS_CHANGES cascade
   * advert.auto_revoked to every non-revoked advert of the version.
   */
  async takeAction(
    versionId: string,
    input: TakeActionInput,
    actorId: string,
  ): Promise<CreativeVersionResponseDto> {
    const version = await this.prisma.client.creativeVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException(`Creative version ${versionId} not found`);

    if (input.expectedVersion !== undefined && input.expectedVersion !== version.versionNumber) {
      throw new ConflictException('This asset has been updated by another user; refresh and retry');
    }
    assertValidTakeAction(input);
    const action = input.action as keyof typeof REVIEW_EVENT_BY_ACTION;
    const newStatus = statusForAction(action);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.creativeVersion.update({
        where: { id: versionId },
        data: { status: newStatus },
      });
      await tx.reviewAction.create({
        data: {
          versionId,
          actorId,
          action: actionTypeFor(action),
          comments: input.comments ?? null,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: REVIEW_EVENT_BY_ACTION[action],
        entityType: 'CreativeVersion',
        entityId: versionId,
        actorId,
        key: version.creativeId,
        payload: {
          version_id: versionId,
          creative_id: version.creativeId,
          action,
          new_status: newStatus,
          from_status: version.status,
          comments: input.comments ?? null,
        },
      });
      if (newStatus === ReviewStatus.REJECTED || newStatus === ReviewStatus.NEEDS_CHANGES) {
        const adverts = await tx.advert.findMany({
          where: { versionId, status: { not: 'REVOKED' } },
          select: { id: true },
        });
        if (adverts.length > 0) {
          await tx.advert.updateMany({
            where: { id: { in: adverts.map((advert) => advert.id) } },
            data: { status: 'REVOKED' },
          });
          for (const advert of adverts) {
            await this.outbox.emitInTx(tx, {
              eventType: EventTypes.advertAutoRevoked,
              entityType: 'Advert',
              entityId: advert.id,
              key: advert.id,
              actorId,
              payload: {
                advert_id: advert.id,
                version_id: versionId,
                creative_id: version.creativeId,
                reason: `Creative version ${action}`,
              },
            });
          }
        }
      }
      return saved;
    });
    return this.toVersionResponse(updated, new Map());
  }

  /** Full approval-thread history: versions newest-first with actions oldest-first. */
  async getHistory(
    creativeId: string,
  ): Promise<{ creative: CreativeResponseDto; versions: CreativeVersionResponseDto[] }> {
    const creative = await this.prisma.client.creative.findUnique({
      where: { id: creativeId },
      include: {
        brand: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: { actions: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!creative) throw new NotFoundException(`Creative with ID ${creativeId} not found`);

    const actorNames = await this.resolveActorNames(this.collectActorIds(creative.versions));
    return {
      creative: this.toCreativeResponse(creative, actorNames),
      versions: creative.versions.map((version) => this.toVersionResponse(version, actorNames)),
    };
  }

  /** Withdraws an undecided version (MULTI_PORTAL_ARCHITECTURE.md §8.4). */
  async withdrawVersion(
    creativeId: string,
    input: WithdrawVersionInput,
  ): Promise<{ version: CreativeVersionResponseDto }> {
    let version: Prisma.CreativeVersionGetPayload<object> | null = null;
    if (input.upstream_version_id) {
      version = await this.prisma.client.creativeVersion.findUnique({
        where: { upstreamVersionId: input.upstream_version_id },
      });
    } else if (input.version_id) {
      version = await this.prisma.client.creativeVersion.findUnique({
        where: { id: input.version_id },
      });
    } else {
      version = await this.prisma.client.creativeVersion.findFirst({
        where: { creativeId },
        orderBy: { versionNumber: 'desc' },
      });
    }
    if (!version) throw new NotFoundException('No matching creative version to withdraw');
    if (version.creativeId !== creativeId) {
      throw new BadRequestException('Version does not belong to this creative');
    }
    assertWithdrawable(version.status);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.creativeVersion.update({
        where: { id: version.id },
        data: { status: ReviewStatus.WITHDRAWN },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeWithdrawn,
        entityType: 'CreativeVersion',
        entityId: version.id,
        actorId: input.upstream_portal,
        key: creativeId,
        payload: {
          version_id: version.id,
          creative_id: creativeId,
          from_status: version.status,
          reason: input.reason ?? null,
          upstream_event_id: input.upstream_event_id ?? null,
        },
      });
      return saved;
    });
    return { version: this.toVersionResponse(updated, new Map()) };
  }

  /**
   * Upstream intake write for the approval thread (UPSTREAM_INTEGRATION_API.md
   * §4.3). Idempotent on upstream_creative_id; brand resolved by
   * upstream_brand_id with a raw-id fallback.
   */
  async upsertThread(
    input: CreativeUpstreamInput,
  ): Promise<{ creative: CreativeResponseDto; created: boolean }> {
    const agency = await this.prisma.client.agencyRef.findUnique({
      where: { upstreamAgencyId: input.upstream_agency_id },
    });
    if (!agency) {
      throw new NotFoundException(
        `Unknown upstream agency ${input.upstream_agency_id}; push it via PUT /intake/agencies first`,
      );
    }

    const brand =
      (await this.prisma.client.brand.findUnique({
        where: { upstreamBrandId: input.upstream_brand_id },
      })) ??
      (await this.prisma.client.brand.findUnique({ where: { id: input.upstream_brand_id } }));
    if (!brand)
      throw new NotFoundException(`Brand with upstream ID ${input.upstream_brand_id} not found`);

    const existing = await this.prisma.client.creative.findUnique({
      where: { upstreamCreativeId: input.upstream_creative_id },
    });
    if (!existing) {
      const creative = await this.prisma.$transaction(async (tx) => {
        const created = await tx.creative.create({
          data: {
            brandId: brand.id,
            creativeName: input.creative_name,
            campaignRef: input.campaign_ref ?? null,
            upstreamCreativeId: input.upstream_creative_id,
            upstreamAgencyId: input.upstream_agency_id,
          },
        });
        await this.outbox.emitInTx(tx, {
          eventType: EventTypes.creativeCreated,
          entityType: 'Creative',
          entityId: created.id,
          actorId: input.upstream_portal,
          key: created.id,
          payload: {
            creative_id: created.id,
            brand_id: created.brandId,
            creative_name: created.creativeName,
            origin: 'upstream',
          },
        });
        return created;
      });
      return {
        creative: this.toCreativeResponse({ ...creative, brand, versions: [] }, new Map()),
        created: true,
      };
    }

    const changed =
      existing.brandId !== brand.id ||
      existing.creativeName !== input.creative_name ||
      existing.campaignRef !== (input.campaign_ref ?? null) ||
      existing.upstreamAgencyId !== input.upstream_agency_id;
    if (!changed) {
      return {
        creative: this.toCreativeResponse({ ...existing, brand, versions: [] }, new Map()),
        created: false,
      };
    }

    const creative = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.creative.update({
        where: { id: existing.id },
        data: {
          brandId: brand.id,
          creativeName: input.creative_name,
          campaignRef: input.campaign_ref ?? null,
          upstreamAgencyId: input.upstream_agency_id,
        },
      });
      await this.outbox.emitInTx(tx, {
        eventType: EventTypes.creativeUpdated,
        entityType: 'Creative',
        entityId: updated.id,
        actorId: input.upstream_portal,
        key: updated.id,
        payload: {
          oldValue: {
            brand_id: existing.brandId,
            creative_name: existing.creativeName,
            campaign_ref: existing.campaignRef,
          },
          newValue: {
            brand_id: updated.brandId,
            creative_name: updated.creativeName,
            campaign_ref: updated.campaignRef,
          },
          origin: 'upstream',
        },
      });
      return updated;
    });
    return {
      creative: this.toCreativeResponse({ ...creative, brand, versions: [] }, new Map()),
      created: false,
    };
  }

  private collectActorIds(
    versions: Array<{ createdBy: string; actions: Array<{ actorId: string }> }>,
  ): string[] {
    const ids = new Set<string>();
    for (const version of versions) {
      ids.add(version.createdBy);
      for (const action of version.actions) ids.add(action.actorId);
    }
    return [...ids];
  }

  private async resolveActorNames(actorIds: string[]): Promise<Map<string, string>> {
    if (actorIds.length === 0) return new Map();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  }

  private toCreativeResponse(
    creative: CreativeWithBrandAndVersions,
    actorNames: Map<string, string>,
  ): CreativeResponseDto {
    const latestVersion = creative.versions[0];
    const latestAction = latestVersion?.actions[0];
    return plainToInstance(
      CreativeResponseDto,
      {
        id: creative.id,
        brand_id: creative.brandId,
        brand: {
          id: creative.brand.id,
          brand_name: creative.brand.brandName,
          is_flagged: creative.brand.isFlagged,
        },
        creative_name: creative.creativeName,
        external_ref_id: creative.externalRefId,
        upstream_creative_id: creative.upstreamCreativeId,
        campaign_ref: creative.campaignRef,
        current_version_id: creative.currentVersionId,
        created_at: creative.createdAt,
        latest_version: latestVersion ? this.toVersionResponse(latestVersion, actorNames) : null,
        last_action_by: latestAction ? (actorNames.get(latestAction.actorId) ?? null) : null,
        last_action_at: latestAction ? latestAction.createdAt : null,
      },
      { excludeExtraneousValues: true },
    );
  }

  private toVersionResponse(
    version:
      | Prisma.CreativeVersionGetPayload<{ include: { actions: true } }>
      | Prisma.CreativeVersionGetPayload<object>,
    actorNames: Map<string, string>,
  ): CreativeVersionResponseDto {
    const withActions = version as Prisma.CreativeVersionGetPayload<{ include: { actions: true } }>;
    const actions = withActions.actions ?? [];
    const latestAction = [...actions].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];
    return plainToInstance(
      CreativeVersionResponseDto,
      {
        id: version.id,
        version_number: version.versionNumber,
        media_url: version.mediaUrl,
        media_type: version.mediaType,
        status: version.status,
        created_by: version.createdBy,
        created_by_name: actorNames.get(version.createdBy) ?? null,
        created_at: version.createdAt,
        latest_action: latestAction
          ? plainToInstance(
              ReviewActionResponseDto,
              {
                id: latestAction.id,
                action: latestAction.action,
                comments: latestAction.comments,
                actor_id: latestAction.actorId,
                actor_name: actorNames.get(latestAction.actorId) ?? null,
                created_at: latestAction.createdAt,
              },
              { excludeExtraneousValues: true },
            )
          : null,
        actions: actions
          ? actions.map((action) =>
              plainToInstance(
                ReviewActionResponseDto,
                {
                  id: action.id,
                  action: action.action,
                  comments: action.comments,
                  actor_id: action.actorId,
                  actor_name: actorNames.get(action.actorId) ?? null,
                  created_at: action.createdAt,
                },
                { excludeExtraneousValues: true },
              ),
            )
          : undefined,
      },
      { excludeExtraneousValues: true },
    );
  }
}
