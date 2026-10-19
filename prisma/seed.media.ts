/**
 * Media-module seed — brand / creative / reference / advert demo data for the
 * government media portal (Maharashtra rollout).
 *
 * Scope: ONLY the media modules (brand, creative + versions + review trail,
 * reference documents, geo adverts). No portal data (users, permissions,
 * bundles, help) is created or modified.
 *
 * Idempotent by design — safe to re-run anywhere:
 *   • brands / creatives / versions are keyed on their upstream ids,
 *   • review actions are created only when a version has none yet,
 *   • reference docs are matched by title, creative links by (version, doc),
 *   • adverts insert only when their upstream_advert_id is absent.
 * It never deletes or mutates pre-existing rows, and the raw-SQL advert
 * inserts bypass the outbox on purpose (no Kafka events from seed data).
 *
 * Usage: DATABASE_URL=<url> npx ts-node prisma/seed.media.ts
 */
import { randomUUID } from 'node:crypto';
import { ActionType, AdvertStatus, PrismaClient, ReviewStatus, UserRole } from '@prisma/client';

const prisma = new PrismaClient();
const S3_BASE = 'https://grub-media.s3.ap-south-1.amazonaws.com/development';

/** 10:00 UTC on the given day — stable, tz-agnostic seed timestamps. */
const ts = (iso: string): Date => new Date(`${iso}T10:00:00.000Z`);

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

interface BrandSeed {
  upstreamBrandId: string;
  brandName: string;
  industryCategory: string;
  contactEmail: string;
  address: string;
  upstreamAgencyId: string | null;
  createdAt: string;
  isFlagged?: boolean;
  flaggedOn?: string;
}

const BRANDS: BrandSeed[] = [
  {
    upstreamBrandId: 'upbrand-mtdc-001',
    brandName: 'Maharashtra Tourism Development Corporation',
    industryCategory: 'Tourism & Culture',
    contactEmail: 'info@maharashtratourism.gov.in',
    address: 'Express Towers, Nariman Point, Mumbai - 400021',
    upstreamAgencyId: 'MAH-OOH-AG-001',
    createdAt: '2026-04-10',
  },
  {
    upstreamBrandId: 'upbrand-mcgm-001',
    brandName: 'Brihanmumbai Municipal Corporation',
    industryCategory: 'Municipal Administration',
    contactEmail: 'comm@mcgm.gov.in',
    address: 'MCGM Headquarters, Mahapalika Marg, Mumbai - 400001',
    upstreamAgencyId: 'MAH-OOH-AG-002',
    createdAt: '2026-09-01',
  },
  {
    upstreamBrandId: 'upbrand-msrtc-001',
    brandName: 'Maharashtra State Road Transport Corporation',
    industryCategory: 'Public Transport',
    contactEmail: 'feedback@msrtc.maharashtra.gov.in',
    address: 'MSRTC Head Office, Mumbai Central, Mumbai - 400008',
    upstreamAgencyId: null,
    createdAt: '2026-09-10',
    isFlagged: true,
    flaggedOn: '2026-09-20',
  },
  {
    upstreamBrandId: 'upbrand-mahapolice-001',
    brandName: 'Maharashtra Police',
    industryCategory: 'Public Safety',
    contactEmail: 'citizen@mahapolice.gov.in',
    address: 'Police Headquarters, Shahid Bhagat Singh Marg, Colaba, Mumbai - 400001',
    upstreamAgencyId: 'MAH-OOH-AG-002',
    createdAt: '2026-09-15',
  },
  {
    upstreamBrandId: 'upbrand-msedcl-001',
    brandName: 'Maharashtra State Electricity Distribution Co. Ltd',
    industryCategory: 'Power & Energy',
    contactEmail: 'customercare@mahadiscom.in',
    address: 'Prakashgad, Bandra (East), Mumbai - 400051',
    upstreamAgencyId: 'MAH-OOH-AG-001',
    createdAt: '2026-06-10',
  },
];

interface VersionSeed {
  upstreamVersionId: string;
  versionNumber: number;
  mediaName: string;
  status: ReviewStatus;
  createdAt: string;
  submittedAt: string;
  adminApprovedAt?: string;
  adminComments?: string;
  action?: { action: ActionType; comments: string; at: string };
}

