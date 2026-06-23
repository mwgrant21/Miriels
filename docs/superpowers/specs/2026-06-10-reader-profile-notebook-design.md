# Your Story So Far — Reader Profile Notebook (Design)

Date: 2026-06-10
Status: Approved

## Problem

The reader profile system (`data/reader-profile.js`) synthesizes rich, Miriel-voiced
insight from a reader's history — notebook notes, recurring cards with observations,
a life-arc chapter, key threads, an unresolved thread — but none of it is visible in
the UI. It only feeds her system prompts. Readers with dozens of sessions have a
story they cannot see.

## Goal

A "Your Story So Far" view: a full-screen cinematic takeover where Miriel opens her
notebook on the active reader. Entered deliberately from the reader menu, private by
default, styled to match the existing Miriel's Choice takeover aesthetic.

## Decisions made during brainstorm

- **Presentation: hybrid** — her chapter line and notebook notes lead; recurring
  cards and threads appear below as supporting evidence. (Chosen over pure narrative
  and pure stats dashboard.)
- **Placement: cinematic takeover** — full-screen overlay reusing the Miriel's
  Choice takeover styling, not a settings-style modal or always-visible inline panel.
  (Privacy matters: multiple readers share the app and notes can mention each other.)
- **Empty state: teaser** — the menu entry is always present; readers under tier 2
  see a short in-voice line ("I'm still getting to know you. Sit with me a few more
  times.") plus the number of readings remaining until her notebook opens.
- **Recurring cards: real card art** — framed thumbnails from the deck images, with
  count and Miriel's per-card note.
- **Notes voice: third person, verbatim** — the notebook displays her stored notes
  exactly as written ("Matt is one of the most consistent seekers..."). You are
  peeking into *her* notebook. No changes to the profile-refresh prompts or the
  persona injection.

## Backend

New endpoint `GET /api/profiles/:slug`:

- 404 if the slug is not in `readers.json`.
- Response: `{ profile, readingCount, tier }` where `profile` is the stored profile
  JSON or `null`, `readingCount` is `loadReadings(slug).length`, and `tier` comes
  from the existing `getTier()`.
- No new write paths. Profile refresh cadence (every 5 readings, 10 past 30) is
  untouched.

## Frontend

### Entry point

`populateReaderDropdown()` in `public/app.js` gains a menu item — "✦ Your Story So
Far" — beneath the reader rows. It opens the notebook for the *active* reader.

### Overlay

A new full-screen overlay element (pattern of `#miriel-takeover`: fixed, dark radial
backdrop, ornament header). Closes via `esc`, a close affordance, and backdrop
click. While open, page scroll is locked; the overlay itself scrolls.

### Content sections (tier 3)

In order, all data straight from the profile:

1. **Header** — ornament, "YOUR STORY SO FAR", meta line: "as Miriel has come to
   know you · N readings · last updated {date}" (from `readings_synthesized` /
   `last_updated`).
2. **Chapter quote** — `life_arc.current_chapter`, italic, centered.
3. **From her notebook** — `miriel_notes` paragraphs, verbatim.
4. **The cards that keep finding you** — `recurring_cards`: card image thumbnail
   (resolved by `card_id` from the deck image manifest, falling back to a styled
   placeholder if no image), "{card} ×{count}", and the `note` beneath.
5. **The threads** — `life_arc.key_threads`: status glyph + colored status word
   (open / moving / resolved) + theme.
6. **What keeps surfacing** — `unresolved_thread`, set apart by a hairline rule.
   Include `life_arc.inflection_points` here if non-empty.
7. **Footer** — "esc · return to the table".

### Tier behavior

- **Tier 1 (no profile):** teaser state — ornament, title, in-voice line, and
  "{remaining} more readings until she opens it" (remaining = 10 − readingCount).
  Also shown if the profile file is missing/unreadable regardless of count.
- **Tier 2:** sections 1, 3, 4 (no chapter quote, threads, or unresolved thread —
  the profile lacks `life_arc` until tier 3).
- **Tier 3:** all sections. Any individually-missing field is skipped silently.

### Card image resolution

Recurring cards store `card_id` (e.g. `major_09`). The notebook resolves images the
same way the spread renderer does for the reader's deck history — implementation
detail for the plan, but the spec requirement is: tarot card ids resolve to
Rider-Waite images by default; unresolvable ids render the styled placeholder frame
(gold border, glyph) used in the approved mockup.

## Error handling

- Fetch failure or 404: open the overlay with the tier-1 teaser and a quiet
  "couldn't reach her notebook" note rather than an error dialog.
- Malformed/partial profile JSON: render whatever fields exist; skip the rest.

## Testing

- Server test: `GET /api/profiles/:slug` returns 404 for unknown reader, `{ profile:
  null, readingCount, tier: 1 }` for a reader without a profile file, and the full
  payload for a reader with one (fits existing `tests/` node:test style).
- Manual: open the notebook as Matt (tier 3, all sections, real card art); switch to
  a fresh reader (teaser with remaining count); `esc` and backdrop close; scroll
  behavior with long notes.

## Out of scope

- Changing profile content, refresh prompts, or cadence.
- A "refresh now" button in the notebook.
- Per-reader privacy locks/PINs.
