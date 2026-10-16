import { LogType, Prisma, PrismaClient } from '@prisma/client';

/**
 * Log System seed — creates the category taxonomy for all three log streams
 * (SYSTEM, ACTIVITY, EMPLOYEE) plus ~400 realistic log rows spread over the
 * last 90 days, so pagination, filtering and the CSV export can be exercised
 * end to end. Action names are stored flat on each row (no action table).
 *
 * Idempotent: the taxonomy is upserted on its unique keys (same contract as
 * LogsService.record) and the rows are only inserted when `log` is empty.
 *
 * Run with `npm run prisma:seed:logs`.
 */

const prisma = new PrismaClient();

/** Deterministic PRNG (mulberry32) so every run produces the same dataset. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

interface SeedAction {
  name: string;
  /** Templates may use {user} {emp} {ref} {ip} tokens. */
  texts: string[];
}

interface SeedCategory {
  name: string;
  actions: SeedAction[];
}

const TAXONOMY: Record<LogType, SeedCategory[]> = {
  [LogType.SYSTEM]: [
    {
      name: 'Authentication',
      actions: [
        {
          name: 'Login',
          texts: ['User {user} logged in from {ip}', 'Session established for {user}'],
        },
        { name: 'Logout', texts: ['User {user} logged out', 'Session ended for {user}'] },
        {
          name: 'Failed Login',
          texts: [
            'Failed login attempt for {user} from {ip}',
            'Invalid password supplied for {user}',
          ],
        },
        {
          name: 'Password Reset',
          texts: ['Password reset requested for {user}', 'Password changed for {user}'],
        },
      ],
    },
    {
      name: 'Configuration',
      actions: [
        {
          name: 'Settings Updated',
          texts: [
            'Updated system setting referenced by {ref}',
            'Global configuration saved by {user}',
          ],
        },
        {
          name: 'Feature Flag Toggled',
          texts: ['Enabled feature flag {ref}', 'Disabled feature flag {ref}'],
        },
        {
          name: 'Integration Configured',
          texts: ['Reconfigured integration {ref}', 'API key rotated for integration {ref}'],
        },
      ],
    },
    {
      name: 'Security',
      actions: [
        {
          name: 'Role Changed',
          texts: [
            'Role of {user} changed from EMPLOYEE to ADMIN',
            'Role of {emp} downgraded to EMPLOYEE',
          ],
        },
        {
          name: 'Permission Updated',
          texts: ['Permissions updated for {user}', 'Access scope changed for {emp}'],
        },
        {
          name: 'Account Locked',
          texts: [
            'Account {user} locked after repeated failures',
            'Account {user} unlocked by administrator',
          ],
        },
      ],
    },
  ],
  [LogType.ACTIVITY]: [
    {
      name: 'Profile',
      actions: [
        {
          name: 'View Profile',
          texts: ['Viewed profile of {user}', 'Opened employee record {emp}'],
        },
        {
          name: 'Update Profile',
          texts: ['Updated profile details for {user}', 'Contact information changed for {emp}'],
        },
        {
          name: 'Change Avatar',
          texts: ['Profile picture updated for {user}', 'Avatar removed for {emp}'],
        },
      ],
    },
    {
      name: 'Leave',
      actions: [
        {
          name: 'Apply Leave',
          texts: ['Leave request {ref} raised by {user}', 'Applied for leave under {ref}'],
        },
        {
          name: 'Approve Leave',
          texts: ['Leave request {ref} approved by {user}', 'Approved leave for {emp}'],
        },
        {
          name: 'Reject Leave',
          texts: ['Leave request {ref} rejected by {user}', 'Rejected leave for {emp}'],
        },
        {
          name: 'Cancel Leave',
          texts: ['Leave request {ref} withdrawn by {user}', 'Cancelled leave for {emp}'],
        },
      ],
    },
    {
      name: 'Payroll',
      actions: [
        {
          name: 'Generate Payslip',
          texts: ['Payslip {ref} generated for {emp}', 'Payslip {ref} mailed to {user}'],
        },
        {
          name: 'Revise Salary',
          texts: ['Salary revised for {emp} under {ref}', 'Compensation revised for {user}'],
        },
        {
          name: 'Approve Bonus',
          texts: ['Bonus {ref} approved for {emp}', 'Performance bonus granted to {user}'],
        },
      ],
    },
    {
      name: 'Attendance',
      actions: [
        {
          name: 'Check In',
          texts: ['Checked in at {ip} for {emp}', 'Check-in recorded for {user}'],
        },
        {
          name: 'Check Out',
          texts: ['Checked out from {ip} for {emp}', 'Check-out recorded for {user}'],
        },
        {
          name: 'Correction Request',
          texts: [
            'Attendance correction {ref} raised by {user}',
            'Punch correction requested for {emp}',
          ],
        },
      ],
    },
  ],
  [LogType.EMPLOYEE]: [
    {
      name: 'Onboarding',
      actions: [
        {
          name: 'Create Employee',
          texts: ['Employee {emp} created by {user}', 'Joined employee record {emp} opened'],
        },
        {
          name: 'Upload Document',
          texts: ['Document {ref} uploaded for {emp}', 'Identity proof uploaded by {user}'],
        },
        {
          name: 'Complete Onboarding',
          texts: ['Onboarding completed for {emp}', 'Onboarding checklist closed for {user}'],
        },
      ],
    },
    {
      name: 'Employment',
      actions: [
        {
          name: 'Department Transfer',
          texts: ['{emp} transferred under {ref}', 'Department changed for {user}'],
        },
        {
          name: 'Promotion',
          texts: ['{emp} promoted under {ref}', 'Promotion approved for {user}'],
        },
        {
          name: 'Designation Change',
          texts: ['Designation updated for {emp}', 'Job title changed for {user}'],
        },
      ],
    },
    {
      name: 'Exit',
      actions: [
        {
          name: 'Resignation',
          texts: ['Resignation filed by {emp}', 'Relieving request raised by {user}'],
        },
        {
          name: 'Termination',
          texts: ['Employment of {emp} terminated under {ref}', 'Termination processed for {user}'],
        },
        {
          name: 'Exit Interview',
          texts: ['Exit interview scheduled for {emp}', 'Exit interview completed for {user}'],
        },
      ],
    },
  ],
};

