# Tarot Studio Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four project-scoped units — `miriel-voice` (skill), `memory-engine` (agent), `tarot-release` (skill), `android-parity` (agent) — filling the tarot project's unstaffed specialties.

**Architecture:** Skills hold reusable knowledge/procedures (voice bible, release checklist); agents are autonomous multi-step executors (memory subsystem, cross-repo Android porting). All files are project-scoped under `C:\Users\Matt\projects\tarot\.claude\`. Each file is authored with the `agent-designer` or `skill-designer` skill, drawing from named source files in the repo, then validated for frontmatter and required sections.

**Tech Stack:** Markdown agent files (`.claude/agents/*.md` with YAML frontmatter), skill files (`.claude/skills/<name>/SKILL.md` with YAML frontmatter), authored via `agent-designer` / `skill-designer`. Validation via PowerShell/Bash frontmatter checks.

---

## File Structure

Files created (no existing files modified except the spec already committed):

- `C:\Users\Matt\projects\tarot\.claude\skills\miriel-voice\SKILL.md` — Miriel persona bible + anti-AI-tells + deck symbolism.
- `C:\Users\Matt\projects\tarot\.claude\agents\memory-engine.md` — memory subsystem specialist agent.
- `C:\Users\Matt\projects\tarot\.claude\skills\tarot-release\SKILL.md` — Electron rebuild/ABI/packaging checklist.
- `C:\Users\Matt\projects\tarot\.claude\agents\android-parity.md` — web↔Android parity agent.

Source material (read-only, for authoring):

- Voice: `data/addressing.js`, `data/readers.json`, `server.js` (prompt construction), `docs/superpowers/specs/*miriel*`, `*voice*`, `*accuracy*`.
- Memory: `data/memory-engine.js`, `data/memory-store.js`, `data/temporal-recall.js`, `data/card-patterns.js`, `data/prophecy-recall.js`, `data/reader-profile.js`, `tests/*.test.js`.
- Release: `package.json` (build config + scripts), the native-module packaging lesson.
- Android: `C:\Users\Matt\projects\TarotApp\` (read-only survey), global `android-development` skill.

---

## Task 1: `miriel-voice` skill

**Files:**
- Create: `C:\Users\Matt\projects\tarot\.claude\skills\miriel-voice\SKILL.md`

- [ ] **Step 1: Gather source material**

Read these to extract the actual voice rules (do not invent — quote the codebase):
- `data/addressing.js` (how Miriel addresses the querent)
- `data/readers.json` (reader/persona definitions)
- `server.js` — locate the interpretation prompt construction (grep for `Miriel`, `system`, `prompt`)
- `docs/superpowers/specs/` — any file matching `miriel`, `voice`, `warmth`, `accuracy`

Run: `grep -rln -i "miriel" C:/Users/Matt/projects/tarot/docs/superpowers/specs/`
Expected: list of spec files to mine for warmth-tier arc and anti-tell rules.

- [ ] **Step 2: Author the skill with skill-designer**

Invoke the `skill-designer` skill to create the file. Required content:

Frontmatter:
```yaml
---
name: miriel-voice
description: Use when writing or reviewing any player-facing text for the tarot app in Miriel's voice — card interpretations, greetings, living notes, prophecy prose, Android copy. Enforces persona consistency, deck-specific symbolism, and anti-AI-tells. Do NOT use for code-only changes with no player-facing prose.
---
```

Required body sections:
1. **Persona bible** — warmth-tier arc (cold→intimate across visits), uncanny/oracle register, second-person address, what Miriel never says. Pull concrete tiers from the voice specs.
2. **Anti-AI-tells checklist** — em-dash prohibition, no "it's worth noting"/"that said"/"in conclusion", no rule-of-three filler, no hedging openers. Reference the global `humanizer` skill for the general list; this section holds the oracle-specific deltas only (DRY — do not copy humanizer wholesale).
3. **Deck-aware symbolism** — one short paragraph each for Thoth/Crowley-Qabalistic, Lenormand (concrete/predictive), Elder Futhark runes, I Ching (hexagram/changing-line). Voice must not flatten across decks.
4. **Self-check** — a 5-item pass/fail list an author runs before shipping prose.

- [ ] **Step 3: Validate frontmatter and sections**

Run:
```bash
head -5 "C:/Users/Matt/projects/tarot/.claude/skills/miriel-voice/SKILL.md"
grep -c "^## " "C:/Users/Matt/projects/tarot/.claude/skills/miriel-voice/SKILL.md"
```
Expected: frontmatter shows `name: miriel-voice` and a `description:`; section count >= 4.

- [ ] **Step 4: Trigger sanity check**

Confirm the description names the trigger cases (interpretations, greetings, living notes, prophecy, Android copy) and the explicit non-trigger (code-only changes). Read the frontmatter `description` and verify both present.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Matt/projects/tarot" && git add .claude/skills/miriel-voice/SKILL.md && git commit -m "feat: add miriel-voice skill (persona bible + anti-AI-tells)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `memory-engine` agent

**Files:**
- Create: `C:\Users\Matt\projects\tarot\.claude\agents\memory-engine.md`

- [ ] **Step 1: Gather source material**

Read to extract real architecture and invariants (quote, don't invent):
- `data/memory-engine.js`, `data/memory-store.js`, `data/temporal-recall.js`, `data/card-patterns.js`, `data/prophecy-recall.js`, `data/reader-profile.js`

Run: `grep -rln "module.exports" C:/Users/Matt/projects/tarot/data/*.js | grep -E "memory|recall|pattern|prophecy|reader-profile"`
Expected: confirms the six subsystem modules exist and their export surface.

Also note the test files: `tests/memory-engine.test.js`, `tests/memory-store.test.js`, `tests/temporal-recall.test.js`, `tests/card-patterns.test.js`, `tests/prophecy-recall.test.js`, `tests/reader-profile.test.js`.

- [ ] **Step 2: Author the agent with agent-designer**

Invoke the `agent-designer` skill. Required content:

Frontmatter:
```yaml
---
name: memory-engine
description: |
  Use this agent for any work touching the tarot app's memory subsystem ("the moat") at C:\Users\Matt\projects\tarot — temporal recall, card patterns, prophecy weaving, richer recall, the atom store, and reader profiles. Covers data/memory-engine.js, memory-store.js, temporal-recall.js, card-patterns.js, prophecy-recall.js, reader-profile.js.

  <example>
  Context: User wants a new recurrence detector in the pattern engine.
  user: "Can we detect when the same card shows up reversed across three readings?"
  assistant: "I'll use the memory-engine agent — this touches card-patterns.js and its detector tests."
  <commentary>Pattern/recall subsystem work is this agent's core purpose.</commentary>
  </example>
  <example>
  Context: User reports prophecy callbacks firing twice.
  user: "Miriel keeps repeating the same foretelling — dedup looks broken."
  assistant: "I'll dispatch the memory-engine agent to inspect the surfaced-map pruning in memory-engine.js."
  <commentary>Surfaced-map/dedup invariants live in this subsystem.</commentary>
  </example>
model: inherit
---
```

Required body sections:
1. **Subsystem map** — what each of the six modules owns and their export surface (filled from Step 1, not placeholders).
2. **Invariants** — atom-store schema, dedup/pruning of the surfaced-map, salience scoring, how the four memory-depth phases compose at read time.
3. **Discipline** — TDD-first (subsystem has ~140 tests; run `npm test` or the node test files); seeded-history verification before claiming a detector works.
4. **Constraints** — offline `data/*.json` meanings stay ground truth (no API dependency); no new npm deps without discussion; no commits without explicit request; pull in `miriel-voice` skill for any player-facing recall prose.
5. **Boundary** — `tarot-dev` stays generalist; this agent is dispatched for recall/patterns/prophecy.

- [ ] **Step 3: Validate frontmatter and sections**

Run:
```bash
head -20 "C:/Users/Matt/projects/tarot/.claude/agents/memory-engine.md"
grep -c "^## " "C:/Users/Matt/projects/tarot/.claude/agents/memory-engine.md"
```
Expected: frontmatter has `name: memory-engine`, a multi-line `description` with two `<example>` blocks, `model: inherit`; section count >= 5.

- [ ] **Step 4: Boundary check vs tarot-dev**

Read `tarot-dev.md` description and `memory-engine.md` description side by side; confirm no overlap (tarot-dev = generalist dev + interpretation prompts; memory-engine = recall/patterns/prophecy subsystem). Adjust memory-engine wording if it claims general dev work.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Matt/projects/tarot" && git add .claude/agents/memory-engine.md && git commit -m "feat: add memory-engine agent (memory subsystem specialist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `tarot-release` skill

**Files:**
- Create: `C:\Users\Matt\projects\tarot\.claude\skills\tarot-release\SKILL.md`

- [ ] **Step 1: Gather source material**

Read `package.json` and confirm the exact build/scripts (already known: `rebuild` = `electron-rebuild -f -w better-sqlite3`; `dist:win` = `npm run rebuild && electron-builder --win nsis portable`; `dist:dmg` = `npm run rebuild && electron-builder --mac dmg`; targets: win nsis+portable x64, mac dmg arm64+x64).

Run: `grep -A2 '"scripts"' C:/Users/Matt/projects/tarot/package.json`
Expected: confirms script names so the checklist references real commands.

- [ ] **Step 2: Author the skill with skill-designer**

Invoke the `skill-designer` skill. Required content:

Frontmatter:
```yaml
---
name: tarot-release
description: Use when packaging, building, or releasing the tarot Electron app — building the Windows portable/nsis or macOS dmg, bumping the version, or diagnosing the better-sqlite3 native-module ABI crash in a portable build. Do NOT use for routine dev or test-only changes.
---
```

Required body sections (an ordered checklist, real commands):
1. **Pre-flight** — run the full test suite; must be green. Command: `cd C:/Users/Matt/projects/tarot && node --test tests/` (or the project's test runner if different — verify in Step 1).
2. **Native rebuild** — `npm run rebuild`; then verify the rebuilt `better-sqlite3` loads under Electron's ABI, not just Node. State the failure signature (module version mismatch / app crash on first DB call) and that Node-only `require` passing is NOT sufficient proof.
3. **Version bump** — edit `version` in `package.json`.
4. **Build** — `npm run dist:win` and/or `npm run dist:dmg`; artifacts land in `dist/`.
5. **Smoke test** — launch the portable build, perform a reading, confirm `memory.db` writes and an interpretation renders on both the Claude-API and Ollama-fallback paths.
6. **Lesson box** — one short paragraph restating why the ABI rebuild is mandatory (the documented portable-crash history).

- [ ] **Step 3: Validate frontmatter and sections**

Run:
```bash
head -5 "C:/Users/Matt/projects/tarot/.claude/skills/tarot-release/SKILL.md"
grep -c "^## " "C:/Users/Matt/projects/tarot/.claude/skills/tarot-release/SKILL.md"
```
Expected: `name: tarot-release` + `description:` present; section count >= 6.

- [ ] **Step 4: Command accuracy check**

Confirm every command in the skill matches `package.json` script names exactly (`rebuild`, `dist:win`, `dist:dmg`). No invented scripts.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Matt/projects/tarot" && git add .claude/skills/tarot-release/SKILL.md && git commit -m "feat: add tarot-release skill (Electron ABI + packaging checklist)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `android-parity` agent

**Files:**
- Create: `C:\Users\Matt\projects\tarot\.claude\agents\android-parity.md`

- [ ] **Step 1: Gather source material**

Survey the Android project read-only to learn its structure (Kotlin/NanoHTTPD):

Run: `ls "C:/Users/Matt/projects/TarotApp/" && find "C:/Users/Matt/projects/TarotApp/app/src" -name "*.kt" 2>/dev/null | head -20`
Expected: confirms the Android module layout and key Kotlin sources to reference.

Note feature areas to keep in parity: readings, daily-card, patterns, compatibility, memory stubs, Miriel persona.

- [ ] **Step 2: Author the agent with agent-designer**

Invoke the `agent-designer` skill. Required content:

Frontmatter:
```yaml
---
name: android-parity
description: |
  Use this agent to keep the Kotlin/NanoHTTPD Android companion (C:\Users\Matt\projects\TarotApp) in feature and persona parity with the web/Electron tarot app (C:\Users\Matt\projects\tarot). Ports features web→Android and flags drift.

  <example>
  Context: A new spread shipped on web.
  user: "We added the Year Ahead spread on web — get it onto Android."
  assistant: "I'll use the android-parity agent to port the spread and its copy to the Kotlin app."
  <commentary>Web→Android feature porting is this agent's core purpose.</commentary>
  </example>
  <example>
  Context: User wants to know what's out of sync.
  user: "What features does the web app have that Android is missing?"
  assistant: "I'll dispatch android-parity to diff both codebases and report drift."
  <commentary>Drift analysis across the two repos is this agent's job.</commentary>
  </example>
model: inherit
---
```

Required body sections:
1. **Repos & layout** — both project paths; the Android module structure from Step 1; the web feature areas to track.
2. **Parity workflow** — read web feature → map to Android architecture → port → verify build (Android Studio). Pull in the global `android-development` skill for Kotlin/clean-architecture patterns and `miriel-voice` for any copy.
3. **Constraints** — NEVER read, edit, copy, move, or reference `tarot-release-key.jks`; do not modify the Android project unless explicitly asked to act (reading for analysis is allowed); no commits without explicit request.
4. **Drift reporting** — output format for a web-vs-Android feature diff (table: feature | web | android | gap).

- [ ] **Step 3: Validate frontmatter and sections**

Run:
```bash
head -20 "C:/Users/Matt/projects/tarot/.claude/agents/android-parity.md"
grep -c "^## " "C:/Users/Matt/projects/tarot/.claude/agents/android-parity.md"
```
Expected: `name: android-parity`, multi-line `description` with two `<example>` blocks, `model: inherit`; section count >= 4.

- [ ] **Step 4: Keystore-safety check**

Run: `grep -i "jks" "C:/Users/Matt/projects/tarot/.claude/agents/android-parity.md"`
Expected: the only mention is the prohibition. Confirm the constraint forbids all access to `tarot-release-key.jks`.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Matt/projects/tarot" && git add .claude/agents/android-parity.md && git commit -m "feat: add android-parity agent (web<->Android sync)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Suite integration check

**Files:** none created; verification only.

- [ ] **Step 1: Confirm all four files exist with valid frontmatter**

Run:
```bash
cd "C:/Users/Matt/projects/tarot" && for f in .claude/skills/miriel-voice/SKILL.md .claude/skills/tarot-release/SKILL.md .claude/agents/memory-engine.md .claude/agents/android-parity.md; do echo "== $f =="; head -3 "$f"; done
```
Expected: all four print a `name:` line matching their unit.

- [ ] **Step 2: Cross-reference integrity check**

Confirm the cross-skill references resolve:
- `memory-engine.md` references the `miriel-voice` skill by name.
- `android-parity.md` references `miriel-voice` and the global `android-development` skill.

Run: `grep -l "miriel-voice" C:/Users/Matt/projects/tarot/.claude/agents/*.md`
Expected: both `memory-engine.md` and `android-parity.md` listed.

- [ ] **Step 3: No-overlap final pass**

Re-read the four new descriptions plus `tarot-dev.md` and `visual-designer.md`. Confirm each new unit has a distinct trigger surface and none duplicates `tarot-dev` (generalist dev + interpretation prompts) or `visual-designer` (visual work). Note any overlap and tighten wording.

- [ ] **Step 4: Final commit (if any wording was tightened)**

```bash
cd "C:/Users/Matt/projects/tarot" && git add -A .claude/ && git commit -m "chore: tighten tarot studio suite trigger boundaries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Content & voice → Task 1 (`miriel-voice` skill). ✓
- Memory engine depth → Task 2 (`memory-engine` agent). ✓
- Quality & release safety → Task 3 (`tarot-release` skill); TDD discipline folded into Task 2 Step "Discipline" + existing global TDD skill. ✓
- Cross-platform parity → Task 4 (`android-parity` agent). ✓
- Project-scoped placement → all tasks write under `.claude\`. ✓
- No overlap with tarot-dev / design pipeline → Task 2 Step 4, Task 5 Step 3. ✓
- `deck-author` out of scope → not in plan. ✓

**Placeholder scan:** Frontmatter blocks are complete and literal; body sections specify concrete required content drawn from named source files. The actual persona/architecture prose is generated at execution time from those sources via skill-designer/agent-designer — this is authoring, not code, so the "content" is the required-section contract plus literal frontmatter. No TBD/TODO left.

**Type consistency:** Unit names (`miriel-voice`, `memory-engine`, `tarot-release`, `android-parity`) and file paths are identical across all tasks and the integration check. Cross-references (`miriel-voice` from memory-engine and android-parity) match the names defined in Tasks 1.