interface CreativeSeed {
  upstreamCreativeId: string;
  brandUpstreamId: string;
  creativeName: string;
  campaignRef: string;
  upstreamAgencyId: string;
  folder: string;
  createdAt: string;
  versions: VersionSeed[];
}

const CREATIVES: CreativeSeed[] = [
  {
    upstreamCreativeId: 'upcr-mtdc-001',
    brandUpstreamId: 'upbrand-mtdc-001',
    creativeName: 'Discover Maharashtra 2026',
    campaignRef: 'MTDC-OOH-2026-Q4',
    upstreamAgencyId: 'MAH-OOH-AG-001',
    folder: 'mtdc/2026/10',
    createdAt: '2026-09-25',
    versions: [
      {
        upstreamVersionId: 'upv-mtdc-001-a',
        versionNumber: 1,
        mediaName: 'discover-maharashtra-2026-v1.png',
        status: ReviewStatus.APPROVED,
        createdAt: '2026-09-28',
        submittedAt: '2026-10-01',
        adminApprovedAt: '2026-10-03',
        adminComments: 'Approved for the Q4 city rollout.',
        action: {
          action: ActionType.APPROVE,
          comments: 'Approved for the Q4 city rollout.',
          at: '2026-10-03',
        },
      },
      {
        upstreamVersionId: 'upv-mtdc-001-b',
        versionNumber: 2,
        mediaName: 'discover-maharashtra-2026-v2.png',
        status: ReviewStatus.PENDING,
        createdAt: '2026-10-15',
        submittedAt: '2026-10-17',
      },
    ],
  },
  {
    upstreamCreativeId: 'upcr-mcgm-001',
    brandUpstreamId: 'upbrand-mcgm-001',
    creativeName: 'Swachh Mumbai Cleanliness Drive',
    campaignRef: 'MCGM-SWACHH-2026',
    upstreamAgencyId: 'MAH-OOH-AG-002',
    folder: 'mcgm/2026/10',
    createdAt: '2026-09-08',
    versions: [
      {
        upstreamVersionId: 'upv-mcgm-001-a',
        versionNumber: 1,
        mediaName: 'swachh-mumbai-v1.png',
        status: ReviewStatus.APPROVED,
        createdAt: '2026-09-10',
        submittedAt: '2026-09-12',
        adminApprovedAt: '2026-09-14',
        adminComments: 'Cleared by the SWM department.',
        action: {
          action: ActionType.APPROVE,
          comments: 'Cleared by the SWM department.',
          at: '2026-09-14',
        },
      },
      {
        upstreamVersionId: 'upv-mcgm-001-b',
        versionNumber: 2,
        mediaName: 'swachh-mumbai-v2.png',
        status: ReviewStatus.NEEDS_CHANGES,
        createdAt: '2026-10-08',
        submittedAt: '2026-10-10',
        adminComments:
          'Tagline set below the 24pt legibility minimum — please revise and resubmit.',
        action: {
          action: ActionType.REQUEST_CHANGES,
          comments: 'Tagline set below the 24pt legibility minimum — please revise and resubmit.',
          at: '2026-10-11',
        },
      },
    ],
  },
  {
    upstreamCreativeId: 'upcr-mhpd-001',
    brandUpstreamId: 'upbrand-mahapolice-001',
    creativeName: 'Road Safety Week 2026',
    campaignRef: 'MHPD-RSW-2026',
    upstreamAgencyId: 'MAH-OOH-AG-002',
    folder: 'mahapolice/2026/10',
    createdAt: '2026-09-21',
    versions: [
      {
        upstreamVersionId: 'upv-mhpd-001-a',
        versionNumber: 1,
        mediaName: 'road-safety-week-2026-v1.png',
        status: ReviewStatus.APPROVED,
        createdAt: '2026-09-23',
        submittedAt: '2026-09-25',
        adminApprovedAt: '2026-09-26',
        adminComments: 'Approved for Road Safety Week deployment.',
        action: {
          action: ActionType.APPROVE,
          comments: 'Approved for Road Safety Week deployment.',
          at: '2026-09-26',
        },
      },
      {
        upstreamVersionId: 'upv-mhpd-001-b',
        versionNumber: 2,
        mediaName: 'road-safety-week-2026-v2.png',
        status: ReviewStatus.ON_HOLD,
        createdAt: '2026-10-06',
        submittedAt: '2026-10-08',
        adminComments: 'Awaiting legal review of the cited statistic.',
        action: {
          action: ActionType.HOLD,
          comments: 'Awaiting legal review of the cited statistic.',
          at: '2026-10-09',
        },
      },
    ],
  },
  {
    upstreamCreativeId: 'upcr-msedcl-001',
    brandUpstreamId: 'upbrand-msedcl-001',
    creativeName: 'Go Green - Save Energy',
    campaignRef: 'MSEDCL-GOGREEN-2026',
    upstreamAgencyId: 'MAH-OOH-AG-001',
    folder: 'msedcl/2026/07',
    createdAt: '2026-06-15',
    versions: [
      {
        upstreamVersionId: 'upv-msedcl-001-a',
        versionNumber: 1,
        mediaName: 'save-energy-monsoon-v1.png',
        status: ReviewStatus.APPROVED,
        createdAt: '2026-06-18',
        submittedAt: '2026-06-20',
        adminApprovedAt: '2026-06-24',
        adminComments: 'Approved for the monsoon energy-saving drive.',
        action: {
          action: ActionType.APPROVE,
          comments: 'Approved for the monsoon energy-saving drive.',
          at: '2026-06-24',
        },
      },
      {
        upstreamVersionId: 'upv-msedcl-001-b',
        versionNumber: 2,
        mediaName: 'save-energy-monsoon-v2.png',
        status: ReviewStatus.REJECTED,
        createdAt: '2026-07-03',
        submittedAt: '2026-07-05',
        adminComments: 'Superseded logo mark — resubmit on the 2025 identity.',
        action: {
          action: ActionType.REJECT,
          comments: 'Superseded logo mark — resubmit on the 2025 identity.',
          at: '2026-07-06',
        },
      },
    ],
  },
  {
    upstreamCreativeId: 'upcr-msrtc-001',
    brandUpstreamId: 'upbrand-msrtc-001',
    creativeName: 'Safe Travels with ST',
    campaignRef: 'MSRTC-SAFE-2026',
    upstreamAgencyId: 'MAH-OOH-AG-002',
    folder: 'msrtc/2026/09',
    createdAt: '2026-09-14',
    versions: [
      {
        upstreamVersionId: 'upv-msrtc-001-a',
        versionNumber: 1,
        mediaName: 'safe-travels-with-st-v1.png',
        status: ReviewStatus.ON_HOLD,
        createdAt: '2026-09-16',
        submittedAt: '2026-09-18',
        adminComments: 'Brand flagged for compliance review — campaign on hold.',
        action: {
          action: ActionType.HOLD,
          comments: 'Brand flagged for compliance review — campaign on hold.',
          at: '2026-09-19',
        },
      },
    ],
  },
  {
    upstreamCreativeId: 'upcr-mtdc-002',
    brandUpstreamId: 'upbrand-mtdc-001',
    creativeName: 'Ajanta-Ellora Heritage Trail',
    campaignRef: 'MTDC-HERITAGE-2026',
    upstreamAgencyId: 'MAH-OOH-AG-001',
    folder: 'mtdc/2026/05',
    createdAt: '2026-04-15',
    versions: [
      {
        upstreamVersionId: 'upv-mtdc-002-a',
        versionNumber: 1,
        mediaName: 'ajanta-ellora-heritage-v1.png',
        status: ReviewStatus.APPROVED,
        createdAt: '2026-04-18',
        submittedAt: '2026-04-20',
        adminApprovedAt: '2026-04-22',
        adminComments: 'Approved for the heritage circuit promotion.',
        action: {
          action: ActionType.APPROVE,
          comments: 'Approved for the heritage circuit promotion.',
          at: '2026-04-22',
        },
      },
      {
        upstreamVersionId: 'upv-mtdc-002-b',
        versionNumber: 2,
        mediaName: 'ajanta-ellora-heritage-v2.png',
        status: ReviewStatus.WITHDRAWN,
        createdAt: '2026-04-30',
        submittedAt: '2026-05-02',
      },
    ],
  },
];

