# ADR-001: Vanilla JavaScript frontend, no framework

**Status:** Accepted · 2026-07-03

**Amended:** 2026-07-04 — ES-module split shipped; decision unchanged (still
no framework/bundler).

## Context

External portfolio review noted the frontend is a large vanilla-JS codebase with
no framework to enforce structure. The obvious modern default would be React or
Vue with a bundler.

## Decision

Keep the frontend vanilla JavaScript with zero build step. Address structure
with an ES-module split rather than a framework — now shipped: the 4,243-line
`public/app.js` monolith is 12 focused modules under `public/js/` plus a
5-line entry point. The migration's `app.js`↔module cycles were dissolved by
promoting shared state into a zero-import `state.js` leaf; two TDZ-safe
function-level cycles remain within the reading-flow cluster (safe because
the imported bindings are read only at call time, never during module
evaluation).

## Rationale

- Single-user local app: no SSR, no routing, no team onboarding — the problems
  frameworks solve are mostly absent here.
- Zero build step keeps three distribution targets simple: local web, Electron
  (loads the same `public/` over localhost), and a Kotlin Android sibling app
  that shares design but not code.
- The app's real complexity lives in the tested backend service layer, not in
  view logic.
- A framework migration would have rewritten ~4,000 working lines for
  structural benefit the ES-module split achieved at a fraction of the risk.

## Consequences

- Module boundaries are enforced by ESLint (`sourceType: module`, `no-undef`
  catches incomplete imports) rather than framework convention.
- DOM updates are handwritten; acceptable at this app's UI complexity.
- Revisit if the UI grows genuinely stateful/composed (drag-and-drop spread
  builder, multi-window), or if the app ever becomes multi-user.
