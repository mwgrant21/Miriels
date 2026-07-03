# ADR-002: No TypeScript conversion

**Status:** Accepted · 2026-07-03

## Context

External portfolio review flagged "dynamically-typed JS end to end" as a hiring
signal in some shops. A full conversion of ~5,500 lines was considered.

## Decision

Stay JavaScript. Optionally adopt `// @ts-check` + JSDoc on the service layer
(`data/*.js`) with `tsc --noEmit` in CI later — typing signal without a
conversion.

## Rationale

- The code TypeScript protects best — the service layer (11 modules under data/) — already has extensive node:test coverage (14 suites repo-wide) pinning its behavior; conversion would churn every file for marginal additional safety.
- Zero build step is a deliberate architectural property (see ADR-001);
  TypeScript would force a compile step onto all three distribution targets.
- Conversion risk is concentrated exactly where test coverage is weakest (the
  frontend), inverting the usual risk/benefit of adopting TS.

## Consequences

- Type errors surface at runtime or in tests, not at compile time.
- Contributors (and reviewers) must read JSDoc/tests, not type signatures, for
  interfaces.
- Revisit at the point of any frontend rewrite (ADR-001 revisit triggers) —
  if that line is ever crossed, TS comes with it.
