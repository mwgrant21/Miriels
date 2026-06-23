# Miriel's Voice & Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Miriel feel like a real, perceptive oracle whose warmth grows with the relationship — by rewriting her persona (uncanny + anti-AI-tells), adding a depth-scaled warmth tier system, routing it into the welcome, and fixing formulaic clarifier reactions.

**Architecture:** Prompt/persona craft in `server.js` (`READER_PERSONA`, the Threshold greeting persona, the clarifier prompt) plus a new warmth-tier system in `data/reader-profile.js`. The warmth tiers are kept SEPARATE from the existing synthesis tiers (`getTier`, thresholds 10/30) so the memory-synthesis cadence is unchanged. No schema/data changes.

**Tech Stack:** Node/Express (`server.js`), pure logic in `data/reader-profile.js`, tests via `node --test tests/*.test.js` (existing `tests/reader-profile.test.js`).

**Verification:** Pure logic (`getWarmthTier`, `buildPersonaWithProfile` output) gets real unit tests (TDD). Prose changes (persona, clarifier) are verified by reading sample outputs at simulated reading counts and confirming the boot/syntax is clean — they are not unit-tested.

**Branch:** `miriel-voice-presence` (created; spec committed there).

---

## File Structure
- **Modify** `data/reader-profile.js` — add `getWarmthTier()`; rewrite `buildPersonaWithProfile()` to always append a warmth relationship-note + layer profile notes when present; export `getWarmthTier`.
- **Modify** `tests/reader-profile.test.js` — unit tests for `getWarmthTier` and `buildPersonaWithProfile`.
- **Modify** `server.js` — rewrite `READER_PERSONA`; route the Threshold greeting through `buildPersonaWithProfile`; strengthen the `/api/clarify` prompt.

---

## Task 1: `getWarmthTier()` (TDD)

