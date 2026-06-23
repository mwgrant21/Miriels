# Miriel Second-Person Addressing — Design

Date: 2026-06-10
Status: Approved

## Problem

Miriel's system prompts tell her to "use their name naturally," so she narrates the
active reader by name ("Matt seems troubled") instead of speaking to them ("You seem
troubled"). For tier 2/3 readers the instruction is injected twice — once in the base
persona built in `server.js`, and again by `buildPersonaWithProfile()` in
`data/reader-profile.js` — which amplifies the name-dropping for exactly the readers
who should feel most personally addressed.

## Goal

Miriel addresses the active reader as "you" throughout. Her own client's name appears
at most once per reading, only where a real reader would use it (a greeting, a moment
of weight). Other people in the reader's life (from the question, prior readings, or
profile notes) may be named, but only when the cards genuinely point toward them —
e.g. "You seem troubled. Is it about Maggie?"

## Approach (chosen: shared helper)

Considered: (A) edit each prompt string in place — keeps the copy-paste duplication
that caused the double-injection bug; (B) one shared addressing-instruction helper —
single place to tune the voice; (C) full persona overhaul — too much blast radius for
an already-tuned voice. Chose B.

## Design

### New helper

A small module (e.g. `data/addressing.js`) exporting `buildAddressingNote(readerName)`
returning the canonical voice rule:

> The person sitting across from you is {readerName}. They are right there — speak to
> them as "you," always. Never describe them in the third person or repeat their name
> back to them as if reading from a file. You may use their name at most once in a
> reading, only where a real reader would: a quiet greeting, or a single moment that
> needs weight. Other people in their life — from their question, their prior
> readings, what you know of them — may be named, but only when the cards genuinely
> point toward them.

Returns an empty string when `readerName` is falsy.

### Call sites

- `/api/interpret` (`server.js` ~421): replace the inline "use their name naturally"
  sentence with the helper output.
- `/api/clarify` (`server.js` ~638): same.
- `/api/compatibility` (`server.js` ~548): if `readerName` matches `personA.name` or
  `personB.name` (case-insensitive, trimmed), use a compatibility variant: address the
  matching person as "you" and refer to the other by name ("you and Maggie"). If the
  reader is neither person, keep current behavior (both named, third person).
- `/api/session-summary` (`server.js` ~695): currently passes the bare
  `READER_PERSONA` as system prompt; append the addressing note so summaries also
  speak in second person.
- `data/reader-profile.js` `buildPersonaWithProfile()`: delete the duplicate
  `nameLine`. Profile context ("this person has drawn these cards many times") stays
  third person — it is Miriel's private context, not her speech.

## Error handling

No new failure modes: helper is pure string construction; falsy readerName yields
current anonymous behavior unchanged.

## Testing

- Unit tests for `buildAddressingNote`: contains the reader's name, instructs "you",
  empty string for missing name; compatibility variant names the partner.
- Update `tests/reader-profile.test.js` if it asserts on the removed `nameLine`.
- Manual verification: run a reading as Matt (expect "you", at most one "Matt");
  run a Matt + Maggie compatibility reading (expect "you and Maggie").
