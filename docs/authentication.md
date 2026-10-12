# Authentication & Authorization

## Tokens
- **Access token** — JWT, short-lived (`JWT_ACCESS_TTL`, ~15m), stateless. Payload: `sub`, `role`, `tokenVersion`. Signed with `JWT_ACCESS_SECRET`.
- **Refresh token** — opaque, format `${sessionId}.${secret}`. Only the argon2id hash of `secret` is stored, in a `Session` row. The `sessionId` is a non-sensitive selector enabling an O(1) lookup + a single verify (no scanning all sessions).

## Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/login` | public | email+password → access + refresh + user |
| POST | `/api/v1/auth/refresh` | public | rotate refresh token → new pair |
| POST | `/api/v1/auth/logout` | bearer | revoke all sessions + bump tokenVersion |
| GET | `/api/v1/auth/me` | bearer | current user |

## Rotation & reuse detection
On refresh: look up the session by id, verify the secret, then **atomically** revoke it (`updateMany where revokedAt:null`) *before* issuing a new pair. If that update affects zero rows the token was already rotated → treated as **theft**: the entire session family for the user is revoked and `tokenVersion` is bumped (invalidating outstanding access tokens), and the request is rejected 401. Reuse is caught even after the stolen token expires, because lookup is by id, not filtered by expiry.

## Password security
argon2id hashing; passwords never stored or logged in plaintext. Login returns a uniform `Invalid credentials` (401) for unknown email / wrong password / inactive / soft-deleted — no user enumeration.

## Brute-force lockout
Redis counter keyed by `email+ip`, sliding 15-minute window, max `THROTTLE_LOGIN_LOCK_MAX` (default 5). The lock is checked **before** credential verification. Redis is optional: if unavailable the counter returns 0 and lockout is disabled (fail-open on availability, documented tradeoff) while global throttling/ auth still apply.

## RBAC (permission-ready)
Roles: `SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`. Guards read decorator metadata:
- `@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)` — role membership.
- `@RequirePermissions('users.read')` — backed by an in-code `ROLE_PERMISSIONS` map.

`JwtAuthGuard` is global (secure by default); `@Public()` opts out. `RolesGuard` runs after authentication; a route with no role/permission metadata only requires authentication. The permission seam lets us move to DB-driven permissions later without changing the decorator/guard API. See ADR 005.

## tokenVersion
Every access token carries the user's `tokenVersion`; `JwtStrategy` rejects a token whose version no longer matches (also rejects soft-deleted/inactive users on every request). Bumping it (logout / reuse-detection) is an instant global invalidation of access tokens.

## Token delivery
Tokens are returned in the JSON body (API-first). A cookie-based variant is deferred — see ADR 006.
