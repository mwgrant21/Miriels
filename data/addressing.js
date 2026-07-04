// @ts-check
'use strict';

const { sanitizeUntrusted } = require('./prompt-safety');

// Canonical voice rule: Miriel speaks to the active reader as "you".
// Every LLM endpoint appends one of these to READER_PERSONA — this is the
// single place to tune how she addresses people. Both functions return a
// string that starts with "\n\n" so call sites can concatenate directly.
//
// Names land in persona PROSE, not a fenced block, so they are sanitized
// (not fenced) here at the point they enter the prompt: this strips any
// forged fence tags / control chars without risking Miriel echoing markup.

function buildAddressingNote(readerName) {
  if (!readerName) return '';
  readerName = sanitizeUntrusted(readerName, 80);
  return `\n\nThe person sitting across from you is ${readerName}. They are right there — speak to them as "you," always. Never describe them in the third person or repeat their name back to them as if reading from a file. You may use their name at most once in a reading, only where a real reader would: a quiet greeting, or a single moment that needs weight. Other people in their life — from their question, their prior readings, what you know of them — may be named, but only when the cards genuinely point toward them.`;
}

// Compatibility readings involve two named people. If the active reader is one
// of them, that person is addressed as "you" and the other is named. If the
// reader is asking about two other people, fall back to the general note.
function buildCompatAddressingNote(readerName, personAName, personBName) {
  if (!readerName) return '';
  readerName  = sanitizeUntrusted(readerName, 80);
  personAName = sanitizeUntrusted(personAName, 80);
  personBName = sanitizeUntrusted(personBName, 80);
  const norm = s => String(s || '').trim().toLowerCase();
  const isA  = norm(readerName) === norm(personAName);
  const isB  = norm(readerName) === norm(personBName);
  if (!isA && !isB) return buildAddressingNote(readerName);
  const self  = isA ? personAName : personBName;
  const other = isA ? personBName : personAName;
  return `\n\nOf these two people, ${self} is the one sitting across from you — address ${self} as "you" throughout, and speak about ${other} by name. Never describe ${self} in the third person. You may use ${self}'s own name at most once, where a real reader would: a quiet greeting, or a single moment that needs weight.`;
}

module.exports = { buildAddressingNote, buildCompatAddressingNote };
