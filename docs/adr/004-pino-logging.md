# ADR 004: nestjs-pino for logging

**Status:** Accepted · **Date:** 2026-10-07

## Context
We need structured, production-grade logs with per-request correlation and guaranteed secret redaction, at low overhead.

## Decision
Use **nestjs-pino** (pino). Structured JSON in prod, pretty in dev; `genReqId` binds a correlation id to every log line in a request; `redact` strips `authorization`/`cookie`/`password`/`passwordHash`/`*token`.

## Alternatives
- **Winston** (originally specified) — would require hand-rolling request-scoped correlation binding and redaction; slower. Rejected in favor of pino's built-ins.
- **Nest default Logger** — no structure, correlation, or redaction.

## Consequences
- Fast, structured, Loki/ELK-ready logs; correlation id is the trace seam for future OpenTelemetry.
- pino-http runs before Nest middleware, so the correlation id is validated in both `genReqId` and `RequestIdMiddleware` to stay consistent and injection-safe.