const LOG_TYPES: LogType[] = [LogType.SYSTEM, LogType.ACTIVITY, LogType.EMPLOYEE];

const ROW_COUNTS: Record<LogType, number> = {
  [LogType.SYSTEM]: 150,
  [LogType.ACTIVITY]: 170,
  [LogType.EMPLOYEE]: 80,
};

/** Optional old/new detail payloads keyed by action name (JSON TEXT columns). */
const DETAILS: Record<string, [Record<string, string>, Record<string, string>]> = {
  'Update Profile': [{ phone: '+91 9000000000' }, { phone: '+91 9876543210' }],
  'Role Changed': [{ role: 'EMPLOYEE' }, { role: 'ADMIN' }],
  'Permission Updated': [{ scope: 'users:read' }, { scope: 'users:read,users:update' }],
  'Settings Updated': [{ session_timeout: '30m' }, { session_timeout: '45m' }],
  'Department Transfer': [{ department: 'Support' }, { department: 'Engineering' }],
  Promotion: [{ designation: 'Software Engineer' }, { designation: 'Senior Software Engineer' }],
  'Designation Change': [{ title: 'Associate' }, { title: 'Assistant Manager' }],
  'Revise Salary': [{ ctc: '1200000' }, { ctc: '1500000' }],
  'Approve Leave': [{ status: 'PENDING' }, { status: 'APPROVED' }],
  'Reject Leave': [{ status: 'PENDING' }, { status: 'REJECTED' }],
  'Feature Flag Toggled': [{ enabled: 'false' }, { enabled: 'true' }],
};

