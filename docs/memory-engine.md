# How Miriel Remembers You: The Memory Engine

Miriel is a tarot reader who runs entirely on your machine. The interpretations come from an
LLM, but LLMs have no memory: every API call starts from zero. The product promise — *a reading
in month six lands differently than a reading on day one* — therefore had to be built outside
the model. This document explains how, because the design is the most interesting part of the
project and none of it is magic.

The short version: readings pass through a cheap extraction model that distills durable facts
into a local SQLite store; a deterministic, fully inspectable scoring function decides what
resurfaces; and a set of time-based detectors give the reader a sense of *when* — anniversaries,
threads gone quiet, prophecies come due. The LLM writes the prose. The memory system decides
what the prose is allowed to know.

## Design constraints

Everything is local-first and single-user: SQLite via `better-sqlite3` (synchronous, zero-config),
no server, no accounts, nothing leaves the machine. Extraction runs on a small, cheap model
(Haiku) because it is a classification-and-summarization job, not a writing job. And recall
deliberately uses **no embeddings**: retrieval is a hand-written scoring function over keyword
overlap, salience, status, and freshness. That costs some recall quality against a vector store,
but every retrieval decision is explainable by reading one function — when Miriel brings
something up, I can say exactly why. For a system whose failure mode is "the reader confidently
misremembers your life," debuggability beat sophistication.

## The atom store

Memory is a table of small, typed rows — "atoms" — one specific sentence each:

```sql
CREATE TABLE memories (
  id, reader_slug, type, content, status,
  salience INTEGER DEFAULT 3,      -- 1..5, how central to their life
  subject, source_kind, source_id, -- provenance: which reading produced this
  created_at, updated_at,
  last_referenced_at,              -- when Miriel last surfaced it
  reference_count,                 -- how often she has surfaced it
  asked_at                         -- when she last asked about it directly
);
```

An atom's `type` is one of person, thread, event, feeling, prediction, fact, or preference.
Threads and predictions carry a `status` (open → moving → resolved, or dormant). A separate
`memory_links` table records relations — most importantly `resolves`, which ties an outcome
atom to the prediction it settles. A `memory_meta` table holds idempotency flags. Schema changes
ship as guarded `ALTER TABLE` migrations, since `CREATE TABLE IF NOT EXISTS` never alters an
existing database.

## Capture: an LLM with a narrow job and no imagination

