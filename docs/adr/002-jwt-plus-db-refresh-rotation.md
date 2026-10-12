# ADR 002: JWT access tokens + DB-persisted rotating refresh tokens

**Status:** Accepted · **Date:** 2026-10-07

## Context
We need stateless, fast authorization on each request, plus the ability to truly revoke sessions ("log out", "log out everywhere") and detect stolen refresh tokens.

## Decision
- Short-lived stateless **JWT access token** (carries `sub`, `role`, `tokenVersion`).
- **Refresh token** `${sessionId}.${secret}` — only the argon2id hash of `secret` is stored in a `Session` row. Rotated on every use; old session revoked atomically *before* a new pair is issued. Presenting an already-rotated token revokes the whole session family and bumps `tokenVersion` (invalidating access tokens).

## Alternatives
- **Stateless JWT refresh (no DB)** — can't truly revoke or detect reuse; rejected.
- **Server session store for access too (opaque tokens)** — a DB hit per request; loses the statelessness benefit.
- **Scan-all-sessions + argon2 verify each** — O(n) per refresh and a DoS vector; replaced by the `sessionId` selector for O(1) lookup.

## Consequences
- Real logout/revocation and reuse detection.
- `tokenVersion` gives instant global access-token invalidation.
- Slight extra write per refresh; a `Session` table to purge periodically.
