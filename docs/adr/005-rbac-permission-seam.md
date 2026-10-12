# ADR 005: RBAC now, permission seam for later

**Status:** Accepted · **Date:** 2026-10-07

## Context
We need role-based access today (SUPER_ADMIN/ADMIN/EMPLOYEE) but anticipate finer-grained, possibly DB-driven permissions later, without a rewrite.

## Decision
Two decorators backed by one guard:
- `@Roles(...)` — role membership.
- `@RequirePermissions('users.read')` — checked against an in-code `ROLE_PERMISSIONS` map.

`RolesGuard` enforces both. The permission vocabulary (`resource.action`) is in place now; moving the role→permission mapping into the database later is additive and does not change the decorator/guard API.

## Alternatives
- **Roles only** — simplest, but a later move to permissions would churn every controller.
- **Full DB permission engine now** — premature; builds an authorization system before the requirements exist.

## Consequences
- Controllers already express intent as permissions where useful.
- The jump to DB-driven permissions is a swap of the mapping source, not an API change.
- Role hierarchy is expressed in the map, not auto-assumed per check.
