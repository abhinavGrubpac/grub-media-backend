const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    // Use select to avoid fetching columns that might be causing issues with the Prisma client version/db sync
    const adverts = await p.advert.findMany({
      where: { imageHash: { not: null } },
      select: {
        id: true,
        imageHash: true,
        version: {
          select: {
            creative: {
              select: {
                creativeName: true,
                brand: { select: { brandName: true } }
              }
            },
            mediaUrl: true
          }
        }
      }
    });
    console.log('--- Hashed Adverts ---');
    adverts.forEach(a => {
      console.log(`ID: ${a.id} | Hash: ${a.imageHash} | Creative: ${a.version?.creative?.creativeName} | Brand: ${a.version?.creative?.brand?.brandName} | Media: ${a.version?.mediaUrl}`);
    });
    const versions = await p.creativeVersion.findMany({
      where: { status: 'APPROVED', imageHash: { not: null } },
      select: {
        id: true,
        imageHash: true,
        creative: {
          select: {
            creativeName: true,
            brand: { select: { brandName: true } }
          }
        },
        mediaUrl: true
      }
    });
    console.log('\n--- Hashed approved versions (non-adverts) ---');
    versions.forEach(v => {
      console.log(`ID: ${v.id} | Hash: ${v.imageHash} | Creative: ${v.creative?.creativeName} | Brand: ${v.creative?.brand?.brandName} | Media: ${v.mediaUrl}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
    process.exit(0);
  }
})();