interface DocSeed {
  title: string;
  category: string;
  description: string;
  fileSizeBytes: number;
  publishedOn: string;
  path: string;
  isArchived?: boolean;
  archivedOn?: string;
}

const DOCS: DocSeed[] = [
  {
    title: 'OOH Advertising Policy 2026',
    category: 'Regulatory',
    description: 'State-wide policy for outdoor advertising bookings, clearances and compliance.',
    fileSizeBytes: 2516582,
    publishedOn: '2026-08-01',
    path: 'references/policies/ooh-advertising-policy-2026.pdf',
  },
  {
    title: 'Brand Guidelines — Maharashtra Tourism',
    category: 'Guidelines',
    description: 'Logo usage, colour palette and tone of voice for MTDC campaigns.',
    fileSizeBytes: 5348122,
    publishedOn: '2026-07-15',
    path: 'references/guidelines/mtdc-brand-guidelines.pdf',
  },
  {
    title: 'Campaign Approval SOP',
    category: 'SOP',
    description: 'Step-by-step approval workflow for state government campaigns.',
    fileSizeBytes: 1214908,
    publishedOn: '2026-06-10',
    path: 'references/sops/campaign-approval-sop.pdf',
  },
  {
    title: 'Creative Specification Sheet (OOH)',
    category: 'Technical',
    description: 'Required dimensions, safe areas and file formats for OOH creatives.',
    fileSizeBytes: 942080,
    publishedOn: '2026-06-01',
    path: 'references/technical/ooh-creative-spec-sheet.pdf',
  },
  {
    title: 'Emergency Broadcast Protocol',
    category: 'Regulatory',
    description: 'Fast-track clearance path for emergency public messaging.',
    fileSizeBytes: 1613824,
    publishedOn: '2026-09-01',
    path: 'references/policies/emergency-broadcast-protocol.pdf',
  },
  {
    title: 'Monsoon Campaign Deck 2025',
    category: 'Campaigns',
    description: 'Closed 2025 monsoon campaign assets and performance notes.',
    fileSizeBytes: 4197530,
    publishedOn: '2025-06-01',
    path: 'references/campaigns/monsoon-deck-2025.pdf',
    isArchived: true,
    archivedOn: '2026-03-31',
  },
];

