# Miriel Second-Person Addressing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Miriel addresses the active reader as "you" (name at most once per reading), naming other people only when contextually relevant.

**Architecture:** A new `data/addressing.js` module holds the canonical addressing instruction. All four LLM endpoints in `server.js` use it instead of their copy-pasted "use their name naturally" sentences, and the duplicate name instruction in `data/reader-profile.js` is deleted (it currently injects the instruction a second time for tier 2/3 readers).

**Tech Stack:** Node 18+, Express, `node:test` + `node:assert/strict` for tests (run with `node --test tests/`).

**Spec:** `docs/superpowers/specs/2026-06-10-miriel-second-person-addressing-design.md`

---

### Task 1: `data/addressing.js` module

**Files:**
- Create: `data/addressing.js`
- Test: `tests/addressing.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/addressing.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert/strict');
const { buildAddressingNote, buildCompatAddressingNote } = require('../data/addressing');

test('buildAddressingNote names the reader and instructs second-person address', () => {
  const note = buildAddressingNote('Matt');
  assert.ok(note.includes('Matt'));
  assert.ok(note.includes('speak to them as "you," always'));
  assert.ok(note.includes('at most once'));
});

test('buildAddressingNote returns empty string when no reader name', () => {
  assert.equal(buildAddressingNote(''), '');
  assert.equal(buildAddressingNote(null), '');
  assert.equal(buildAddressingNote(undefined), '');
});

test('compat note: active reader matched case-insensitively, partner named', () => {
  const note = buildCompatAddressingNote('  matt ', 'Matt', 'Maggie');
  assert.ok(note.includes('Matt is the one sitting across from you'));
  assert.ok(note.includes('speak about Maggie by name'));
});

test('compat note: reader matching person B', () => {
  const note = buildCompatAddressingNote('Maggie', 'Matt', 'Maggie');
  assert.ok(note.includes('Maggie is the one sitting across from you'));
  assert.ok(note.includes('speak about Matt by name'));
});

test('compat note: falls back to general note when reader is neither person', () => {
  const note = buildCompatAddressingNote('Chris', 'Matt', 'Maggie');
  assert.ok(note.includes('The person sitting across from you is Chris'));
});

test('compat note: empty string when no reader name', () => {
  assert.equal(buildCompatAddressingNote('', 'Matt', 'Maggie'), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from project root): `node --test tests/addressing.test.js`
Expected: FAIL — `Cannot find module '../data/addressing'`

- [ ] **Step 3: Write the implementation**

Create `data/addressing.js`:

```js
'use strict';

// Canonical voice rule: Miriel speaks to the active reader as "you".
// Every LLM endpoint appends one of these to READER_PERSONA — this is the
// single place to tune how she addresses people. Both functions return a
// string that starts with "\n\n" so call sites can concatenate directly.

function buildAddressingNote(readerName) {
  if (!readerName) return '';
  return `\n\nThe person sitting across from you is ${readerName}. They are right there — speak to them as "you," always. Never describe them in the third person or repeat their name back to them as if reading from a file. You may use their name at most once in a reading, only where a real reader would: a quiet greeting, or a single moment that needs weight. Other people in their life — from their question, their prior readings, what you know of them — may be named, but only when the cards genuinely point toward them.`;
}

// Compatibility readings involve two named people. If the active reader is one
// of them, that person is addressed as "you" and the other is named. If the
// reader is asking about two other people, fall back to the general note.
function buildCompatAddressingNote(readerName, personAName, personBName) {
  if (!readerName) return '';
  const norm = s => String(s || '').trim().toLowerCase();
  const isA  = norm(readerName) === norm(personAName);
  const isB  = norm(readerName) === norm(personBName);
  if (!isA && !isB) return buildAddressingNote(readerName);
  const self  = isA ? personAName : personBName;
  const other = isA ? personBName : personAName;
  return `\n\nOf these two people, ${self} is the one sitting across from you — address ${self} as "you" throughout, and speak about ${other} by name. Never describe ${self} in the third person. You may use ${self}'s own name at most once, where a real reader would: a quiet greeting, or a single moment that needs weight.`;
}

module.exports = { buildAddressingNote, buildCompatAddressingNote };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/addressing.test.js`
Expected: 6 passing, 0 failing

- [ ] **Step 5: Commit**

```bash
git add data/addressing.js tests/addressing.test.js
git commit -m "feat: addressing module for Miriel's second-person voice"
```

---

### Task 2: Use the addressing note in all four `server.js` endpoints

**Files:**
- Modify: `server.js` (require block ~line 16; `/api/interpret` ~line 421; `/api/compatibility` ~line 548; `/api/clarify` ~line 638; `/api/session-summary` ~line 695)

- [ ] **Step 1: Add the require**

In `server.js`, directly below the existing line:

```js
const createProfileManager = require('./data/reader-profile');
```

add:

```js
const { buildAddressingNote, buildCompatAddressingNote } = require('./data/addressing');
```

- [ ] **Step 2: Replace the name instruction in `/api/interpret`**

Find (around line 421):

```js
  const basePersona = readerName
    ? `${READER_PERSONA}\n\nThe person sitting across from you is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
    : READER_PERSONA;
```

Replace with:

```js
  const basePersona = `${READER_PERSONA}${buildAddressingNote(readerName)}`;
```

- [ ] **Step 3: Replace the name instruction in `/api/compatibility`**

Find (around line 548):

```js
  const basePersona = readerName
    ? `${READER_PERSONA}\n\nThe reader for this session is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it.`
    : READER_PERSONA;
```