const USERS = Array.from({ length: 12 }, (_, i) => `usr_seed${String(i + 1).padStart(4, '0')}`);
const EMPS = Array.from({ length: 12 }, (_, i) => `EMP${String(i + 1).padStart(4, '0')}`);
const REF_PREFIXES = ['REQ', 'TCK', 'LV', 'PAY', 'DOC'];

const SPAN_DAYS = 90;
const BATCH_SIZE = 100;

interface TaxonomyIndex {
  categories: Map<string, number>;
}

/** Upsert every category, then return name → id lookups. */
async function ensureTaxonomy(): Promise<TaxonomyIndex> {
  const index: TaxonomyIndex = { categories: new Map() };

  for (const logtype of LOG_TYPES) {
    for (const category of TAXONOMY[logtype]) {
      const row = await prisma.logCategory.upsert({
        where: { name_typeEnum: { name: category.name, typeEnum: logtype } },
        create: { name: category.name, typeEnum: logtype },
        update: {},
      });
      index.categories.set(`${logtype}:${category.name}`, row.id);
    }
  }

  return index;
}

function render(
  template: string,
  ctx: { user: string; emp: string; ref: string; ip: string },
): string {
  return template
    .replace('{user}', ctx.user)
    .replace('{emp}', ctx.emp)
    .replace('{ref}', ctx.ref)
    .replace('{ip}', ctx.ip);
}

/** Build one log row — shared by the base seed and the mixed batch. */
function makeRow(
  index: TaxonomyIndex,
  logtype: LogType,
  rng: () => number,
  refSeq: { value: number },
  createdAt: Date,
): Prisma.LogCreateManyInput {
  const category = pick(rng, TAXONOMY[logtype]);
  const action = pick(rng, category.actions);

  const user = pick(rng, USERS);
  const emp = pick(rng, EMPS);
  const ref = `${pick(rng, REF_PREFIXES)}-${(refSeq.value += 1)}`;
  const ip = `10.0.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}`;
  const ctx = { user, emp, ref, ip };

  // Every row carries a sentence — actionText is what free-text search
  // matches on, so it is never left null.
  const actionText = render(pick(rng, action.texts), ctx);

  const detail = DETAILS[action.name];
  const useDetail = detail !== undefined && rng() < 0.7;

  return {
    typeEnum: logtype,
    categoryId: index.categories.get(`${logtype}:${category.name}`) ?? null,
    actionName: action.name,
    actionText,
    userId: rng() < 0.9 ? user : null,
    empId: rng() < 0.8 ? emp : null,
    oldDetail: useDetail ? JSON.stringify(detail[0]) : null,
    newDetail: useDetail ? JSON.stringify(detail[1]) : null,
    createdAt,
  };
}

/** Build the base log row set — deterministic for a given seed. */
function buildRows(index: TaxonomyIndex): Prisma.LogCreateManyInput[] {
  const rng = mulberry32(20261013);
  const rows: Prisma.LogCreateManyInput[] = [];
  const now = Date.now();
  const spanMs = SPAN_DAYS * 24 * 60 * 60 * 1000;
  const refSeq = { value: 1000 };

  for (const logtype of LOG_TYPES) {
    for (let i = 0; i < ROW_COUNTS[logtype]; i += 1) {
      rows.push(makeRow(index, logtype, rng, refSeq, new Date(now - Math.floor(rng() * spanMs))));
    }
  }

  return rows;
}

/**
 * Interleaved ACTIVITY / SYSTEM / EMPLOYEE rows spread evenly across the
 * date span, so a single page shows a realistic mix of all three streams.
 * Deterministic: same seed → same rows.
 */
