# Manage Roles CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five missing Manage Roles endpoints (bundle user list, bundle edit, bundle delete, bulk reassign) plus role-hierarchy guards, so the backend fully supports the Manage Roles UI shown in the design screenshots.

**Architecture:** All changes are confined to `access.dto.ts`, `access.controller.ts`, and `access.service.ts`. No new files. Each new endpoint follows the existing pattern: service method does DB work + audit log, controller method calls service + optional view log. The self-edit guard is a private service helper called at the top of mutating methods.

**Tech Stack:** NestJS v11, Prisma 6, PostgreSQL, class-validator, ts-node.

**Spec:** Design screenshots (Manage Roles UI) reviewed in session on 2026-10-16.

## Global Constraints

- All endpoints remain under `@Roles(ADMIN, SUPER_ADMIN)` — no change to auth layer.
- SUPER_ADMIN bypasses the self-edit guard; ADMIN is subject to it.
- `prisma migrate deploy` for any schema changes (non-interactive RDS). No schema changes in this plan — all new behaviour is application-level.
- Audit every mutating operation via `logs.record()` in the EMPLOYEE stream, category `'Access Management'`.
- Do not touch `ROLE_PERMISSIONS` in `permissions.ts` — that is the separate RBAC layer.
- Verification gate: `npx tsc --noEmit` → 0 errors after every task.

## Review Focus

1. **Reassign transaction atomicity** — if the createMany for the target bundle partially fails after the deleteMany of the source bundle, users lose their bundle assignment entirely. The reassign must run inside `prisma.$transaction`.
2. **Self-edit guard bypass for SUPER_ADMIN** — if the guard checks `userBundle` without first checking `actor.role`, a SUPER_ADMIN who is also assigned to a bundle (e.g. "Admin Full Access") would be blocked from editing it.
3. **PATCH replaces permissions, not merges** — the edit flow deletes all existing `BundlePermission` rows and recreates; if the caller sends an empty `permissionIds` array, the bundle ends up with zero permissions silently. Should throw `BadRequestException` if `permissionIds` is present but empty.
4. **DELETE with assigned users** — deleting a bundle that still has `UserBundle` rows: the FK is `onDelete: Cascade` so the users silently lose the bundle. The endpoint should return the affected user count in the response so the caller can warn the user.
5. **`GET /bundles/:id/users` leaking suspended/deleted users** — `UserBundle` has no soft-delete; it points to `User` which does have `deletedAt`. The user list should filter `deletedAt: null`.

---

## Task 1: Bundle list with user count + GET bundle users

**Files:**
- Modify: `src/modules/users/services/access.service.ts`
- Modify: `src/modules/users/controllers/access.controller.ts`

**Interfaces:**
- Produces:
  - `bundles()` now returns `{ id, name, description, createdBy, createdAt, updatedAt, permissions: [...], _count: { users: N } }[]`
  - New `bundleUsers(bundleId)` returns `{ userId, bundleId, assignedBy, createdAt, user: { id, firstName, lastName, email, phoneNumber, employeeId, jurisdiction, joiningDate } }[]`
  - Controller: `GET /v1/access/bundles/:id/users`

- [ ] **Step 1: Update `bundles()` in access.service.ts**

In `bundles()`, add `_count: { select: { users: true } }` to the `findMany`:

```typescript
bundles() {
  return this.prisma.client.permissionBundle.findMany({
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: 'asc' },
  });
}
```

- [ ] **Step 2: Add `bundleUsers()` to access.service.ts**

Add after the `bundles()` method:

