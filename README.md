# Miriel

**A private AI companion for reflection, memory, and meaningful conversation, inspired by the traditions of tarot and symbolic storytelling.**

> *"Some conversations are easier when we don't feel judged."*

Miriel is a local, private tarot and oracle reading application built around a simple idea.

A reading shouldn't feel like you're opening a piece of software.

It should feel like you're returning to someone who remembers you.

Tarot is the medium.

Reflection is the purpose.

---

## Why Miriel Exists

Miriel didn't begin as an AI project.

She began with a tarot deck sitting on my desk.

I found myself repeatedly drawing cards, opening websites, reading different interpretations, and trying to piece together what the overall reading was actually trying to tell me. The mechanics existed, but the experience felt fragmented.

I kept thinking:

> **"There has to be a better way to do this."**

I wanted to ask a question, draw the cards, and have everything woven together naturally, the way an experienced reader might explain it.

Not just what each individual card meant.

But how they interacted.

How one influenced another.

How the entire spread became a single story.

As that idea continued to grow, I realized something else.

Most people don't stop after one question.

A reading naturally becomes a conversation.

New questions appear.

New cards are drawn.

Different ideas begin connecting together.

I wanted Miriel to embrace that instead of treating every reading as something completely separate.

She could ask clarifying questions.

She could encourage someone to explore something they hadn't considered.

When the conversation came to a close, she could weave everything together into one final reflection instead of leaving someone with disconnected interpretations.

---

## Why Memory Matters

The more I thought about it, the more I realized that real readers don't begin every conversation from the beginning.

They remember.

They remember what you were worried about.

They remember the questions you avoided.

They remember the patterns you've repeated.

I wanted Miriel to feel the same way.

If someone returned after weeks or months, I didn't want them to feel like they were opening a brand new conversation each and every time.

I wanted them to feel welcomed.

I wanted them to feel they had someone they could turn to at any hour of the day, someone who would quietly listen and help them search for the answers they hoped to find.

That idea became the foundation of Miriel's memory system.

Every reading contributes to a long-term understanding of the person's journey.

Not to predict them.

Not to define them.

But to remember where they've been.

As familiarity grows, so does Miriel.

Her tone gradually becomes warmer.

Her greetings become more personal.

She remembers past readings, ongoing life events, and conversations that still haven't found resolution.

The goal was never simply to remember information.

The goal was to remember people.

Because feeling remembered is often what makes us feel understood.

---

## A Living Experience

As Miriel continued to evolve, I found myself asking a different question.

**"What would make her feel alive?"**

I didn't want her to feel like a chatbot.

I wanted her to feel like someone who existed just beyond everyday life.

Someone who quietly appeared when you needed to reflect.

That idea shaped almost every design decision.

The application changes its atmosphere throughout the day.

Morning, afternoon, evening, and night each have their own visual identity.

If someone opens Miriel late at night, she'll acknowledge the hour.

She may gently ask what's keeping them awake.

Not because she assumes she knows the answer, but because sometimes the question itself is enough to begin a conversation.

Small moments like these aren't technically necessary.

They're there because they make the experience feel more thoughtful and more personal.

---

## More Than One Language

Tarot isn't the only symbolic language people use to reflect.

Because of that, Miriel was designed to understand multiple systems without flattening them into generic interpretations.

She can work with traditional tarot, oracle cards, runes, I Ching, and original decks created specifically for the project.

As the project grew, I also began creating original decks. Some ideas I wanted to explore simply didn't exist in traditional systems, so I designed symbolic languages that reflected the experiences and themes I wanted Miriel to help people explore.

Each system keeps its own symbolism.

Each offers a different perspective.

Sometimes those perspectives reinforce one another.

Sometimes they challenge one another.

That variety was intentional.

Different symbolic systems often illuminate different parts of the same question.

---

## The Role of Prophecy

One idea that fascinated me while building Miriel was continuity.

If a reading suggested something months ago...

What happens when life eventually reaches that moment?

Rather than pretending every prediction is automatically true, Miriel revisits earlier readings honestly.

Some proved accurate.

Some only partially aligned.

Others never happened.

Those outcomes become part of the ongoing conversation.

Sometimes she'll even pause a reading because something reminds her of an earlier conversation.

She may ask whether a situation has changed.

She may notice a pattern you've overlooked.