interface LinkSeed {
  creativeUpstreamId: string;
  versionNumber: number;
  docTitle: string;
}

const LINKS: LinkSeed[] = [
  {
    creativeUpstreamId: 'upcr-mtdc-001',
    versionNumber: 1,
    docTitle: 'Brand Guidelines — Maharashtra Tourism',
  },
  {
    creativeUpstreamId: 'upcr-mtdc-001',
    versionNumber: 1,
    docTitle: 'Creative Specification Sheet (OOH)',
  },
  {
    creativeUpstreamId: 'upcr-mcgm-001',
    versionNumber: 1,
    docTitle: 'OOH Advertising Policy 2026',
  },
  {
    creativeUpstreamId: 'upcr-mhpd-001',
    versionNumber: 1,
    docTitle: 'Creative Specification Sheet (OOH)',
  },
  {
    creativeUpstreamId: 'upcr-msedcl-001',
    versionNumber: 1,
    docTitle: 'Campaign Approval SOP',
  },
];

interface AdvertSeed {
  upstreamAdvertId: string;
  creativeUpstreamId: string;
  versionNumber: number;
  lat: number;
  lng: number;
  address: string;
  city: string;
  zone: string;
  radiusKm: number;
  status: AdvertStatus;
  startDate: string;
  endDate: string;
  createdAt: string;
  imageHash: string;
}

