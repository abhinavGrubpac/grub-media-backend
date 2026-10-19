# Permission Catalog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing ad-hoc permission catalog with a 36-permission, 5-module catalog that matches the Manage Roles UI exactly (Dashboard ×2, Employees ×10, Roles ×4, Clients ×6, Support ×14).

**Architecture:** Add a `label` column to the `Permission` model so the API can return human-readable display names without a client-side map. Wipe the old catalog (non-custom rows) in the seed before re-inserting, so upserts on the new `module_page_action` keys land cleanly. Update the four seeded bundles to reference the new permission keys.

**Tech Stack:** NestJS, Prisma 6, PostgreSQL (RDS), ts-node seed scripts.

**Spec:** `docs/superpowers/plans/2026-10-16-permission-catalog-redesign.md` (this file) + UI screenshot (`Mid-level admin` role management screen).

## Global Constraints

- Prisma migration must use `prisma migrate dev` (creates file + applies to RDS in one step).
- Seed is idempotent: running it twice must not duplicate rows.
- Non-custom permissions (`custom = false`) are owned by the catalog; they may be deleted and re-inserted. Custom permissions (`custom = true`) are user-created and must never be touched by the seed.
- `BundlePermission` rows cascade-delete when their `Permission` is deleted — the FK is `onDelete: Cascade` — so clearing old catalog permissions also clears stale bundle-permission links.
- The four seeded bundles (Viewer, HR Manager, Content Manager, Admin Full Access) must be updated to reference new permission keys.
- Code-level `permissions.ts` (`ROLE_PERMISSIONS`) is a separate RBAC layer — do **not** touch it.
- Do not rename or change the `@@unique([module, page, action])` constraint.

## Catalog Reference

The complete new catalog (36 permissions):

```
── dashboard (2) ──────────────────────────────────────────────
dashboard | overview  | read            | View dashboard
dashboard | overview  | export          | Export dashboard

── employees (10) ─────────────────────────────────────────────
employees | list      | view_active     | View active employees
employees | list      | view_suspended  | View suspended employees
employees | list      | view_dismissed  | View dismissed employees
employees | list      | view_logs       | View employee logs
employees | list      | create          | Add employees
employees | list      | export          | Export employees
employees | detail    | update          | Edit employees
employees | detail    | delete          | Delete employees
employees | detail    | suspend         | Suspend employees
employees | detail    | activate        | Activate employees

── roles (4) ──────────────────────────────────────────────────
roles | list   | read    | View roles
roles | list   | create  | Create roles
roles | detail | update  | Edit roles
roles | detail | delete  | Delete roles

── clients (6) ────────────────────────────────────────────────
clients | list   | read    | View clients
clients | list   | create  | Add clients
clients | list   | export  | Export clients
clients | detail | update  | Edit clients
clients | detail | delete  | Delete clients
clients | detail | suspend | Suspend clients

── support (14) ───────────────────────────────────────────────
support | categories | read    | View help categories
support | categories | create  | Create help categories
support | categories | update  | Edit help categories
support | categories | delete  | Delete help categories
support | faqs       | read    | View help FAQs
support | faqs       | create  | Create help FAQs
support | faqs       | update  | Edit help FAQs
support | faqs       | delete  | Delete help FAQs
support | tickets    | read    | View support tickets
support | tickets    | create  | Create support tickets
support | tickets    | update  | Edit support tickets
support | tickets    | delete  | Delete support tickets
support | tickets    | close   | Close support tickets
support | tickets    | export  | Export support tickets
```

## Review Focus

1. **Old catalog rows not cleaned up** — if `Permission.deleteMany({ where: { custom: false } })` runs before re-insert, stale entries disappear; if it's skipped, old rows like `users.list.read` linger and confuse the UI.
2. **BundlePermission orphans** — the FK is `onDelete: Cascade` but that only fires on `Permission` delete; if the seed skips the delete step, old bundle-permission links referencing deleted (by key change) permissions survive as orphans.
3. **UserBundle rows pointing to now-empty bundles** — after the bundle permissions are rebuilt, the four seeded bundles should still have permissions; verify the bundle upsert references at least one valid permission key.
4. **label NULL for custom permissions** — the column is nullable; if the UI ever sorts/filters by label it must handle `null` gracefully; tested by checking that the seed leaves `custom=true` rows untouched.
5. **Migration runs against RDS without a local shadow DB** — `prisma migrate dev` creates a shadow DB internally; this works on RDS only if the DB user has `CREATE DATABASE` rights. Fallback: write the SQL migration manually and use `prisma migrate deploy`.

---

## Task 1: Add `label` to Permission model + migration

**Files:**
- Modify: `prisma/schema.prisma` — add `label String?` to `Permission` model
- Create: `prisma/migrations/20261016000000_add_permission_label/migration.sql`