After each reading, the engine sends the extraction model a summary of the reading plus
everything it already remembers, and asks for a JSON operations list — `ADD`, `UPDATE`, or
`TOUCH` — under conservative rules: one specific sentence per atom, only what is explicitly
present, merge instead of duplicating, and *"if there is genuinely nothing worth remembering,
return no operations."* The system prompt ends with **"Never invent."** Predictions get special
handling at capture time: only a specific, checkable foretelling ("this connection won't last
the season") is stored as one; vague encouragement is explicitly excluded, because an
unfalsifiable prophecy can never be honestly graded later.

The parser around the model's output is tolerant — it hunts for the first JSON object or array
in the response and returns an empty list on anything malformed — and every operation is
validated against the store's allowed types and statuses before it touches SQLite. If the LLM
call fails, capture reports the error and stores nothing. A first-run backfill seeds memory from
historical readings in chunks of 12, guarded by a meta flag that is only set after *all* chunks
succeed, so a mid-run crash retries from scratch rather than leaving memory half-seeded.

## Recall: one scoring function, no vector database

When a new reading begins, up to 200 candidate atoms are pulled (open first, then by salience)
and scored against the question and drawn cards:

```
score = 3.0·overlap + 1.5·salience + 1.5·status + 0.5·freshness − 0.4·overuse
```

Each term earns its place. **Overlap** is stopword-filtered keyword intersection between the
atom and the question-plus-card-names, capped so that three shared salient words is full marks —
it dominates the formula because relevance to *this* reading matters most. **Salience** (the
extractor's 1–5 centrality judgment) and **status** (open 1.0, moving 0.6, resolved 0) keep
live, important material ahead of settled trivia. **Freshness** ramps from 0 to 1 over 30 days
since the atom was last surfaced. **Overuse** grows with lifetime reference count.

Those last two terms are the anti-repetition mechanism, and they form a feedback loop: every
atom that gets surfaced is immediately marked referenced, which raises its overuse penalty and
zeroes its freshness — so the same memory cannot become Miriel's catchphrase. The top ten
positive-scoring atoms are fenced and injected into the interpretation prompt with an
instruction that ends: *"Don't force in memories that don't fit; say nothing rather than
reach."* Restraint is enforced twice — once in arithmetic, once in instruction.

## Knowing when: jittered clocks and honest anniversaries

A greeting that says "welcome back" identically every time is worse than no memory at all, so
several detectors run on time rather than topic. Temporal callbacks notice a reading from
exactly one year ago (±3 days), a real absence (21+ days since the last visit), or a seasonal
echo — the same calendar month in a prior year. Each emits a plain-language fact plus a
`signature` used for deduplication, and the prompt explicitly warns the model that these are
facts about *past readings*, not about when the person last visited — a hallucination pattern
I hit in practice ("it's been a year!" to someone who visited yesterday) and had to engineer
away.

Dormant threads and ripe prophecies use my favorite small trick in the codebase. A thread goes
dormant when a salient, still-open atom hasn't moved in about 60 days; a prediction ripens for
follow-up after about 14. Both windows are jittered per-row in SQL — `(id % 7)` maps each atom
to a stable offset of ±3 days — so wake-ups don't cluster into a single reading where Miriel
suddenly interrogates you about everything at once, and because the jitter is a pure function
of the row id, an atom never flickers in and out of dormancy between queries. Both clocks
measure from the *later* of last-asked and last-updated, giving ask-once-then-rest semantics:
if Miriel asks and you don't take it up, she lets it rest for another full window instead of
nagging.

## The prophecy loop

Predictions are the memory system at its most accountable. When one ripens, or when you answer
Miriel's greeting question, a capture pass resolves it with a verdict — `came_to_pass`,
`did_not`, `partly`, or `too_soon` (which defers it for a fresh window rather than grading it
prematurely). The outcome is stored as its own atom, linked to the prediction with a `resolves`
edge, so the original claim and how it landed are permanently joined.

During later readings, a small dossier (at most three foretellings) is assembled for the
interpretation prompt: resolved prophecies lead, weighted by verdict — fulfilled outranks
partial outranks missed — with ties broken by lexical overlap against the current question and
cards. Missed prophecies are included on purpose: *"You foretold X. It did not come to pass"*
is exactly the kind of honesty that makes the fulfilled ones credible. A 21-day surfacing TTL,
keyed per prediction, keeps any single foretelling from re-firing on every keyword-matching
reading.

## The long arc: seasons and warmth

Two slower systems shape tone rather than content. Emotional seasons cluster `feeling` atoms
into labeled 30-day windows (a season needs at least four feelings before it counts) and detect
a shift only when the latest season's valence differs from the most-contrasting earlier one by
a real threshold — surfaced as weather to notice, never a diagnosis. And warmth is a five-tier
arc driven purely by reading count (first visit, early, familiar at 6, returning at 21,
long-known at 60) that colors how familiar Miriel's voice is allowed to be. Warmth is
deliberately separate from what she remembers: knowing things about someone and being close to
them are different facts.

## Trust boundaries

Every piece of user-originated text that enters a prompt — questions, answers, recalled
memories, even names — passes through a fencing module first: control characters stripped,
smuggled fence tags removed, length capped, then wrapped in a named tag the model is told to
treat as data, never instructions. For a single-user local app this is mostly self-defense
against my own data, but it hardens the second-order path (LLM-extracted memories feeding later
LLM prompts) and, in practice, clearly separating the querent's words from Miriel's instructions
improves output quality anyway.

## What I'd tell you in an interview

The honest limitations: keyword overlap misses paraphrase ("my job" won't match "the office"),
which embeddings would catch — that's the next experiment, likely as a hybrid where the scoring
function keeps veto power. Extraction quality is bounded by a small model being asked to be
conservative, so memory skews sparse rather than wrong — the failure direction I chose on
purpose. And the whole design assumes one querent per reader profile; multi-user would force the
trust model to grow up.

Everything above is covered by the `node:test` suites in `tests/` — the scoring weights, the
jitter windows, the verdict weighting, the TTL suppression, and the prompt-safety fencing are
all pinned by tests, because a memory that quietly drifts is worse than no memory at all.

*Like the rest of this repo, the implementation was built by directing Claude Code against
specs; the design decisions described here are the part I'd defend at a whiteboard — see "How
this was built" in the README.*
