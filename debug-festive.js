const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const versionId = 'cmvorrio40009f7rwh739j14s';
    const version = await p.creativeVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        status: true,
        imageHash: true,
        creativeId: true,
      }
    });

    if (!version) {
      console.log('Version not found');
      process.exit(0);
    }

    console.log('--- Festive Ad Debug Info ---');
    console.log(`Version ID: ${version.id}`);
    console.log(`Status: ${version.status}`);
    console.log(`Image Hash: ${version.imageHash}`);
    console.log(`Creative ID: ${version.creativeId}`);
    
    const adverts = await p.advert.findMany({
      where: { versionId: versionId },
      select: {
        id: true,
        status: true,
        imageHash: true
      }
    });
    
    console.log(`Linked Adverts Count: ${adverts.length}`);
    adverts.forEach(adv => {
      console.log(`  -> Advert ID: ${adv.id} | Status: ${adv.status} | Image Hash: ${adv.imageHash}`);
    });

  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
    process.exit(0);
  }
})();