# ADR 003: PostgreSQL + Prisma 6

**Status:** Accepted · **Date:** 2026-10-08

## Context
Relational data (users, sessions, audit) with strong consistency and good typed-client ergonomics. The latest Prisma at build time was 7.

## Decision
PostgreSQL 16 with **Prisma 6** (classic URL-in-schema, `new PrismaClient()`).

## Alternatives
- **Prisma 7** (latest) — makes driver adapters mandatory (`@prisma/adapter-pg` + `pg`), moves connection config to `prisma.config.ts`, and removes `url` from the schema. A significant architectural shift we could not validate without a live DB during the initial build, and heavier for a first foundation. Deferred; migration path is documented and additive.
- **TypeORM / raw SQL** — less type-safety / more boilerplate than Prisma for this domain.

## Consequences
- Mature, well-documented setup that "just works" on boot.
- One major behind latest; revisit Prisma 7's adapter model when it has settled and we have a DB to validate against.
- Soft-delete handled via a Prisma client extension (see `docs/database.md`).
