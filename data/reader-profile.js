'use strict';
const path = require('path');
const fs   = require('fs');

const T2 = 10;
const T3 = 30;

function getTier(readingCount) {
  if (readingCount >= T3) return 3;
  if (readingCount >= T2) return 2;
  return 1;
}

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

module.exports = function createProfileManager(dataDir) {
  const profilesDir = path.join(dataDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });

  function loadReaderProfile(slug) {
    try {
      const p = path.join(profilesDir, `${slug}.json`);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return null;
  }

  function saveReaderProfile(slug, profile) {
    fs.writeFileSync(path.join(profilesDir, `${slug}.json`), JSON.stringify(profile, null, 2));
  }

  const WARMTH_NOTES = {
    1: `\n\nThis is one of your very first readings for this person, perhaps the first. You don't know them yet. Be warm and genuinely welcoming, curious about who they are, but don't pretend to a shared history you don't have.`,
    2: `\n\nYou've read for this person a handful of times now. You're beginning to recognize them, their face, the shape of what they tend to bring. A little familiarity is forming; let it show.`,
    3: `\n\nYou've read for this person many times. You know their recurring threads and how certain cards tend to land for them. Reference what you know naturally, the way you would with someone whose story you've been following.`,
    4: `\n\nThis person returns to you often. There's real warmth and shorthand between you now, you can pick up threads mid-stream and refer back to past readings without re-explaining. You're glad when they sit down across from you.`,
    5: `\n\nYou have known this person across a great many readings. You don't re-introduce yourself or your way of working, the relationship is already deep. Greet and read them like someone you've known for years and are genuinely glad to see again. Your uncanny accuracy with them comes from how well you know them.`,
  };

  function buildPersonaWithProfile(basePersona, profile, readingCount, currentCards) {
    // 1) Always set relationship warmth (independent of profile synthesis).
    //    `?? ''` guards against a future tier without a matching WARMTH_NOTES key.
    let persona = basePersona + (WARMTH_NOTES[getWarmthTier(readingCount)] ?? '');

    // 2) Layer synthesized profile detail when it exists (synthesis starts at getTier 2).
    if (!profile) return persona;

    const synthTier = getTier(readingCount);
    // Below the synthesis tier there is no real profile to draw on, show nothing
    // extra (matches the prior early-return so recurring cards don't leak in early).
    if (synthTier < 2) return persona;

    const currentIds = new Set((currentCards || []).map(c => c.id));
    const matching   = (profile.recurring_cards || []).filter(r => currentIds.has(r.card_id));
    const recurringNote = matching.length
      ? `\n\nThis person has drawn these cards many times before: ${matching.map(r => `${r.card} (${r.note})`).join('; ')}. You already know how these cards tend to land for them.`
      : '';

    if (profile.miriel_notes) {
      persona += `\n\nFrom your prior readings with this person:\n${profile.miriel_notes}`;
    }
    if (profile.life_arc && synthTier >= 3) {
      persona += `\n\nTheir current chapter: ${profile.life_arc.current_chapter}\n\nWhat has not resolved: ${profile.unresolved_thread || ''}`;
    }
    return persona + recurringNote;
  }

  async function refreshReaderProfile(slug, callLLM, loadReadings) {
    const readings = loadReadings(slug);
    if (readings.length < T2) return;

    const tier = getTier(readings.length);

    const readingsText = readings.map(r => {
      const cardList = (r.cards || [])
        .map(c => `${c.position ? c.position + ': ' : ''}${c.name} (${c.isReversed ? 'reversed' : 'upright'})`)
        .join(', ');
      return `${r.date || 'unknown date'} -- ${r.deckLabel || r.deck || 'tarot'}, ${r.spread || 'unknown spread'}${r.question ? `, question: "${r.question}"` : ''}\nCards: ${cardList}${r.synopsis ? `\nNotes: ${r.synopsis.slice(0, 200)}` : ''}`;
    }).join('\n\n');

    const systemPrompt = 'You are Miriel, an experienced tarot reader.';

    let userPrompt;
    if (tier === 2) {
      userPrompt = `You have been reading for this person across ${readings.length} sessions. Below is the complete history of their readings with you.\n\n${readingsText}\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2 paragraphs in your own voice -- what patterns are you starting to notice?]\n\nRECURRING_CARDS:\n[JSON array: [{"card":"name","card_id":"id","count":N,"note":"how it tends to land"}] -- top 3 only, or []]`;
    } else {
      userPrompt = `You have been reading for this person across ${readings.length} sessions over time. Read this history the way you would read a long relationship -- not as data, but as a story.\n\n${readingsText}\n\nWrite your notes using these exact labels:\n\nMIRIEL_NOTES:\n[2-3 paragraphs in your own voice. What do you actually know about this person from the cards?]\n\nLIFE_ARC_CHAPTER:\n[1-2 sentences: what is the current period about for them?]\n\nKEY_THREADS:\n[JSON array: [{"theme":"...","status":"open|moving|resolved"}] -- 2-3 most significant]\n\nINFLECTION_POINTS:\n[1-2 sentences on any clear before/after moment, or leave blank]\n\nUNRESOLVED_THREAD:\n[The one thing that keeps surfacing without resolution]\n\nRECURRING_CARDS:\n[JSON array: [{"card":"name","card_id":"id","count":N,"note":"how it tends to land"}] -- top 5, or []]`;
    }

    const raw = await callLLM(systemPrompt, userPrompt, 1500);

    function extract(label) {
      // lookahead stops at next uppercase label; [A-Z][A-Z_]+ avoids matching indented lines from a rambling LLM
      const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z][A-Z_]+:|$)`, 'i');
      const m  = raw.match(re);
      return m ? m[1].trim() : '';
    }
    function extractJSON(label) {
      try { return JSON.parse(extract(label)); } catch { return []; }
    }

    const profile = {
      slug,
      last_updated:          Math.floor(Date.now() / 1000),
      readings_synthesized:  readings.length,
      miriel_notes:          extract('MIRIEL_NOTES'),
      recurring_cards:       extractJSON('RECURRING_CARDS'),
    };

    if (tier === 3) {
      profile.life_arc = {
        current_chapter:   extract('LIFE_ARC_CHAPTER'),
        key_threads:       extractJSON('KEY_THREADS'),
        inflection_points: extract('INFLECTION_POINTS'),
      };
      profile.unresolved_thread = extract('UNRESOLVED_THREAD');
    }

    if (!profile.miriel_notes) return; // don't persist a degraded profile if LLM extraction failed

    // The living note is maintained per-reading (updateLivingNote) on a faster cadence
    // than this full re-synthesis, carry it across so a refresh never wipes it.
    const prev = loadReaderProfile(slug);
    if (prev && prev.living_note) {
      profile.living_note         = prev.living_note;
      profile.living_note_updated = prev.living_note_updated;
    }

    saveReaderProfile(slug, profile);
    console.log(`  + Reader profile refreshed for ${slug} (tier ${tier}, ${readings.length} readings)`);
  }

  // A short, present-tense "where things stand" note in Miriel's voice, refreshed
  // after every reading (cheap Haiku call). Lives alongside the periodic synthesis
  // and is preserved by refreshReaderProfile. Best-effort: never throws into the save path.
  const LIVING_NOTE_SYSTEM =
    'You are Miriel, an experienced tarot reader keeping a private running note on the person you read for. ' +
    'In your own voice and the second person ("you"), write one or two sentences on where things stand for them ' +
    'right now, drawing on their most recent readings. Present tense, warm, specific. Speak to them as "you", ' +
    'never name them or use the third person. No preamble or label, just the note.';

  async function updateLivingNote(slug, callLLM, loadReadings) {
    const readings = (loadReadings(slug) || []).slice(-3);
    if (!readings.length) return;

    const block = readings.map(r => {
      const cards = (r.cards || []).map(c => `${c.name}${c.isReversed ? ' (reversed)' : ''}`).join(', ');
      return `${r.date || ''} -- ${r.question ? `"${r.question}"` : 'no question'}\nCards: ${cards}` +
             `${r.synopsis ? `\n${String(r.synopsis).slice(0, 400)}` : ''}`;
    }).join('\n\n');

    let note;
    try {
      note = await callLLM(
        LIVING_NOTE_SYSTEM,
        `The most recent readings with this person:\n\n${block}\n\nWrite your running note now (1-2 sentences, second person "you").`,
        200,
        'claude-haiku-4-5-20251001'
      );
    } catch {
      return; // best-effort; a failed note must not break the reading save
    }
    note = String(note || '').trim();
    if (!note) return;

    const profile = loadReaderProfile(slug) || { slug };
    profile.living_note         = note;
    profile.living_note_updated = Math.floor(Date.now() / 1000);
    saveReaderProfile(slug, profile);
    console.log(`  + Living note updated for ${slug}`);
  }

  return { loadReaderProfile, saveReaderProfile, buildPersonaWithProfile, refreshReaderProfile, updateLivingNote, getTier, getWarmthTier };
};