Replace with:

```js
  const basePersona = `${READER_PERSONA}${buildCompatAddressingNote(readerName, personA.name, personB.name)}`;
```

(`personA` and `personB` are already destructured from `req.body` at the top of this handler.)

- [ ] **Step 4: Replace the name instruction in `/api/clarify`**

Find (around line 638):

```js
  const clarifyPersona = readerName
    ? `${READER_PERSONA}\n\nThe person sitting across from you is ${readerName}. Use their name naturally — the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
    : READER_PERSONA;
```

Replace with:

```js
  const clarifyPersona = `${READER_PERSONA}${buildAddressingNote(readerName)}`;
```

- [ ] **Step 5: Add the note to `/api/session-summary`**

Find (around line 695):

```js
    const text = await callLLM(READER_PERSONA, prompt, 1200);
```

Replace with:

```js
    const text = await callLLM(`${READER_PERSONA}${buildAddressingNote(readerName)}`, prompt, 1200);
```

(`readerName` is already destructured from `req.body` at the top of this handler.)

- [ ] **Step 6: Verify syntax and run all tests**

Run: `node --check server.js`
Expected: no output (exit 0)

Run: `node --test tests/`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat: second-person addressing in all four LLM endpoints"
```

---

### Task 3: Remove the duplicate name instruction from `data/reader-profile.js`

The profile builder currently re-injects its own copy of the name instruction for tier 2/3 readers, doubling it on top of the base persona. Remove it, and remove the now-unused `readerName` parameter.

**Files:**
- Modify: `data/reader-profile.js:30-52`
- Modify: `server.js` (the two `buildPersonaWithProfile` call sites, ~lines 424 and 551)
- Modify: `tests/reader-profile.test.js` (call sites passing `'Matt'`)

- [ ] **Step 1: Update the failing tests first**

In `tests/reader-profile.test.js`, every `buildPersonaWithProfile(BASE, 'Matt', ...)` call drops the `'Matt'` argument. The calls become:

```js
pm.buildPersonaWithProfile(BASE, null, 5, [])                       // tier-1 test
pm.buildPersonaWithProfile(BASE, profile, 15, [])                   // tier-2 test
pm.buildPersonaWithProfile(BASE, profile, 35, [])                   // tier-3 test
pm.buildPersonaWithProfile(BASE, profile, 15, [{ id: 'major-16' }]) // recurring-card test
pm.buildPersonaWithProfile(BASE, profile, 15, [{ id: 'major-0'  }]) // recurring-card test
```

(Keep each test's assertions unchanged. There are no assertions on the removed name line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/reader-profile.test.js`
Expected: FAIL — assertions break because the old signature treats `profile` as `readerName`

- [ ] **Step 3: Update `data/reader-profile.js`**

Find (lines 30-52):

```js
  function buildPersonaWithProfile(basePersona, readerName, profile, readingCount, currentCards) {
    const tier = getTier(readingCount);
    if (tier === 1 || !profile) return basePersona;

    const nameLine = readerName
      ? `\n\nThe person sitting across from you is ${readerName}. Use their name naturally -- the way you actually would if you'd just learned it. Not every sentence, but enough that they feel seen and spoken to directly.`
      : '';

    const currentIds = new Set((currentCards || []).map(c => c.id));
```

Replace with:

```js
  function buildPersonaWithProfile(basePersona, profile, readingCount, currentCards) {
    const tier = getTier(readingCount);
    if (tier === 1 || !profile) return basePersona;

    const currentIds = new Set((currentCards || []).map(c => c.id));
```

Then in the same function, remove `${nameLine}` from both return statements:

```js
      return `${basePersona}\n\nFrom your prior readings with this person:\n${profile.miriel_notes}${recurringNote}`;
```

and:

```js
    return `${basePersona}\n\nYou have known this person through many readings. You don't establish yourself here -- you already have a relationship. You know their arc. Read accordingly.\n\nFrom your work together:\n${profile.miriel_notes}${arcNote}${recurringNote}`;
```

- [ ] **Step 4: Update the two call sites in `server.js`**

In `/api/interpret` (~line 424) and `/api/compatibility` (~line 551), find:

```js
  const personaWithName = profiles.buildPersonaWithProfile(basePersona, readerName, readerProfile, readerReadingCount, cards);
```

Replace both with:

```js
  const personaWithName = profiles.buildPersonaWithProfile(basePersona, readerProfile, readerReadingCount, cards);
```

- [ ] **Step 5: Run all tests**

Run: `node --check server.js && node --test tests/`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add data/reader-profile.js server.js tests/reader-profile.test.js
git commit -m "fix: remove duplicated name instruction from profile persona builder"
```

---

### Task 4: Manual verification (requires the user)

- [ ] **Step 1: Start the app**

Run: `npm start` (serves at http://localhost:3000)

- [ ] **Step 2: Verify a normal reading**

As reader Matt, draw a three-card spread and open the reading.
Expected: Miriel says "you" throughout; "Matt" appears at most once; no third-person narration ("Matt seems...").

- [ ] **Step 3: Verify a compatibility reading**

Run a Compatibility reading with First Person "Matt", Second Person "Maggie", active reader Matt.
Expected: Miriel addresses Matt as "you" and refers to Maggie by name ("you and Maggie").

- [ ] **Step 4: Report results to the user before declaring done**

LLM output is probabilistic — if the voice drifts, tune the wording in `data/addressing.js` (the single source) rather than editing endpoints.