**Interfaces:**
- Produces: `Permission` rows now carry a `label` column (nullable TEXT). `GET /v1/access/permissions` automatically includes it via Prisma's default select.

- [ ] **Step 1: Update schema.prisma**

In `prisma/schema.prisma`, add `label` to the `Permission` model:

```prisma
model Permission {
  id                String             @id @default(cuid())
  module            String
  page              String
  action            String
  label             String?
  custom            Boolean            @default(false)
  createdAt         DateTime           @default(now())
  bundlePermissions BundlePermission[]

  @@unique([module, page, action])
}
```

- [ ] **Step 2: Try prisma migrate dev**

```bash
npx prisma migrate dev --name add_permission_label
```

If this fails (RDS user lacks CREATE DATABASE for shadow DB), proceed to Step 2b.

- [ ] **Step 2b (fallback): Write migration manually**

Create `prisma/migrations/20261016000000_add_permission_label/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Permission" ADD COLUMN "label" TEXT;
```

Then apply it:

```bash
npx prisma migrate resolve --applied 20261016000000_add_permission_label
npx prisma migrate deploy
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Verify schema compiles**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(permissions): add label column to Permission model"
```

---

## Task 2: Redesign permission catalog in seed + rebuild bundles

**Files:**
- Modify: `prisma/seed.ts` — replace `PERMISSION_DEFS`, add catalog-cleanup step, update `seedBundles`

**Interfaces:**
- Consumes: `label String?` on Permission (Task 1)
- Produces: 36 catalog permissions seeded; four bundles rebuilt with new permission keys; old catalog rows removed.

- [ ] **Step 1: Replace PERMISSION_DEFS in seed.ts**

Replace the entire `PERMISSION_DEFS` constant and its type:

```typescript
const PERMISSION_DEFS: { module: string; page: string; action: string; label: string }[] = [
  // ── Dashboard (2) ──────────────────────────────────────────
  { module: 'dashboard', page: 'overview', action: 'read',           label: 'View dashboard' },
  { module: 'dashboard', page: 'overview', action: 'export',         label: 'Export dashboard' },

  // ── Employees (10) ─────────────────────────────────────────
  { module: 'employees', page: 'list',   action: 'view_active',    label: 'View active employees' },
  { module: 'employees', page: 'list',   action: 'view_suspended', label: 'View suspended employees' },
  { module: 'employees', page: 'list',   action: 'view_dismissed', label: 'View dismissed employees' },
  { module: 'employees', page: 'list',   action: 'view_logs',      label: 'View employee logs' },
  { module: 'employees', page: 'list',   action: 'create',         label: 'Add employees' },
  { module: 'employees', page: 'list',   action: 'export',         label: 'Export employees' },
  { module: 'employees', page: 'detail', action: 'update',         label: 'Edit employees' },
  { module: 'employees', page: 'detail', action: 'delete',         label: 'Delete employees' },
  { module: 'employees', page: 'detail', action: 'suspend',        label: 'Suspend employees' },
  { module: 'employees', page: 'detail', action: 'activate',       label: 'Activate employees' },

  // ── Roles (4) ──────────────────────────────────────────────
  { module: 'roles', page: 'list',   action: 'read',   label: 'View roles' },
  { module: 'roles', page: 'list',   action: 'create', label: 'Create roles' },
  { module: 'roles', page: 'detail', action: 'update', label: 'Edit roles' },
  { module: 'roles', page: 'detail', action: 'delete', label: 'Delete roles' },

  // ── Clients (6) ────────────────────────────────────────────
  { module: 'clients', page: 'list',   action: 'read',    label: 'View clients' },
  { module: 'clients', page: 'list',   action: 'create',  label: 'Add clients' },
  { module: 'clients', page: 'list',   action: 'export',  label: 'Export clients' },
  { module: 'clients', page: 'detail', action: 'update',  label: 'Edit clients' },
  { module: 'clients', page: 'detail', action: 'delete',  label: 'Delete clients' },
  { module: 'clients', page: 'detail', action: 'suspend', label: 'Suspend clients' },

  // ── Support (14) ───────────────────────────────────────────
  { module: 'support', page: 'categories', action: 'read',    label: 'View help categories' },
  { module: 'support', page: 'categories', action: 'create',  label: 'Create help categories' },
  { module: 'support', page: 'categories', action: 'update',  label: 'Edit help categories' },
  { module: 'support', page: 'categories', action: 'delete',  label: 'Delete help categories' },
  { module: 'support', page: 'faqs',       action: 'read',    label: 'View help FAQs' },
  { module: 'support', page: 'faqs',       action: 'create',  label: 'Create help FAQs' },
  { module: 'support', page: 'faqs',       action: 'update',  label: 'Edit help FAQs' },
  { module: 'support', page: 'faqs',       action: 'delete',  label: 'Delete help FAQs' },
  { module: 'support', page: 'tickets',    action: 'read',    label: 'View support tickets' },
  { module: 'support', page: 'tickets',    action: 'create',  label: 'Create support tickets' },
  { module: 'support', page: 'tickets',    action: 'update',  label: 'Edit support tickets' },
  { module: 'support', page: 'tickets',    action: 'delete',  label: 'Delete support tickets' },
  { module: 'support', page: 'tickets',    action: 'close',   label: 'Close support tickets' },
  { module: 'support', page: 'tickets',    action: 'export',  label: 'Export support tickets' },
];
```

