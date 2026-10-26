const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const v = await p.creativeVersion.findUnique({ where: { id: 'cmvorrio40009f7rwh739j14s' } });
    console.log('Hash:', v?.imageHash);
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
    process.exit(0);
  }
})();