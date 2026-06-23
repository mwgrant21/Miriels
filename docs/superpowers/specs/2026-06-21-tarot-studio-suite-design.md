# Tarot Studio Suite — Agents & Skills Design

**Date:** 2026-06-21
**Status:** Approved (design); implementation plan pending
**Author:** Brainstorming session with Matt

## Problem

The tarot project is well staffed for *design, build, and visual* work
(`tarot-dev`, `visual-designer`, and the global design pipeline:
`app-design-director`, `app-architect`, `ui-ux-designer`, `design-studio-pm`).
But its most specialized, highest-risk areas have no dedicated owner:

- **Content & voice** — Miriel's persona consistency and anti-AI-tells prose.
- **Memory engine** — "the moat": temporal recall, card patterns, prophecy weaving.
- **Quality & release** — the native-module ABI rebuild that has crashed portable builds before.
- **Cross-platform parity** — keeping the Android companion in sync with web/Electron.

## Goal

Add a focused suite of four project-scoped units — one per area — choosing the
form (skill vs agent) that fits how each will actually be used. No overlap with
`tarot-dev` (generalist dev + interpretation prompt engineering) or the global
`superpowers:test-driven-development` skill.

## Design Principle

- **Skills** = reusable knowledge/procedures any agent (or the user) can pull in.
- **Agents** = autonomous multi-step executors with their own context.

Voice consistency and the release procedure must be reusable by *every*
text-producing or shipping task, so they are **skills**. Deep subsystem work and
cross-repo porting are multi-step execution that benefits from autonomy, so they
are **agents**. (This is "Approach A — mixed by nature of work," chosen over
"all agents" and "all skills" alternatives.)

## Scope

All four units are **project-scoped**, living under
`C:\Users\Matt\projects\tarot\.claude\` (skills in `.claude\skills\`, agents in
`.claude\agents\`).

A fifth `deck-author` skill (spinning up new decks via the `generate-*.js`
scripts) is noted as **optional / out of scope** for this round.

---

## Unit 1 — `miriel-voice` (skill)

**Purpose:** Single source of truth for Miriel's voice so every text-producing
task sounds like the same character.

**Encodes:**
- Persona bible: warmth-tier arc, uncanny/oracle register, second-person
  address, what Miriel never says.
- Anti-AI-tells checklist tuned for oracle prose (em-dash prohibition, no
  "it's worth noting," no rule-of-three filler), building on the global
  `humanizer` skill rather than duplicating it.
- Deck-aware symbolism notes (Thoth/Crowley, Lenormand concrete-predictive,
  Elder Futhark runes, I Ching hexagram/changing-line) so voice does not flatten
  across decks.

**Interfaces:** pulled in by `tarot-dev` (interpretation prompts) and
`android-parity` (mobile copy); usable directly by the user.

**Source material:** existing Miriel voice/persona work captured across
`docs/superpowers/specs/*` (miriel voice, warmth scaling, accuracy fixes) and
`data/addressing.js`, `data/readers.json`, `server.js` prompt construction.

---

## Unit 2 — `memory-engine` (agent)

**Purpose:** Specialist for the memory subsystem ("the moat") so changes do not
break invariants.

**Knows:**
- Architecture across `data/memory-engine.js`, `data/memory-store.js`,
  `data/temporal-recall.js`, `data/card-patterns.js`,
  `data/prophecy-recall.js`, `data/reader-profile.js`.
- Invariants: atom-store schema, dedup/pruning of the surfaced-map, salience
  scoring, and how the four memory-depth phases (temporal callbacks, pattern
  recognition, richer recall, prophecy weaving) compose at read time.
- Discipline: TDD-first (subsystem has ~140 tests in `tests/`); seeded-history
  verification before claiming a detector works.

**Boundary vs `tarot-dev`:** `tarot-dev` stays the generalist; `memory-engine`
is dispatched for anything touching recall, patterns, or prophecy.

**Constraints:** offline card meanings in `data/*.json` remain ground truth and
must work without API calls; no new npm deps without discussion; no commits
without explicit request.

---

## Unit 3 — `tarot-release` (skill)

**Purpose:** Codify the packaging path so the native-module ABI crash never
ships again.

**Checklist:**
1. Run the full test suite — must be green before building.
2. `electron-rebuild` of `better-sqlite3` for Electron's ABI; verify the rebuilt
   binary loads under Electron (not just Node).
3. Bump `version` in `package.json`.
4. Build targets: win `portable` + `nsis`, mac `dmg` (per existing `build` config).
5. Portable smoke-test: launch, perform a reading, confirm `memory.db` writes and
   an interpretation renders (API and Ollama-fallback paths).

**Form rationale:** a procedure anyone runs, not a persona. Complements the
global TDD skill rather than replacing it.

**Source material:** `package.json` build config and scripts (`rebuild`,
`dist:win`, `dist:dmg`); the documented native-module packaging lesson.

---

## Unit 4 — `android-parity` (agent)

**Purpose:** Keep the Kotlin/NanoHTTPD `TarotApp` in feature and persona sync
with the web/Electron app.

**Does:**
- Reads both codebases (`C:\Users\Matt\projects\tarot` and
  `C:\Users\Matt\projects\TarotApp`), ports features web→Android, flags drift.
- Pulls in `miriel-voice` for copy and the global `android-development` skill for
  Kotlin/clean-architecture patterns.

**Constraints:** never read, edit, copy, move, or reference
`tarot-release-key.jks`; does not modify the Android project unless explicitly
asked to act (it may read for analysis).

---

## Net Result

| Area | Unit | Form |
|------|------|------|
| Content & voice quality | `miriel-voice` | skill |
| Memory engine depth | `memory-engine` | agent |
| Quality & release safety | `tarot-release` | skill |
| Cross-platform parity | `android-parity` | agent |

No overlap with `tarot-dev` or the design pipeline. Each unit has one clear
purpose, a defined interface to the others, and named source material to draw
from during authoring.

## Out of Scope

- `deck-author` skill (optional future addition).
- Any change to existing agents (`tarot-dev`, `visual-designer`) or the global
  design pipeline.
- Building/registering the agents' behavior into CI or hooks.

## Open Questions

None blocking. Authoring details (exact prose of each agent/skill body) are
deferred to the implementation plan, which will use `agent-designer` and
`skill-designer` to produce each file.