const ADVERTS: AdvertSeed[] = [
  {
    upstreamAdvertId: 'upadv-mhpd-marine-001',
    creativeUpstreamId: 'upcr-mhpd-001',
    versionNumber: 1,
    lat: 18.9437,
    lng: 72.8234,
    address: 'Marine Drive Promenade, Churchgate',
    city: 'Mumbai',
    zone: 'South Mumbai',
    radiusKm: 5,
    status: AdvertStatus.LIVE,
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    createdAt: '2026-09-22',
    imageHash: '5e2d9f8a7b6c5d4e',
  },
  {
    upstreamAdvertId: 'upadv-mcgm-andheri-001',
    creativeUpstreamId: 'upcr-mcgm-001',
    versionNumber: 1,
    lat: 19.1157,
    lng: 72.8697,
    address: 'Western Express Highway, Andheri East',
    city: 'Mumbai',
    zone: 'Western Suburbs',
    radiusKm: 8,
    status: AdvertStatus.LIVE,
    startDate: '2026-09-15',
    endDate: '2026-12-15',
    createdAt: '2026-09-01',
    imageHash: '8b1c4d7e0f2a3b5c',
  },
  {
    upstreamAdvertId: 'upadv-mtdc-pune-001',
    creativeUpstreamId: 'upcr-mtdc-001',
    versionNumber: 1,
    lat: 18.5236,
    lng: 73.8478,
    address: 'Fergusson College Road, Shivajinagar',
    city: 'Pune',
    zone: 'Central Pune',
    radiusKm: 6,
    status: AdvertStatus.LIVE,
    startDate: '2026-10-05',
    endDate: '2027-01-05',
    createdAt: '2026-09-24',
    imageHash: '3f7a2b9c1d4e5f60',
  },
  {
    upstreamAdvertId: 'upadv-mtdc-nashik-001',
    creativeUpstreamId: 'upcr-mtdc-001',
    versionNumber: 1,
    lat: 20.0031,
    lng: 73.7701,
    address: 'College Road, Nashik',
    city: 'Nashik',
    zone: 'Nashik Central',
    radiusKm: 4,
    status: AdvertStatus.SCHEDULED,
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    createdAt: '2026-10-10',
    imageHash: '3f7a2b9c1d4e5f60',
  },
  {
    upstreamAdvertId: 'upadv-msedcl-nagpur-001',
    creativeUpstreamId: 'upcr-msedcl-001',
    versionNumber: 1,
    lat: 21.1458,
    lng: 79.0824,
    address: 'Sitabuldi Main Road, Nagpur',
    city: 'Nagpur',
    zone: 'Sitabuldi',
    radiusKm: 5,
    status: AdvertStatus.EXPIRED,
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    createdAt: '2026-06-15',
    imageHash: 'c1d2e3f4a5b6c7d8',
  },
  {
    upstreamAdvertId: 'upadv-msedcl-csn-001',
    creativeUpstreamId: 'upcr-msedcl-001',
    versionNumber: 1,
    lat: 19.8762,
    lng: 75.3433,
    address: 'Kranti Chowk, Chhatrapati Sambhajinagar',
    city: 'Chhatrapati Sambhajinagar',
    zone: 'Kranti Chowk',
    radiusKm: 4,
    status: AdvertStatus.PAUSED,
    startDate: '2026-09-01',
    endDate: '2026-11-30',
    createdAt: '2026-08-18',
    imageHash: 'c1d2e3f4a5b6c7d8',
  },
  {
    upstreamAdvertId: 'upadv-mtdc-gateway-001',
    creativeUpstreamId: 'upcr-mtdc-002',
    versionNumber: 1,
    lat: 18.922,
    lng: 72.8347,
    address: 'Gateway of India Precinct, Colaba',
    city: 'Mumbai',
    zone: 'South Mumbai',
    radiusKm: 3,
    status: AdvertStatus.EXPIRED,
    startDate: '2026-05-01',
    endDate: '2026-07-31',
    createdAt: '2026-04-12',
    imageHash: '9a8b7c6d5e4f3a2b',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🌱 Media-module seed (brand / creative / reference / advert)\n');

  const actor =
    (await prisma.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.user.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }));
  if (!actor) {
    throw new Error('No user found to attribute the seed rows to — create a super admin first.');
  }
  console.log(`  Actor: ${actor.email} (${actor.id})`);

  // ── Brands ────────────────────────────────────────────────────────────────
  console.log('\n→ Brands');
  const brandIds = new Map<string, string>();
  let brandsCreated = 0;
  for (const b of BRANDS) {
    const existing = await prisma.brand.findUnique({
      where: { upstreamBrandId: b.upstreamBrandId },
    });
    const row =
      existing ??
      (await prisma.brand.create({
        data: {
          upstreamBrandId: b.upstreamBrandId,
          brandName: b.brandName,
          industryCategory: b.industryCategory,
          contactEmail: b.contactEmail,
          address: b.address,
          upstreamAgencyId: b.upstreamAgencyId,
          createdAt: ts(b.createdAt),
          ...(b.isFlagged
            ? { isFlagged: true, flaggedBy: actor.id, flaggedOn: ts(b.flaggedOn!) }
            : {}),
        },
      }));
    if (!existing) brandsCreated++;
    brandIds.set(b.upstreamBrandId, row.id);
    console.log(`    ${existing ? 'exists ' : 'created'} ${b.brandName}`);
  }

  // ── Creatives + versions + review trail ───────────────────────────────────
  console.log('\n→ Creatives');
  let creativesCreated = 0;
  let versionsCreated = 0;
  let actionsCreated = 0;
  const versionIds = new Map<string, string>(); // `${creativeUpstreamId}:${n}` → id
  const latestVersion = new Map<string, { id: string; versionNumber: number }>();

  for (const c of CREATIVES) {
    const brandId = brandIds.get(c.brandUpstreamId);
    if (!brandId) throw new Error(`Brand not resolved for creative ${c.upstreamCreativeId}`);

    let creative = await prisma.creative.findUnique({
      where: { upstreamCreativeId: c.upstreamCreativeId },
    });
    if (!creative) {
      creative = await prisma.creative.create({
        data: {
          brandId,
          creativeName: c.creativeName,
          campaignRef: c.campaignRef,
          upstreamCreativeId: c.upstreamCreativeId,
          upstreamAgencyId: c.upstreamAgencyId,
          createdAt: ts(c.createdAt),
        },
      });
      creativesCreated++;
    }
    console.log(`    ${c.creativeName} (${creative.id})`);

    for (const v of c.versions) {
      const mediaUrl = `${S3_BASE}/creatives/${c.folder}/${v.mediaName}`;
      let version = await prisma.creativeVersion.findUnique({
        where: { upstreamVersionId: v.upstreamVersionId },
      });
      if (!version) {
        version = await prisma.creativeVersion.create({
          data: {
            creativeId: creative.id,
            versionNumber: v.versionNumber,
            mediaUrl,
            mediaType: 'Image',
            mediaName: v.mediaName,
            status: v.status,
            createdBy: actor.id,
            upstreamVersionId: v.upstreamVersionId,
            createdAt: ts(v.createdAt),
            submittedAt: ts(v.submittedAt),
            ...(v.adminApprovedAt
              ? { adminApprovedBy: actor.id, adminApprovedAt: ts(v.adminApprovedAt) }
              : {}),
            ...(v.adminComments ? { adminComments: v.adminComments } : {}),
          },
        });
        versionsCreated++;
      }
      versionIds.set(`${c.upstreamCreativeId}:${v.versionNumber}`, version.id);
      const prev = latestVersion.get(c.upstreamCreativeId);
      if (!prev || v.versionNumber > prev.versionNumber) {
        latestVersion.set(c.upstreamCreativeId, { id: version.id, versionNumber: v.versionNumber });
      }

      if (v.action) {
        const actionCount = await prisma.reviewAction.count({ where: { versionId: version.id } });
        if (actionCount === 0) {
          await prisma.reviewAction.create({
            data: {
              versionId: version.id,
              actorId: actor.id,
              action: v.action.action,
              comments: v.action.comments,
              createdAt: ts(v.action.at),
            },
          });
          actionsCreated++;
        }
      }
      console.log(`      v${v.versionNumber} ${v.status} ${version.id}`);
    }

    // Point creatives at their latest version, without ever clobbering data
    // that the live application may have already set.
    const latest = latestVersion.get(c.upstreamCreativeId);
    if (latest && creative.currentVersionId === null) {
      await prisma.creative.update({
        where: { id: creative.id },
        data: { currentVersionId: latest.id },
      });
    }
  }

  // ── Reference documents + creative links ──────────────────────────────────
  console.log('\n→ Reference documents');
  const docIds = new Map<string, string>();
  let docsCreated = 0;
  for (const d of DOCS) {
    const existing = await prisma.referenceDoc.findFirst({ where: { title: d.title } });
    const row =
      existing ??
      (await prisma.referenceDoc.create({
        data: {
          title: d.title,
          category: d.category,
          description: d.description,
          fileSizeBytes: d.fileSizeBytes,
          fileUrl: `${S3_BASE}/${d.path}`,
          publishedOn: ts(d.publishedOn),
          createdAt: ts(d.publishedOn),
          ...(d.isArchived ? { isArchived: true, archivedOn: ts(d.archivedOn!) } : {}),
        },
      }));
    if (!existing) docsCreated++;
    docIds.set(d.title, row.id);
    console.log(`    ${existing ? 'exists ' : 'created'} ${d.title}`);
  }

  console.log('\n→ Creative ↔ document links');
  let linksCreated = 0;
  for (const l of LINKS) {
    const versionId = versionIds.get(`${l.creativeUpstreamId}:${l.versionNumber}`);
    const docId = docIds.get(l.docTitle);
    if (!versionId || !docId) throw new Error(`Link target missing for ${l.docTitle}`);
    const existing = await prisma.creativeReference.findUnique({
      where: { versionId_docId: { versionId, docId } },
    });
    if (!existing) {
      await prisma.creativeReference.create({ data: { versionId, docId } });
      linksCreated++;
    }
  }
  console.log(`    ${linksCreated} created, ${LINKS.length - linksCreated} existing`);

  // ── Adverts (raw SQL — PostGIS geometry; no outbox events by design) ──────
  console.log('\n→ Adverts');
  let advertsCreated = 0;
  for (const a of ADVERTS) {
    const versionId = versionIds.get(`${a.creativeUpstreamId}:${a.versionNumber}`);
    if (!versionId) throw new Error(`Version target missing for advert ${a.upstreamAdvertId}`);
    const inserted = await prisma.$executeRawUnsafe(
      `INSERT INTO "Advert" ("id", "version_id", "location", "address_text", "status",
                             "start_date", "end_date", "city_name", "zone_name",
                             "radius_km", "image_hash", "upstream_advert_id", "created_at")
       SELECT $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6::"AdvertStatus",
              $7, $8, $9, $10, $11, $12, $13, $14
       WHERE NOT EXISTS (SELECT 1 FROM "Advert" WHERE "upstream_advert_id" = $13)`,
      randomUUID(),
      versionId,
      a.lng,
      a.lat,
      a.address,
      a.status,
      ts(a.startDate),
      ts(a.endDate),
      a.city,
      a.zone,
      a.radiusKm,
      a.imageHash,
      a.upstreamAdvertId,
      ts(a.createdAt),
    );
    if (inserted > 0) advertsCreated++;
    console.log(`    ${inserted > 0 ? 'created' : 'exists '} ${a.city} — ${a.address}`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(
    `  Brands:            ${brandsCreated} created / ${BRANDS.length - brandsCreated} existing`,
  );
  console.log(
    `  Creatives:         ${creativesCreated} created / ${CREATIVES.length - creativesCreated} existing`,
  );
  console.log(`  Versions:          ${versionsCreated} created`);
  console.log(`  Review actions:    ${actionsCreated} created`);
  console.log(
    `  Reference docs:    ${docsCreated} created / ${DOCS.length - docsCreated} existing`,
  );
  console.log(
    `  Creative links:    ${linksCreated} created / ${LINKS.length - linksCreated} existing`,
  );
  console.log(
    `  Adverts:           ${advertsCreated} created / ${ADVERTS.length - advertsCreated} existing`,
  );
  console.log('\n✅ Media seed complete.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
