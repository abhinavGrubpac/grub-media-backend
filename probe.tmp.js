"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const p = new client_1.PrismaClient();
(async () => {
    const rows = (await p.$queryRawUnsafe(`
    SELECT l.id, c.name AS cat, a.name AS act, l."referenceId", l."newDetail", l."actionText"
    FROM "log" l
    LEFT JOIN "log_categories" c ON c.id = l."categoryId"
    LEFT JOIN "log_action" a ON a.id = l."actionId"
    WHERE l."createdAt" > NOW() - INTERVAL '15 minutes'
    ORDER BY l.id DESC LIMIT 16
  `));
    for (const r of rows) {
        let target = '';
        try {
            target = JSON.parse(r.newDetail ?? '{}')?.target ?? '(none)';
        }
        catch {
            target = '(unparsed)';
        }
        console.log(`#${r.id} ${r.cat}/${r.act}`);
        console.log(`     ticket=${r.referenceId}  target=${target}`);
        console.log(`     ${r.actionText}`);
    }
    await p.$disconnect();
})();
//# sourceMappingURL=probe.tmp.js.map