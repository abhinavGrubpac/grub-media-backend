import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { CreativeService } from '../../review/services/review.service';
import { AdvertService } from '../../advert/services/advert.service';
import {
  BootstrapTestFlowDto,
  CreateTestBrandDto,
  CreateTestCreativeDto,
  RegisterAgencyDto,
  ScheduleTestAdvertDto,
} from '../dto/test-intake.dto';

/**
 * Test-only upstream stand-in (WORKFLOWS.md §1–§2).
 *
 * The agency/admin portals own identity, media and schedules; this portal
 * only reviews and monitors. Until the three-portal monorepo intake lands,
 * these endpoints let operators stage that upstream data (agency → brand →
 * creative/version → schedule) and drive the full govt flow:
 * review → APPROVE → ready queue → schedule → go-live sync.
 *
 * Replay rule (§8 walkthrough): fixed inputs produce exactly one of each
 * entity — agency/brand/creative are idempotent on their upstream ids,
 * versions on upstream_version_id, schedules on upstream_advert_id.
 * Omitted upstream ids fall back to deterministic test slugs (bootstrap) or
 * random ids (granular calls).
 *
 * Every method refuses to run in production. The whole module is deleted
 * when the monorepo intake replaces it — no govt controller may import it.
 */
@Injectable()
export class TestIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creativeService: CreativeService,
    private readonly advertService: AdvertService,
    private readonly config: ConfigService,
  ) {}

  private assertTestEnabled(): void {
    if (this.config.get<string>('app.nodeEnv') === 'production') {
      throw new ForbiddenException('Test intake is disabled in production');
    }
  }

  /** Deterministic test slug so replayed bootstraps resolve to the same rows. */
  private testSlug(...parts: string[]): string {
    const slug = parts
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    return `test-${slug || 'row'}`;
  }

  /** Idempotent on upstream_agency_id (same contract as the future intake). */
  async registerAgency(dto: RegisterAgencyDto) {
    this.assertTestEnabled();
    return this.ensureAgency(dto.upstream_agency_id, dto.agency_name, dto.city, dto.address);
  }

  private async ensureAgency(
    upstreamAgencyId: string,
    agencyName: string,
    city?: string,
    address?: string,
  ) {
    const existing = await this.prisma.client.agencyRef.findUnique({
      where: { upstreamAgencyId: upstreamAgencyId },
    });
    if (existing) return { agency: existing, created: false as const };
    const agency = await this.prisma.client.agencyRef.create({
      data: {
        upstreamAgencyId: upstreamAgencyId,
        agencyName,
        city: city ?? null,
        address: address ?? null,
      },
    });
    return { agency, created: true as const };
  }

  /** Idempotent on upstream_brand_id when supplied; otherwise always creates. */
  async createBrand(dto: CreateTestBrandDto) {
    this.assertTestEnabled();
    if (dto.upstream_brand_id) {
      const existing = await this.prisma.client.brand.findUnique({
        where: { upstreamBrandId: dto.upstream_brand_id },
      });
      if (existing) return { brand: existing, created: false as const };
    }
    const brand = await this.prisma.client.brand.create({
      data: {
        brandName: dto.brand_name,
        industryCategory: dto.industry_category ?? null,
        contactEmail: dto.contact_email ?? null,
        upstreamBrandId: dto.upstream_brand_id ?? `test-${randomUUID().slice(0, 8)}`,
        upstreamAgencyId: dto.upstream_agency_id ?? null,
      },
    });
    return { brand, created: true as const };
  }

  /**
   * Creates the creative + v1 PENDING through the real upstream intake
   * (upsertThread → uploadVersion), so identity, campaign refs, admin
   * decision context, auto-approve rules and events behave exactly like
   * agency-portal data. An optional schedule block books the advert in the
   * same call (pre-approval booking is normal; go-live waits for APPROVE).
   */
  async createCreative(dto: CreateTestCreativeDto, actorId: string) {
    this.assertTestEnabled();
    const agencyId = dto.upstream_agency_id ?? 'test-agency';
    await this.ensureAgency(agencyId, agencyId);
    const upstreamCreativeId =
      dto.upstream_creative_id ?? `test-creative-${randomUUID().slice(0, 8)}`;
    const { creative } = await this.creativeService.upsertThread({
      upstream_creative_id: upstreamCreativeId,
      upstream_agency_id: agencyId,
      upstream_brand_id: dto.upstream_brand_id ?? dto.brand_id,
      creative_name: dto.creative_name,
      campaign_ref: dto.campaign_ref ?? null,
      upstream_portal: 'test-intake',
    });
    const { version, replayed } = await this.creativeService.uploadVersion(
      creative.id,
      {
        media_url: dto.media_url,
        media_type: dto.media_type,
        media_name: dto.media_name,
        upstream_version_id: dto.upstream_version_id ?? `${upstreamCreativeId}-v1`,
        admin_approved_by: dto.admin_approval?.by ?? null,
        admin_approved_at: dto.admin_approval?.at ?? null,
        admin_comments: dto.admin_approval?.comments ?? null,
      },
      actorId,
    );
    let advert: Awaited<ReturnType<AdvertService['scheduleVersion']>> | null = null;
    if (dto.schedule) {
      advert = await this.scheduleAdvert(
        {
          version_id: version.id,
          upstream_advert_id: `${upstreamCreativeId}-adv1`,
          ...dto.schedule,
        },
        actorId,
      );
    }
    return { creative, version, replayed, advert };
  }

  /**
   * Schedules an APPROVED version. With upstream_advert_id the call is
   * idempotent (same contract as the future intake); without it every call
   * schedules a fresh advert.
   */
  async scheduleAdvert(dto: ScheduleTestAdvertDto, actorId: string) {
    this.assertTestEnabled();
    if (!dto.upstream_advert_id) {
      return this.advertService.scheduleVersion(
        {
          version_id: dto.version_id,
          lat: dto.lat,
          lng: dto.lng,
          address_text: dto.address_text,
          start_date: dto.start_date,
          end_date: dto.end_date,
          city_name: dto.city_name ?? null,
          zone_name: dto.zone_name ?? null,
          radius: dto.radius ?? null,
          image_hash: dto.image_hash ?? null,
        },
        actorId,
      );
    }
    const version = await this.prisma.client.creativeVersion.findUnique({
      where: { id: dto.version_id },
      include: { creative: true },
    });
    if (!version) throw new NotFoundException(`Creative version ${dto.version_id} not found`);
    const { advert } = await this.advertService.upsertFromUpstream({
      upstream_advert_id: dto.upstream_advert_id,
      upstream_creative_id: version.creative.upstreamCreativeId ?? version.creative.id,
      upstream_version_id: version.upstreamVersionId ?? version.id,
      lat: dto.lat,
      lng: dto.lng,
      address_text: dto.address_text,
      start_date: dto.start_date,
      end_date: dto.end_date,
      city_name: dto.city_name ?? null,
      zone_name: dto.zone_name ?? null,
      radius_km: dto.radius ?? null,
      image_hash: dto.image_hash ?? null,
      upstream_portal: 'test-intake',
    });
    return advert;
  }

  /**
   * One-call E2E staging: agency → brand → creative v1 (PENDING) →
   * optional test approval → optional schedule. Sequential and
   * non-atomic by design (each step is independently replayable).
   */
  async bootstrap(dto: BootstrapTestFlowDto, actorId: string) {
    this.assertTestEnabled();
    const { agency } = await this.registerAgency(dto.agency);
    // Deterministic upstream ids: replaying the same bootstrap resolves to
    // the same rows instead of stacking duplicates (§8 walkthrough rule).
    const brandUpstreamId = dto.brand.upstream_brand_id ?? this.testSlug(dto.brand.brand_name);
    const { brand } = await this.createBrand({
      ...dto.brand,
      upstream_brand_id: brandUpstreamId,
      upstream_agency_id: dto.brand.upstream_agency_id ?? dto.agency.upstream_agency_id,
    });
    const creativeUpstreamId =
      dto.creative.upstream_creative_id ??
      this.testSlug(dto.brand.brand_name, dto.creative.creative_name);
    const { creative, version } = await this.createCreative(
      {
        brand_id: brand.id,
        upstream_brand_id: brandUpstreamId,
        creative_name: dto.creative.creative_name,
        media_url: dto.creative.media_url,
        media_type: dto.creative.media_type,
        media_name: dto.creative.media_name,
        campaign_ref: dto.creative.campaign_ref,
        upstream_creative_id: creativeUpstreamId,
        upstream_version_id: dto.creative.upstream_version_id ?? `${creativeUpstreamId}-v1`,
        upstream_agency_id: dto.agency.upstream_agency_id,
        admin_approval: dto.admin_approval,
      },
      actorId,
    );
    if (!version) throw new NotFoundException('Bootstrap version missing after create');

    if (dto.approve_immediately === true) {
      await this.creativeService.takeAction(
        version.id,
        { action: 'APPROVE', comments: 'Test bootstrap auto-approval' },
        actorId,
      );
    }

    let advert: Awaited<ReturnType<AdvertService['scheduleVersion']>> | null = null;
    if (dto.schedule) {
      advert = await this.scheduleAdvert(
        {
          version_id: version.id,
          upstream_advert_id: `${creativeUpstreamId}-adv1`,
          ...dto.schedule,
        },
        actorId,
      );
    }
    return { agency, brand, creative, version, advert };
  }

  /** Promotes due SCHEDULED rows to LIVE (expired ones to EXPIRED). */
  async goLiveSync(actorId: string) {
    this.assertTestEnabled();
    return this.advertService.syncDueSchedules(new Date(), actorId);
  }
}