function buildMixedRows(
  index: TaxonomyIndex,
  total: number,
  startMs: number,
  spanMs: number,
): Prisma.LogCreateManyInput[] {
  const rng = mulberry32(987654321);
  const rows: Prisma.LogCreateManyInput[] = [];
  const refSeq = { value: 5000 };

  for (let i = 0; i < total; i += 1) {
    // Round-robin the streams so every group of 3 has one of each.
    const logtype = LOG_TYPES[i % LOG_TYPES.length];
    const createdAt = new Date(
      startMs + Math.floor((i / total) * spanMs) - Math.floor(rng() * 3600_000),
    );
    rows.push(makeRow(index, logtype, rng, refSeq, createdAt));
  }

  return rows;
}

/** action name → templates, used to repair rows whose actionText is null. */
function buildTextIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const logtype of LOG_TYPES) {
    for (const category of TAXONOMY[logtype]) {
      for (const action of category.actions) {
        index.set(action.name, action.texts);
      }
    }
  }
  return index;
}

/**
 * Repair pass: any pre-existing row with a null actionText gets a rendered
 * sentence from its action's templates, so free-text search always finds it.
 * Idempotent — only touches rows where actionText IS NULL.
 */
async function backfillNullActionText(): Promise<number> {
  const textsByAction = buildTextIndex();
  const nulls = await prisma.log.findMany({
    where: { actionText: null },
    select: {
      id: true,
      userId: true,
      empId: true,
      actionName: true,
    },
  });

  let updated = 0;
  for (const row of nulls) {
    const rng = mulberry32(row.id);
    const templates = row.actionName ? textsByAction.get(row.actionName) : undefined;
    if (!templates || templates.length === 0) {
      continue;
    }

    const ctx = {
      user: row.userId ?? pick(rng, USERS),
      emp: row.empId ?? pick(rng, EMPS),
      ref: `${pick(rng, REF_PREFIXES)}-${9000 + row.id}`,
      ip: `10.0.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}`,
    };

    await prisma.log.update({
      where: { id: row.id },
      data: { actionText: render(pick(rng, templates), ctx) },
    });
    updated += 1;
  }

  return updated;
}

/** Rows to append when `--mix` is passed — one third of each stream. */
const MIX_TOTAL = 300;

async function main(): Promise<void> {
  const taxonomy = await ensureTaxonomy();
  console.log(`Taxonomy ready: ${taxonomy.categories.size} categories`);

  const repaired = await backfillNullActionText();
  if (repaired > 0) {
    console.log(`Backfilled actionText on ${repaired} rows.`);
  }

  const existing = await prisma.log.count();

  // `--mix` appends an interleaved ACTIVITY/SYSTEM/EMPLOYEE batch on top of
  // whatever is already there, without touching the existing rows.
  if (process.argv.includes('--mix')) {
    const oldest = await prisma.log.findFirst({ orderBy: { createdAt: 'asc' } });
    const newest = await prisma.log.findFirst({ orderBy: { createdAt: 'desc' } });
    const startMs = oldest?.createdAt.getTime() ?? Date.now() - SPAN_DAYS * 86_400_000;
    const spanMs = (newest?.createdAt.getTime() ?? Date.now()) - startMs || 86_400_000;

    const rows = buildMixedRows(taxonomy, MIX_TOTAL, startMs, spanMs);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await prisma.log.createMany({ data: rows.slice(i, i + BATCH_SIZE) });
    }

    console.log(`Appended ${rows.length} mixed rows (ACTIVITY / SYSTEM / EMPLOYEE).`);
  } else if (existing > 0) {
    console.log(`log table already holds ${existing} rows — skipping row insert.`);
    return;
  } else {
    const rows = buildRows(taxonomy);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await prisma.log.createMany({ data: rows.slice(i, i + BATCH_SIZE) });
    }
    console.log(`Seeded ${rows.length} log rows.`);
  }

  const total = await prisma.log.count();
  const byType = await prisma.log.groupBy({ by: ['typeEnum'], _count: { _all: true } });
  console.log(`Table total: ${total}`);
  console.log(byType.map((b) => `  ${b.typeEnum}: ${b._count._all}`).join('\n'));
}

main()
  .then(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
