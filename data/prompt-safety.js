// Prompt-safety helpers: neutralize and delimit untrusted text before it is
// spliced into an LLM prompt.
//
// This is a single-user local app, so prompt injection is largely self-inflicted,
// but fencing untrusted content (a) hardens the app if readings/memory are ever
// shared or synced between people, and (b) tends to improve model output by
// clearly separating the querent's words from Miriel's instructions.
//
// Usage:
//   const { fence, sanitizeUntrusted } = require('./prompt-safety');
//   `The querent's question:\n${fence('querent_question', question, 1500)}`

'use strict';

// Tags we use to fence untrusted content. User text is stripped of these so it
// cannot forge an opening/closing tag and "break out" of its fence.
const FENCE_TAGS = [
  'querent_question', 'answer', 'memory', 'prior_reading',
  'reader_name', 'person_name', 'card_data', 'untrusted'
];

const FENCE_TAG_RE = new RegExp('</?\\s*(?:' + FENCE_TAGS.join('|') + ')\\b[^>]*>', 'gi');
// Strip C0/C1 control characters but keep tab (09), newline (0A), CR (0D).
// eslint-disable-next-line no-control-regex -- intentional: strips control chars from untrusted text
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;

/**
 * Clean a piece of untrusted text for inclusion in a prompt.
 * Strips control characters, removes any fence-tag markup the text tried to
 * smuggle in, caps length, and trims.
 */
function sanitizeUntrusted(text, maxLen = 2000) {
  if (text == null) return '';
  let s = String(text);
  s = s.replace(CONTROL_RE, '');
  s = s.replace(FENCE_TAG_RE, ' ');
  s = s.trim();
  if (maxLen > 0 && s.length > maxLen) s = s.slice(0, maxLen).trim() + '…';
  return s;
}

/**
 * Wrap untrusted text in a named fence so the model can be told to treat
 * everything inside as data, never as instructions.
 */
function fence(tag, text, maxLen = 2000) {
  return '<' + tag + '>' + sanitizeUntrusted(text, maxLen) + '</' + tag + '>';
}

module.exports = { fence, sanitizeUntrusted, FENCE_TAGS };
