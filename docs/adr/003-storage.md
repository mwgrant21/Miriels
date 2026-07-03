# ADR-003: better-sqlite3 + JSON file hybrid storage

**Status:** Accepted · 2026-07-03

## Context

The app stores two kinds of data: high-churn queryable data (memory atoms,
interpretation cache) and low-churn documents (readings, reader profiles,
daily-card cache).

## Decision

better-sqlite3 for queryable data; plain JSON files for documents. No ORM, no
server database.

## Rationale

- Single-user, local-first: a client-server database is pure overhead.
- better-sqlite3 is synchronous, which matches Express handlers that need
  memory recall mid-request without async ceremony, and is the fastest SQLite
  binding for this pattern.
- JSON documents stay human-readable and trivially portable (the Android
  sibling app provisions from them).

## Trade-off accepted: native binary

better-sqlite3 compiles a native binary per OS/arch/ABI. Consequences we accept
and manage:

- Electron packaging must rebuild for Electron's ABI (`npm run rebuild`,
  enforced in the `dist:*` scripts after a shipped crash taught us this).
- The repo's node_modules is machine-specific: tests fail in a foreign
  container unless `npm ci` recompiles (this bit an external code review run
  in a Linux sandbox; CI recompiles and is green).

## Consequences

- Two storage idioms in one codebase, chosen per data shape.
- Backup/sync is file copy; no migration tooling until schema pressure demands
  it.