```typescript
bundleUsers(bundleId: string) {
  return this.prisma.client.userBundle.findMany({
    where: {
      bundleId,
      user: { deletedAt: null },
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          employeeId: true,
          jurisdiction: true,
          joiningDate: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

- [ ] **Step 3: Add `GET /v1/access/bundles/:id/users` to access.controller.ts**

Add after the existing `@Post('bundles')` handler:

```typescript
@Get('bundles/:id/users')
async bundleUsers(@CurrentUser() u: AuthUser, @Param('id') id: string) {
  const rows = await this.access.bundleUsers(id);
  await this.logView(u, 'View Bundle Users', `Viewed users in bundle ${id}`);
  return rows;
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/users/services/access.service.ts src/modules/users/controllers/access.controller.ts
git commit -m "feat(access): add user count to bundles list and GET bundle users endpoint"
```

---

## Task 2: PATCH bundle (edit permissions) + DELETE bundle + self-edit guard

**Files:**
- Modify: `src/modules/users/dto/access.dto.ts`
- Modify: `src/modules/users/services/access.service.ts`
- Modify: `src/modules/users/controllers/access.controller.ts`

**Interfaces:**
- Consumes: `actor.role` (UserRole from AuthUser) to decide guard bypass
- Produces:
  - New `UpdateBundleDto`: `{ name?, description?, permissionIds? }`
  - `updateBundle(actorId, actorRole, bundleId, dto)` → `{ bundle, affectedUserCount }`
  - `deleteBundle(actorId, actorRole, bundleId)` → `{ id, name, affectedUserCount }`
  - Controller: `PATCH /v1/access/bundles/:id`, `DELETE /v1/access/bundles/:id`

- [ ] **Step 1: Add `UpdateBundleDto` to access.dto.ts**

Add to the end of `src/modules/users/dto/access.dto.ts` (update the import line too):

```typescript
import { ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
```

```typescript
export class UpdateBundleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMinSize(1) permissionIds?: string[];
}
```

Note: `@ArrayMinSize(1)` only applies when `permissionIds` is present — it prevents an accidental empty-array wipe.

- [ ] **Step 2: Add `assertNotSelfBundle()` guard to access.service.ts**

Add this private helper before the `permissions()` method:

```typescript
private async assertNotSelfBundle(actorId: string, actorRole: UserRole, bundleId: string): Promise<void> {
  if (actorRole === UserRole.SUPER_ADMIN) return;
  const selfAssignment = await this.prisma.client.userBundle.findUnique({
    where: { userId_bundleId: { userId: actorId, bundleId } },
  });
  if (selfAssignment) {
    throw new ForbiddenException('Cannot modify a bundle you are currently assigned to');
  }
}
```

Add `ForbiddenException` to the NestJS import at the top of access.service.ts:
```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 3: Add `updateBundle()` to access.service.ts**

Add after `createBundle()`:

```typescript
async updateBundle(
  actorId: string,
  actorRole: UserRole,
  bundleId: string,
  dto: UpdateBundleDto,
) {
  await this.assertNotSelfBundle(actorId, actorRole, bundleId);
  const existing = await this.prisma.client.permissionBundle.findUnique({
    where: { id: bundleId },
    include: { _count: { select: { permissions: true, users: true } } },
  });
  if (!existing) throw new NotFoundException('Bundle not found');
  const oldPermCount = existing._count.permissions;

  const bundle = await this.prisma.client.permissionBundle.update({
    where: { id: bundleId },
    data: {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.permissionIds
        ? {
            permissions: {
              deleteMany: {},
              create: dto.permissionIds.map((permissionId) => ({ permissionId })),
            },
          }
        : {}),
    },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true } },
    },
  });

  await this.logs.record({
    typeEnum: LogType.EMPLOYEE,
    categoryName: LOG_CATEGORY,
    actionName: 'Update Bundle',
    actionText: `The permission bundle "${bundle.name}" was updated by ${await describeActor(this.prisma, actorId)}`,
    userId: actorId,
    target: bundleId,
    oldDetail: { permissionCount: oldPermCount },
    newDetail: { permissionCount: bundle.permissions.length },
  });

  return { bundle, affectedUserCount: bundle._count.users };
}
```

Add `UpdateBundleDto` to the import from `'../dto/access.dto'` in access.service.ts.

- [ ] **Step 4: Add `deleteBundle()` to access.service.ts**

Add after `updateBundle()`:

```typescript
async deleteBundle(actorId: string, actorRole: UserRole, bundleId: string) {
  await this.assertNotSelfBundle(actorId, actorRole, bundleId);
  const existing = await this.prisma.client.permissionBundle.findUnique({
    where: { id: bundleId },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) throw new NotFoundException('Bundle not found');
  const affectedUserCount = existing._count.users;

  await this.prisma.client.permissionBundle.delete({ where: { id: bundleId } });

  await this.logs.record({
    typeEnum: LogType.EMPLOYEE,
    categoryName: LOG_CATEGORY,
    actionName: 'Delete Bundle',
    actionText: `The permission bundle "${existing.name}" was deleted by ${await describeActor(this.prisma, actorId)}`,
    userId: actorId,
    target: bundleId,
    oldDetail: { name: existing.name, affectedUserCount },
    newDetail: null,
  });

  return { id: bundleId, name: existing.name, affectedUserCount };
}
```

- [ ] **Step 5: Add `PATCH` and `DELETE` endpoints to access.controller.ts**

Add after the existing `@Post('bundles')` handler (and after the new GET users handler from Task 1):

```typescript
@Patch('bundles/:id')
updateBundle(
  @CurrentUser() u: AuthUser,
  @Param('id') id: string,
  @Body() dto: UpdateBundleDto,
) {
  return this.access.updateBundle(u.id, u.role, id, dto);
}

@Delete('bundles/:id')
deleteBundle(@CurrentUser() u: AuthUser, @Param('id') id: string) {
  return this.access.deleteBundle(u.id, u.role, id);
}
```

Add `Patch` to the NestJS import in access.controller.ts:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
```

Add `UpdateBundleDto` to the dto import in access.controller.ts.

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/users/dto/access.dto.ts src/modules/users/services/access.service.ts src/modules/users/controllers/access.controller.ts
git commit -m "feat(access): add PATCH/DELETE bundle endpoints with self-edit guard"
```

---

## Task 3: POST bulk reassign users between bundles

**Files:**
- Modify: `src/modules/users/dto/access.dto.ts`
- Modify: `src/modules/users/services/access.service.ts`
- Modify: `src/modules/users/controllers/access.controller.ts`

**Interfaces:**
- Produces:
  - New `ReassignBundleDto`: `{ userIds: string[], targetBundleId: string }`
  - `reassignBundle(actorId, fromBundleId, dto)` → `{ reassigned: number, targetBundleId, fromBundleId }`
  - Controller: `POST /v1/access/bundles/:id/reassign`

- [ ] **Step 1: Add `ReassignBundleDto` to access.dto.ts**

Add to the end of `src/modules/users/dto/access.dto.ts`:

```typescript
export class ReassignBundleDto {
  @IsArray() @IsString({ each: true }) @ArrayMinSize(1) userIds!: string[];
  @IsString() targetBundleId!: string;
}
```

- [ ] **Step 2: Add `reassignBundle()` to access.service.ts**

Add after `deleteBundle()`. This runs inside a Prisma transaction to keep it atomic:

```typescript
async reassignBundle(actorId: string, fromBundleId: string, dto: ReassignBundleDto) {
  const [fromBundle, targetBundle] = await Promise.all([
    this.prisma.client.permissionBundle.findUnique({ where: { id: fromBundleId }, select: { name: true } }),
    this.prisma.client.permissionBundle.findUnique({ where: { id: dto.targetBundleId }, select: { name: true } }),
  ]);
  if (!fromBundle) throw new NotFoundException('Source bundle not found');
  if (!targetBundle) throw new NotFoundException('Target bundle not found');

  await this.prisma.client.$transaction(async (tx) => {
    await tx.userBundle.deleteMany({
      where: { bundleId: fromBundleId, userId: { in: dto.userIds } },
    });
    await tx.userBundle.createMany({
      data: dto.userIds.map((userId) => ({
        userId,
        bundleId: dto.targetBundleId,
        assignedBy: actorId,
      })),
      skipDuplicates: true,
    });
  });

  await this.logs.record({
    typeEnum: LogType.EMPLOYEE,
    categoryName: LOG_CATEGORY,
    actionName: 'Reassign Bundle',
    actionText: `${dto.userIds.length} user(s) were reassigned from bundle "${fromBundle.name}" to "${targetBundle.name}" by ${await describeActor(this.prisma, actorId)}`,
    userId: actorId,
    target: dto.targetBundleId,
    oldDetail: { fromBundleId, fromBundleName: fromBundle.name, userCount: dto.userIds.length },
    newDetail: { targetBundleId: dto.targetBundleId, targetBundleName: targetBundle.name },
  });

  return {
    reassigned: dto.userIds.length,
    fromBundleId,
    targetBundleId: dto.targetBundleId,
  };
}
```

Add `ReassignBundleDto` to the dto import in access.service.ts.

- [ ] **Step 3: Add `POST /v1/access/bundles/:id/reassign` to access.controller.ts**

Add after the `@Delete('bundles/:id')` handler:

```typescript
@Post('bundles/:id/reassign')
reassignBundle(
  @CurrentUser() u: AuthUser,
  @Param('id') fromBundleId: string,
  @Body() dto: ReassignBundleDto,
) {
  return this.access.reassignBundle(u.id, fromBundleId, dto);
}
```

Add `ReassignBundleDto` to the dto import in access.controller.ts.

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/users/dto/access.dto.ts src/modules/users/services/access.service.ts src/modules/users/controllers/access.controller.ts
git commit -m "feat(access): add bulk reassign endpoint for moving users between bundles"
```
