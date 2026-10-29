/**
 * Idempotent backfill for the advert daily display window.
 *
 * `start_date`/`end_date` remain the exact campaign timestamps. This script
 * only fills adverts whose recurring `time_slot_start`/`time_slot_end` pair is
 * missing. When the exact campaign timestamps carry a usable time-of-day
 * range (start < end), that range is reused; otherwise a safe 06:00–23:00
 * advertising window is applied.
 *
 * Usage: npx ts-node prisma/backfill-advert-time-slots.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_WINDOW = { start: '06:00', end: '23:00' };

function utcTime(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function deriveWindow(startDate: Date, endDate: Date): { start: string; end: string } {
  const start = utcTime(startDate);
  const end = utcTime(endDate);
  if (start && end && start < end) return { start, end };
  return { ...DEFAULT_WINDOW };
}

async function main(): Promise<void> {
  const missingDates = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "Advert"
    WHERE "start_date" IS NULL OR "end_date" IS NULL
  `;
  const missingDateCount = Number(missingDates[0]?.count ?? 0);

  const rows = await prisma.advert.findMany({
    where: { OR: [{ timeSlotStart: null }, { timeSlotEnd: null }] },
    select: {
      id: true,
      upstreamAdvertId: true,
      startDate: true,
      endDate: true,
      timeSlotStart: true,
      timeSlotEnd: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  let updated = 0;
  for (const row of rows) {
    const window = deriveWindow(row.startDate, row.endDate);
    await prisma.advert.update({
      where: { id: row.id },
      data: { timeSlotStart: window.start, timeSlotEnd: window.end },
    });
    updated += 1;
    console.log(`  updated ${row.upstreamAdvertId ?? row.id}: ${window.start}-${window.end}`);
  }

  const remainingTimes = await prisma.advert.count({
    where: { OR: [{ timeSlotStart: null }, { timeSlotEnd: null }] },
  });

  console.log('\nAdvert daily-window backfill');
  console.log(`  time windows updated: ${updated}`);
  console.log(`  time windows still missing: ${remainingTimes}`);
  console.log(`  adverts with missing date range: ${missingDateCount}`);
  if (missingDateCount > 0) {
    console.warn(
      '  WARNING: date gaps were found; populate start_date/end_date from the upstream schedule before re-running searches.',
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
