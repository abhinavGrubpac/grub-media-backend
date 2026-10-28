/**
 * One-time backfill for Manage Brands metadata.
 *
 * Agency names are projected from the upstream AgencyRef rows; this script
 * creates the two demo agencies referenced by the seeded brands when missing
 * and links brands that have no agency yet. Parent company is a brand-level
 * identity field introduced after the initial seed, so existing rows need it
 * filled once. Both operations are idempotent: agencies are create-if-missing,
 * and agency links / parent companies only fill NULLs.
 *
 * Usage: npx ts-node prisma/backfill-brand-parent-companies.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const AGENCIES = [
  {
    upstreamAgencyId: 'MAH-OOH-AG-001',
    agencyName: 'The Times Group',
    city: 'Mumbai',
    address: 'The Times of India Building, Dr. D.N. Road, Mumbai - 400001',
  },
  {
    upstreamAgencyId: 'MAH-OOH-AG-002',
    agencyName: 'Dentsu',
    city: 'Mumbai',
    address: 'Dentsu India, Lower Parel, Mumbai - 400013',
  },
];

/** Every demo brand should resolve to an agency in Manage Brands. */
const BRAND_AGENCIES: Record<string, string> = {
  'Apollo Hospitals Enterprise Ltd': 'MAH-OOH-AG-002',
  'Brihanmumbai Municipal Corporation': 'MAH-OOH-AG-002',
  'Maharashtra Police': 'MAH-OOH-AG-002',
  'Maharashtra State Electricity Distribution Co. Ltd': 'MAH-OOH-AG-001',
  'Maharashtra State Road Transport Corporation': 'MAH-OOH-AG-002',
  'Maharashtra Tourism Development Corporation': 'MAH-OOH-AG-001',
  'Tata Motors Passenger Vehicles': 'MAH-OOH-AG-001',
};

const PARENT_COMPANIES: Record<string, string> = {
  'Apollo Hospitals Enterprise Ltd': 'Apollo Hospitals Group',
  'Brihanmumbai Municipal Corporation': 'Government of Maharashtra',
  'Maharashtra Police': 'Government of Maharashtra',
  'Maharashtra State Electricity Distribution Co. Ltd': 'Government of Maharashtra',
  'Maharashtra State Road Transport Corporation': 'Government of Maharashtra',
  'Maharashtra Tourism Development Corporation': 'Government of Maharashtra',
  'Tata Motors Passenger Vehicles': 'Tata Motors Limited',
};

async function main(): Promise<void> {
  let agenciesCreated = 0;
  for (const agency of AGENCIES) {
    const existing = await prisma.agencyRef.findUnique({
      where: { upstreamAgencyId: agency.upstreamAgencyId },
    });
    if (!existing) {
      await prisma.agencyRef.create({ data: agency });
      agenciesCreated++;
    }
  }

  let agenciesLinked = 0;
  for (const [brandName, upstreamAgencyId] of Object.entries(BRAND_AGENCIES)) {
    const result = await prisma.brand.updateMany({
      where: { brandName, upstreamAgencyId: null },
      data: { upstreamAgencyId },
    });
    agenciesLinked += result.count;
  }

  let parentCompaniesUpdated = 0;
  for (const [brandName, parentCompany] of Object.entries(PARENT_COMPANIES)) {
    const result = await prisma.brand.updateMany({
      where: { brandName, parentCompany: null },
      data: { parentCompany },
    });
    parentCompaniesUpdated += result.count;
  }

  console.log(
    `Backfill complete: ${agenciesCreated} agencies created, ` +
      `${agenciesLinked} brands linked to agencies, ` +
      `${parentCompaniesUpdated} parent companies updated.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
