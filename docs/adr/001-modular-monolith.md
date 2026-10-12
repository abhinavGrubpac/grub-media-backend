# ADR 001: Modular monolith

**Status:** Accepted · **Date:** 2026-10-07

## Context
A new backend expected to grow with a team over years. We need maintainability and clear ownership without the operational cost of microservices up front.

## Decision
Build a modular monolith: one deployable, with feature modules (`auth`, `users`, `health`) that are self-contained and communicate through well-defined interfaces, plus shared infrastructure in `common/`/`config/`/`database/`/`redis/`.

## Alternatives
- **Microservices** — premature; adds network, deploy, and data-consistency complexity before we have scaling or ownership pressure.
- **Layer-first structure** (`controllers/`, `services/` top-level) — poor locality; changes to one feature touch many folders.

## Consequences
- Simple to run, test, and reason about now.
- Clear seams allow extracting a module into a service later if needed.
- Discipline required to keep modules from reaching into each other's internals (enforced by review).