The purpose isn't prediction.

It's reflection through continuity.

---

## Why "Miriel"?

Many years ago, someone once told me that I had a guardian named Miriel.

Whether someone believes that or not isn't really the point.

The name stayed with me for years.

When this project finally began to take shape, it felt like the right name.

I wasn't trying to create a fortune teller.

I was trying to create someone who quietly watches over your thoughts, remembers where you've been, and helps you reflect on where you may be going.

The name simply felt right.

---

## What I Learned

Building Miriel taught me far more than I expected.

It taught me that products slowly develop identities of their own.

Features that worked technically didn't always feel right.

Artwork that looked beautiful sometimes didn't belong.

Entire decks were redesigned because they no longer reflected who Miriel had become.

That was one of the biggest lessons this project taught me.

A product isn't finished simply because it works.

It's finished when every decision feels true to the experience you're trying to create.

---

## Technical Overview

Underneath the experience is a memory architecture designed specifically around long-term continuity.

Rather than storing conversations as simple chat history, Miriel builds a structured memory that evolves over time.

The complete technical design, including the memory engine, recall scoring, prophecy loop, and long-term storage architecture, is documented separately.

➡️ **See: [docs/memory-engine.md](docs/memory-engine.md)**

---

## Looking Forward

Miriel still isn't finished.

I don't think she ever will be.

Every iteration teaches me something new about memory, conversation, personality, and how people build relationships with technology.

The goal has never been to make her feel more intelligent.

The goal has always been to make her feel more thoughtful.

If someone closes Miriel feeling a little more understood, a little more at peace, or simply looking at their life from a different perspective than when they arrived, then I believe she has accomplished exactly what I hoped she would.

If, even for a few moments, someone felt they had a place to reflect without judgment, then she became exactly who I hoped she would be.

---

## Technical Reference

### What makes it different

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

### Decks & spreads

Eight symbolic systems, each read within its own conventions rather than flattened
to generic meanings: **Rider-Waite tarot, Thoth (Crowley/Qabalistic), Celtic
Dragon, Moonology, Lenormand, Elder Futhark runes, I Ching, and a custom oracle.**

Spreads: single, three-card, four-card, five-card, six- and nine-card
relationship, Year Ahead, and the Celtic Cross.

### How interpretation works

Readings are interpreted by the Claude API, with a local Ollama model as a
fallback and a cache as a last resort. The offline card meanings in `data/*.json`
are ground truth and always work with no API at all.

### Tech stack

- **Backend:** Node.js + Express (`server.js`)
- **Desktop:** Electron (Windows portable/NSIS, macOS dmg)
- **Storage:** SQLite via `better-sqlite3` (the memory engine)
- **Frontend:** vanilla HTML/CSS/JS (`public/`), with an astral day/night theme

### Running locally

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

### Tests

```bash
node --test               # ~154 tests (memory engine, patterns, recall, prophecy)
```

### Project structure

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

### The studio suite

The repo ships custom Claude Code agents and skills that staff the project's
specialized areas:

- **miriel-voice** (skill) - persona bible + anti-AI-tells + deck symbolism
- **memory-engine** (agent) - specialist for the memory subsystem
- **tarot-release** (skill) - Electron packaging / native-module checklist
- **android-parity** (agent) - keeps the Android companion in sync

### How this was built

Full transparency: this codebase was written by directing Claude Code, not by hand. I
supplied the product vision, the specs and design decisions (see `docs/superpowers/` and
the ADRs in `docs/adr/`), reviewed and accepted every change, and did the real-machine
testing and release packaging. The custom agents and skills in `.claude/` are the workflow
itself. They were authored to staff the project's specialized areas. I can explain why every
subsystem exists, how it's meant to behave, and how it was validated; for line-level
implementation detail, the specs, ADRs, and commit history are the record.

This is the curated portfolio repository: the history here is a small set of clean,
reviewable commits. The full development history (360+ commits) is preserved in the
original working repository, [mwgrant21/tarot](https://github.com/mwgrant21/tarot).

### Privacy

This is a personal, local-first app. Your readings, profiles, and accumulated
memory live only on your machine. Runtime data (`data/memory.db`,
`data/profiles/`, `data/interpretations.db`, daily and pattern caches) and your
API key (`data/config.json`) are gitignored and never leave your device.
