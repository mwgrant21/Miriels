# ADR-001: Vanilla JavaScript frontend, no framework

**Status:** Accepted · 2026-07-03

## Context

External portfolio review noted the frontend is a large vanilla-JS codebase with
no framework to enforce structure. The obvious modern default would be React or
Vue with a bundler.

## Decision

Keep the frontend vanilla JavaScript with zero build step. Address structure
with an ES-module split (planned) rather than a framework.

## Rationale

- Single-user local app: no SSR, no routing, no team onboarding — the problems
  frameworks solve are mostly absent here.
- Zero build step keeps three distribution targets simple: local web, Electron
  (loads the same `public/` over localhost), and a Kotlin Android sibling app
  that shares design but not code.
- The app's real complexity lives in the tested backend service layer, not in
  view logic.
- A framework migration would rewrite ~4,000 working lines for structural
  benefit an ES-module split achieves at a fraction of the risk.

## Consequences

- Module boundaries must be maintained by discipline (and ESLint) rather than
  framework convention.
- DOM updates are handwritten; acceptable at this app's UI complexity.
- Revisit if the UI grows genuinely stateful/composed (drag-and-drop spread
  builder, multi-window), or if the app ever becomes multi-user.