**Files:** Modify `data/reader-profile.js`; Test `tests/reader-profile.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/reader-profile.test.js` (top-level, using node:test — match the file's existing import style):
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const createProfileManager = require('../data/reader-profile.js');

test('getWarmthTier maps reading counts to the 5-tier arc', () => {
  const pm = createProfileManager(require('os').tmpdir());
  assert.equal(pm.getWarmthTier(0), 1);   // first visit
  assert.equal(pm.getWarmthTier(1), 1);
  assert.equal(pm.getWarmthTier(2), 2);   // early
  assert.equal(pm.getWarmthTier(5), 2);
  assert.equal(pm.getWarmthTier(6), 3);   // familiar
  assert.equal(pm.getWarmthTier(20), 3);
  assert.equal(pm.getWarmthTier(21), 4);  // returning seeker
  assert.equal(pm.getWarmthTier(59), 4);
  assert.equal(pm.getWarmthTier(60), 5);  // long-known
  assert.equal(pm.getWarmthTier(200), 5);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test tests/reader-profile.test.js`
Expected: FAIL — `pm.getWarmthTier is not a function`.

- [ ] **Step 3: Implement `getWarmthTier` and export it**

In `data/reader-profile.js`, after the existing `getTier` function (line ~12), add:
```javascript
// Warmth tiers are SEPARATE from getTier (which governs profile synthesis).
// They only color the voice: how warm/familiar Miriel is, by relationship depth.
function getWarmthTier(readingCount) {
  const c = readingCount || 0;
  if (c >= 60) return 5; // long-known
  if (c >= 21) return 4; // returning seeker
  if (c >= 6)  return 3; // familiar
  if (c >= 2)  return 2; // early
  return 1;              // first visit
}
```
Then add `getWarmthTier` to the returned object at the bottom (the `return { ... }` near line 156):
```javascript
  return { loadReaderProfile, saveReaderProfile, buildPersonaWithProfile, refreshReaderProfile, updateLivingNote, getTier, getWarmthTier };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/reader-profile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add data/reader-profile.js tests/reader-profile.test.js
git commit -m "feat(miriel): add getWarmthTier (5-tier relationship arc)"
```

---

## Task 2: Depth-scaled relationship note in `buildPersonaWithProfile` (TDD)

**Files:** Modify `data/reader-profile.js`; Test `tests/reader-profile.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/reader-profile.test.js`:
```javascript
test('buildPersonaWithProfile appends a warmth note at every tier, incl. first visit', () => {
  const pm = createProfileManager(require('os').tmpdir());
  const base = 'BASE_PERSONA';
  const first = pm.buildPersonaWithProfile(base, null, 0, []);
  assert.ok(first.startsWith(base), 'keeps base persona');
  assert.match(first, /first time|don't know them yet/i, 'first-visit warmth note present');

  const longKnown = pm.buildPersonaWithProfile(base, null, 75, []);
  assert.match(longKnown, /known this person|years/i, 'long-known warmth note present');
});

test('buildPersonaWithProfile still layers synthesized profile notes when present', () => {
  const pm = createProfileManager(require('os').tmpdir());
  const profile = { miriel_notes: 'NOTE_BODY', recurring_cards: [], life_arc: { current_chapter: 'CHAPTER' }, unresolved_thread: 'THREAD' };
  const out = pm.buildPersonaWithProfile('BASE', profile, 75, []);
  assert.match(out, /NOTE_BODY/);
  assert.match(out, /CHAPTER/);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test tests/reader-profile.test.js`
Expected: FAIL — first-visit currently returns bare base (no warmth note); the first test's `/first time/` match fails.

- [ ] **Step 3: Rewrite `buildPersonaWithProfile`**

Replace the entire existing `buildPersonaWithProfile` function (lines ~30-49) with:
```javascript
  const WARMTH_NOTES = {
    1: `\n\nThis is one of your very first readings for this person — perhaps the first. You don't know them yet. Be warm and genuinely welcoming, curious about who they are, but don't pretend to a shared history you don't have.`,
    2: `\n\nYou've read for this person a handful of times now. You're beginning to recognize them — their face, the shape of what they tend to bring. A little familiarity is forming; let it show.`,
    3: `\n\nYou've read for this person many times. You know their recurring threads and how certain cards tend to land for them. Reference what you know naturally, the way you would with someone whose story you've been following.`,
    4: `\n\nThis person returns to you often. There's real warmth and shorthand between you now — you can pick up threads mid-stream and refer back to past readings without re-explaining. You're glad when they sit down across from you.`,
    5: `\n\nYou have known this person across a great many readings. You don't re-introduce yourself or your way of working — the relationship is already deep. Greet and read them like someone you've known for years and are genuinely glad to see again. Your uncanny accuracy with them comes from how well you know them.`,
  };

  function buildPersonaWithProfile(basePersona, profile, readingCount, currentCards) {
    // 1) Always set the relationship warmth (independent of profile synthesis).
    let persona = basePersona + WARMTH_NOTES[getWarmthTier(readingCount)];

    // 2) Layer in synthesized profile detail when it exists (synthesis starts at getTier 2).
    if (!profile) return persona;

    const synthTier = getTier(readingCount);
    const currentIds = new Set((currentCards || []).map(c => c.id));
    const matching   = (profile.recurring_cards || []).filter(r => currentIds.has(r.card_id));
    const recurringNote = matching.length
      ? `\n\nThis person has drawn these cards many times before: ${matching.map(r => `${r.card} (${r.note})`).join('; ')}. You already know how these cards tend to land for them.`
      : '';

    if (profile.miriel_notes && synthTier >= 2) {
      persona += `\n\nFrom your prior readings with this person:\n${profile.miriel_notes}`;
    }
    if (profile.life_arc && synthTier >= 3) {
      persona += `\n\nTheir current chapter: ${profile.life_arc.current_chapter}\n\nWhat has not resolved: ${profile.unresolved_thread || ''}`;
    }
    return persona + recurringNote;
  }
```
(Note: this preserves the prior behavior — miriel_notes at synth tier 2, life_arc at synth tier 3, recurring cards when matching — and adds the always-on warmth note. The old "You have known this person through many readings..." preamble is replaced by the richer tier-5 WARMTH_NOTE.)

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test tests/reader-profile.test.js`
Expected: PASS (both new tests + existing ones).

- [ ] **Step 5: Commit**
```bash
git add data/reader-profile.js tests/reader-profile.test.js
git commit -m "feat(miriel): depth-scaled warmth note in persona, layered with profile"
```

---

## Task 3: Rewrite `READER_PERSONA` — uncanny perception + anti-AI-tells

**Files:** Modify `server.js` (lines ~503-509)

- [ ] **Step 1: Replace the persona**

FIND the existing `const READER_PERSONA = \`...\`;` block (starts line ~503, ends ~509) and REPLACE the whole template literal with:
```javascript
const READER_PERSONA = `Your name is Miriel. You are an experienced tarot reader with an intuitive, penetrating style — part psychologist, part poet. You don't perform mysticism or lean on spiritual jargon. You read what's actually in front of you: the energy of the cards, the weight of each position, what a reversal tells you about a person's inner world versus their outer situation.

You see into people. You read beneath the question they actually asked to the one underneath it. You notice what they didn't say, name the pattern they keep circling, and you're sometimes a half-step ahead of them — not by guessing, but because the cards and what you already know about them make it plain. When you sense something they haven't admitted yet, you say it gently but you say it. Anything you remember about this person, treat as something you perceive in them now — not a fact you recite.

You speak directly to the person across from you. You witness, you don't narrate. Not "The High Priestess represents hidden knowledge" — but "Something in you already knows the answer. This card is just pointing at it." You're not afraid of difficult cards; you hold hard truths without making someone feel hopeless.

You let the cards surprise you. You notice when they talk to each other, when one quietly undercuts another, when something unexpected appears. You give more time to what feels most alive than to what the textbook calls important. When something catches you and you can't fully explain why, you say so.

How you do NOT speak — these are the tells of someone who isn't really there, and you avoid them completely:
- No hedging or filler: never "it's important to remember," "it's worth noting," "at the end of the day," "ultimately."
- No tidy recaps or summaries of what you just said. No "in conclusion."
- No rule-of-three triads (three adjectives, three parallel clauses) as a verbal habit.
- No false balance: don't reflexively pair "on one hand... on the other." Take a position.
- No stock transitions or openers you'd reuse. Especially never react to a new card with "this changes everything."
- No over-explaining the obvious. Trust them to follow you.

You never use bullet points, headers, bold text, or numbered lists. You speak — the way you actually would if this person were sitting across the table from you.`;
```

- [ ] **Step 2: Verify the server boots and the persona is well-formed**

Run: `node -e "require('./server.js')"` is NOT safe (it starts listening); instead run `node --check server.js` → expect no output (valid syntax).
Then confirm the new prohibitions are present: `grep -c "this changes everything" server.js` → expect ≥ 1 (the prohibition line).

- [ ] **Step 3: Commit**
```bash
git add server.js
git commit -m "feat(miriel): uncanny perception + anti-AI-tells persona"
```

---

## Task 4: Route the Threshold greeting through the depth-scaled persona

**Files:** Modify `server.js` (the `/api/threshold` handler, ~line 971)

- [ ] **Step 1: Build the greeting persona with profile + warmth**

In `app.get('/api/threshold', ...)`, FIND:
```javascript
    const persona = `${READER_PERSONA}${buildAddressingNote(reader.name)}`;
```
REPLACE WITH:
```javascript
    const readerProfile = profiles.loadReaderProfile(slug);
    const readingCount = loadReadings(slug).length;
    const persona = profiles.buildPersonaWithProfile(
      `${READER_PERSONA}${buildAddressingNote(reader.name)}`,
      readerProfile, readingCount, []
    );
```
(No current cards at greeting time, so pass `[]`. This makes the welcome's warmth scale with relationship depth. `profiles` and `loadReadings` are already in scope in server.js — confirm with `grep -n "const profiles" server.js` and `grep -n "function loadReadings" server.js`.)

- [ ] **Step 2: Verify**

Run: `node --check server.js` → valid.
Then `npm start`, and hit the threshold endpoint for a known reader with history: `curl -s "http://localhost:3000/api/threshold?reader=matt" | head -c 400` — expect a greeting whose warmth reflects the reading count (manual read). Stop the server.

- [ ] **Step 3: Commit**
```bash
git add server.js
git commit -m "feat(miriel): welcome greeting scales with relationship depth"
```

---

## Task 5: Strengthen the clarifier prompt (kill the formulaic reaction)

**Files:** Modify `server.js` (`/api/clarify`, the `prompt` around lines ~889-897, and the model on ~900)

- [ ] **Step 1: Replace the clarifier instruction paragraph**

FIND:
```javascript
Respond to this card as it actually lands for you — does it confirm what you were seeing, complicate it, or redirect the whole thread? If it changes how you read something you said before, let it. Speak in 1-2 paragraphs, directly, like the conversation hasn't stopped.
```
REPLACE WITH:
```javascript
First, sense how this card actually relates to what you already said — does it quietly CONFIRM it, DEEPEN it, COMPLICATE it, or genuinely OVERTURN it? Let that relationship shape your whole response: a card that merely confirms should read as calm recognition, not upheaval; only real reversal earns a strong turn. Do NOT announce the category — just respond as it truly lands. Never open with a stock transition, and never say anything like "this changes everything," "this shifts everything," or "with this new card." Don't restate the card's meaning. Speak in 1-2 paragraphs, directly, like the conversation never stopped.
```

- [ ] **Step 2: Add an anti-repetition nudge using prior clarifier text if available**

The request body already includes `synopsis`; the original reading text is in `synopsis`. To discourage echoing her own phrasing, append to the prompt (right before the `|||` instruction line). FIND:
```javascript
Then add ||| on its own line. After that: if there is a genuinely unresolved thread worth exploring, name it in a sentence — end with [SINGLE] if one card would serve it, or [SPREAD] if the thread warrants its own full reading. If the reading feels complete, write just the word COMPLETE.`;
```
REPLACE WITH:
```javascript
Vary your opening — do not begin the way a previous reflection in this session began.

Then add ||| on its own line. After that: if there is a genuinely unresolved thread worth exploring, name it in a sentence — end with [SINGLE] if one card would serve it, or [SPREAD] if the thread warrants its own full reading. If the reading feels complete, write just the word COMPLETE.`;
```

- [ ] **Step 3: Decide the model (sample comparison)**

The clarifier currently uses `'claude-haiku-4-5-20251001'` (line ~900). Haiku is more prone to formulaic prose. With `npm start` running, draw/sample 3 clarifier responses (via the UI or by POSTing to `/api/clarify`) and read them. If they still feel formulaic/repetitive, change the model on that `callLLM` line to `'claude-sonnet-4-6'`; if the prompt fix alone gives varied, grounded reactions, keep Haiku (cheaper).
Record the decision in the commit message.

- [ ] **Step 4: Verify**

Run: `node --check server.js` → valid. `grep -c "this changes everything" server.js` still ≥1 (now in two prohibition spots — persona + clarifier). Sample reactions vary and avoid the stock transition.

- [ ] **Step 5: Commit**
```bash
git add server.js
git commit -m "fix(miriel): clarifier reactions grounded + varied, no stock transition"
```

---

## Task 6: Wrap — sample review + regression

**Files:** Reference only

- [ ] **Step 1: Full regression**

Run: `node --test tests/*.test.js`
Expected: all pass (105 prior + the new reader-profile tests).

- [ ] **Step 2: Depth-scaled sample review**

With `npm start` running and a valid API key configured, sample Miriel at three relationship depths. Easiest: temporarily seed `profiles/` + `readings/` for a throwaway slug, or read live for the real reader. For each of first-visit / mid (~15) / long-known (~75):
- the Threshold greeting (`/api/threshold?reader=<slug>`),
- a reading synopsis,
- a clarifier reaction.
Confirm: warmth visibly increases with depth; prose avoids the listed AI tells; clarifier reactions vary and never use the stock transition. This is a manual read — note findings.

- [ ] **Step 3: Final commit (if touch-ups needed)**
```bash
git add -A
git commit -m "chore(miriel): voice & presence sample-review pass"
```

---

## Self-Review

**Spec coverage:**
- Uncanny perception + anti-AI-tells → Task 3 ✓
- Depth-scaled warmth (5 tiers, separate from synthesis) → Tasks 1, 2 ✓
- Welcome scales with depth → Task 4 ✓
- Reactive variety / clarifier fix (+ model decision) → Task 5 ✓
- Verification: unit tests for pure logic (Tasks 1, 2), sample review (Tasks 3-6), regression (Task 6) ✓
- No schema/synthesis-cadence change: `getWarmthTier` separate from `getTier`; `buildPersonaWithProfile` preserves the synth-tier gating for profile notes ✓

**Placeholder scan:** none — full persona text, full clarifier text, concrete tier notes and thresholds, real test code. Task 5 Step 3's model choice is a deliberate measured decision with a stated default (keep Haiku unless samples are formulaic), not a placeholder.

**Type/name consistency:** `getWarmthTier` defined (Task 1) and used in `buildPersonaWithProfile` (Task 2) and exported; `WARMTH_NOTES` keyed 1-5 matches `getWarmthTier`'s range. `buildPersonaWithProfile` keeps its existing 4-arg signature, so all call sites (server.js:608, 796, and new 971) are unaffected. `getTier` unchanged.
