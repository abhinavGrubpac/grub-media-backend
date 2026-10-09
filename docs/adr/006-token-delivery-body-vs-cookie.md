# ADR 006: Token delivery — JSON body now, cookies deferred

**Status:** Accepted · **Date:** 2026-10-07

## Context
Access/refresh tokens can be delivered in the JSON body or as httpOnly cookies. Cookies protect against XSS token theft but introduce CSRF handling.

## Decision
Return tokens in the **JSON response body** for the foundation (API-first; works cleanly with Swagger, Postman, and non-browser clients). The client stores and sends them as `Authorization: Bearer`.

## Alternatives
- **httpOnly cookies now** — adds CSRF protection, cookie config, and SameSite concerns before any browser frontend exists.

## Consequences
- Simple, testable, framework-agnostic auth today.
- When a browser SPA arrives, add an httpOnly-cookie option (refresh token as httpOnly cookie + CSRF token) alongside the body variant. The token service is unaffected; only transport changes.
