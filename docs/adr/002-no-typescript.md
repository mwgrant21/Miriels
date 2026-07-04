# ADR-002: No TypeScript conversion

**Status:** Accepted · 2026-07-03

**Amended:** 2026-07-04 — the optional `// @ts-check` signal was adopted (see
Decision); decision to avoid a full TS conversion is unchanged.

## Context

External portfolio review flagged "dynamically-typed JS end to end" as a hiring
signal in some shops. A full conversion of ~5,500 lines was considered.

## Decision

Stay JavaScript, no full conversion. Adopt `// @ts-check` + JSDoc on the
service layer (`data/*.js`) with `tsc --noEmit` in CI — a typing signal without
a build step. Shipped 2026-07-04: all 14 `data/*.js` modules carry `// @ts-check`;
`tsconfig.json` runs `checkJs` (non-strict, `noEmit`) over `data/**`; `npm run
typecheck` gates it and CI runs it between lint and test. Real inference gaps
were closed with a handful of JSDoc `@param` annotations, not type-everything
churn. Scope is deliberately the tested service layer only — not `routes/` or
the `public/js/` frontend — matching where the code's real complexity lives.

## Rationale

- The code TypeScript protects best — the service layer (14 modules under data/) — already has extensive node:test coverage (17 suites repo-wide) pinning its behavior; conversion would churn every file for marginal additional safety.
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