- [ ] **Step 2: Add catalog-cleanup to seedPermissions()**

Replace the `seedPermissions` function:

```typescript
async function seedPermissions(): Promise<Map<string, string>> {
  // Wipe old catalog permissions (non-custom). BundlePermission rows cascade-delete.
  await prisma.permission.deleteMany({ where: { custom: false } });

  const permissionIdMap = new Map<string, string>();
  for (const def of PERMISSION_DEFS) {
    const perm = await prisma.permission.create({
      data: { module: def.module, page: def.page, action: def.action, label: def.label, custom: false },
    });
    permissionIdMap.set(`${def.module}:${def.page}:${def.action}`, perm.id);
  }

  console.log(`  Created ${PERMISSION_DEFS.length} permissions`);
  return permissionIdMap;
}
```

> Note: we switch from `upsert` to `deleteMany` + `create` because module/page/action keys are all changing — there's nothing to upsert onto.

- [ ] **Step 3: Update seedBundles() with new permission keys**

Replace the `bundleDefs` array inside `seedBundles()`:

```typescript
const bundleDefs: {
  name: string;
  description: string;
  createdBy: string;
  permKeys: string[];
}[] = [
  {
    name: 'Viewer',
    description: 'Read-only access across all modules',
    createdBy: superAdminId,
    permKeys: [
      'dashboard:overview:read',
      'employees:list:view_active',
      'roles:list:read',
      'clients:list:read',
      'support:categories:read',
      'support:faqs:read',
      'support:tickets:read',
    ],
  },
  {
    name: 'HR Manager',
    description: 'Manage employees and view audit logs',
    createdBy: superAdminId,
    permKeys: [
      'dashboard:overview:read',
      'dashboard:overview:export',
      'employees:list:view_active',
      'employees:list:view_suspended',
      'employees:list:view_dismissed',
      'employees:list:view_logs',
      'employees:list:create',
      'employees:list:export',
      'employees:detail:update',
      'employees:detail:suspend',
      'employees:detail:activate',
    ],
  },
  {
    name: 'Content Manager',
    description: 'Full access to support/help content',
    createdBy: adminIds[0] ?? superAdminId,
    permKeys: [
      'dashboard:overview:read',
      'support:categories:read',
      'support:categories:create',
      'support:categories:update',
      'support:categories:delete',
      'support:faqs:read',
      'support:faqs:create',
      'support:faqs:update',
      'support:faqs:delete',
    ],
  },
  {
    name: 'Admin Full Access',
    description: 'Full access for admins except super-admin operations',
    createdBy: superAdminId,
    permKeys: PERMISSION_DEFS.map((d) => `${d.module}:${d.page}:${d.action}`),
  },
];
```

- [ ] **Step 4: Run the seed**

```bash
npm run prisma:seed
```

Expected output:
```
→ Permissions
  Created 36 permissions

→ Organisations
  ...

→ Permission Bundles
  Bundle "Viewer": 7 permissions
  Bundle "HR Manager": 11 permissions
  Bundle "Content Manager": 9 permissions
  Bundle "Admin Full Access": 36 permissions
```

- [ ] **Step 5: Verify in DB — permission count**

```bash
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.permission.groupBy({ by: ['module'], _count: { id: true }, orderBy: { module: 'asc' } })
  .then(r => { r.forEach(x => console.log(x.module, x._count.id)); p.\$disconnect(); });
"
```

Expected:
```
clients  6
dashboard 2
employees 10
roles    4
support  14
```

- [ ] **Step 6: Verify bundles still have permissions**

```bash
npx ts-node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.permissionBundle.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } })
  .then(r => { r.forEach(b => console.log(b.name, b.permissions.length)); p.\$disconnect(); });
"
```

Expected: Viewer (7), HR Manager (11), Content Manager (9), Admin Full Access (36).

- [ ] **Step 7: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(permissions): redesign catalog to match Manage Roles UI (36 permissions, 5 modules)"
```
