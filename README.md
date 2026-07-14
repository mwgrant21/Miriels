# Miriel's Tarot & Oracle

A local, private tarot and oracle reading app with a reader who remembers you.

Miriel is the narrator and reader: an intuitive, penetrating voice (part
psychologist, part poet) who interprets your cards, notices patterns across your
readings, and recalls what you've sat with before. Everything runs and stays on
your machine.

## What makes it different

The heart of the app is **the memory engine** ("the moat") - Miriel accumulates a
genuine memory of the querent across readings, so a reading in month six lands
differently than a reading on day one. The full design - the atom store, the
recall scoring, the jittered dormancy clocks, the prophecy verdict loop - is
written up in [docs/memory-engine.md](docs/memory-engine.md).

- **Accumulating memory** - an atom store of facts, threads, feelings, and
  predictions distilled from each reading.
- **Temporal callbacks** - anniversaries, elapsed time, seasonal and milestone
  signals surfaced in Miriel's greeting.
- **Pattern recognition** - recurring cards, reversal flips, and suit skew across
  your history, stated only when the counts are real.
- **Prophecy weaving** - Miriel's own past foretellings resurface (with honest
  verdicts: came to pass, partly, did not) when a current card connects, and the
  same foretelling won't re-fire every reading.
- **Warmth that grows** - her familiarity scales with how long she's read for you.
- **Anti-AI-tells voice** - prose deliberately scrubbed of machine-writing
  fingerprints (no em dashes, no filler, no rule-of-three).

## Decks & spreads

Eight symbolic systems, each read within its own conventions rather than flattened
to generic meanings: **Rider-Waite tarot, Thoth (Crowley/Qabalistic), Celtic
Dragon, Moonology, Lenormand, Elder Futhark runes, I Ching, and a custom oracle.**

Spreads: single, three-card, four-card, five-card, six- and nine-card
relationship, Year Ahead, and the Celtic Cross.

## How interpretation works

Readings are interpreted by the Claude API, with a local Ollama model as a
fallback and a cache as a last resort. The offline card meanings in `data/*.json`
are ground truth and always work with no API at all.

## Tech stack

- **Backend:** Node.js + Express (`server.js`)
- **Desktop:** Electron (Windows portable/NSIS, macOS dmg)
- **Storage:** SQLite via `better-sqlite3` (the memory engine)
- **Frontend:** vanilla HTML/CSS/JS (`public/`), with an astral day/night theme

## Running locally

```bash
npm install
npm start                 # http://localhost:3000
```

Set your Anthropic API key in `data/config.json` (this file is gitignored and
must never be committed):

```json
{ "apiKey": "sk-ant-..." }
```

Without a key, the app still runs on the Ollama fallback and offline meanings.

Desktop builds:

```bash
npm run dist:win          # Windows portable + NSIS installer
npm run dist:dmg          # macOS dmg
```

Both rebuild the native `better-sqlite3` module for Electron's ABI first. See
`docs/superpowers/specs/` and the `tarot-release` skill for the full release
checklist.

## Tests

```bash
node --test               # ~154 tests (memory engine, patterns, recall, prophecy)
```

## Project structure

```
server.js              Express server + interpretation pipeline
electron/              Electron wrapper
public/                Frontend (index.html, app.js, style.css, themes)
data/
  *.json               Card decks (ground-truth meanings)
  memory-engine.js     Orchestrates recall / capture (the moat)
  memory-store.js      SQLite atom store
  temporal-recall.js   Temporal callback detector
  card-patterns.js     Pattern recognition
  prophecy-recall.js   Prophecy weaving + dedup
  reader-profile.js    Profile synthesis + warmth arc
tests/                 node:test suite
docs/superpowers/      Design specs and implementation plans
.claude/               Project agents & skills (the "studio suite")
```

## The studio suite

The repo ships custom Claude Code agents and skills that staff the project's
specialized areas:

- **miriel-voice** (skill) - persona bible + anti-AI-tells + deck symbolism
- **memory-engine** (agent) - specialist for the memory subsystem
- **tarot-release** (skill) - Electron packaging / native-module checklist
- **android-parity** (agent) - keeps the Android companion in sync

## How this was built

Full transparency: this codebase was written by directing Claude Code, not by hand. I
supplied the product vision, the specs and design decisions (see `docs/superpowers/` and
the ADRs in `docs/adr/`), reviewed and accepted every change, and did the real-machine
testing and release packaging. The custom agents and skills in `.claude/` are the workflow
itself — authored to staff the project's specialized areas. I can explain why every
subsystem exists, how it's meant to behave, and how it was validated; for line-level
implementation detail, the specs, ADRs, and commit history are the record.

This is the curated portfolio repository: the history here is a small set of clean,
reviewable commits. The full development history (360+ commits) is preserved in the
original working repository, [mwgrant21/tarot](https://github.com/mwgrant21/tarot).

## Privacy

This is a personal, local-first app. Your readings, profiles, and accumulated
memory live only on your machine. Runtime data (`data/memory.db`,
`data/profiles/`, `data/interpretations.db`, daily and pattern caches) and your
API key (`data/config.json`) are gitignored and never leave your device.
