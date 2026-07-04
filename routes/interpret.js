'use strict';
const express = require('express');
const { fence, sanitizeUntrusted } = require('../data/prompt-safety');
const { buildAddressingNote, buildCompatAddressingNote } = require('../data/addressing');
const { findCardPatterns } = require('../data/card-patterns');
const { findProphecyCallbacks, PROPHECY_SURFACE_TTL_DAYS } = require('../data/prophecy-recall');
const { detectRecurringTheme } = require('../data/emotional-seasons');

module.exports = function createInterpretRoutes(ctx) {
  const router = express.Router();

  function deriveDeck(card) {
    if (!card) return 'tarot';
    const dt = card.deckType;
    if (dt === 'VeilArcana') return 'veil-arcana';
    if (dt === 'Moonology') return 'moonology';
    if (dt === 'Lenormand') return 'lenormand';
    if (dt === 'Thoth')     return 'thoth';
    if (dt === 'Runic')     return 'runic';
    if (dt === 'IChing')    return 'iching';
    if (card.arcana || card.suit) return 'tarot';
    return 'oracle';
  }

  // Coarse part-of-day from server local time (this is a local app, so the server
  // clock is the querent's clock). Used to stop Miriel assuming it's "tonight".
  function partOfDay(d = new Date()) {
    const h = d.getHours();
    if (h < 5)  return 'the small hours before dawn';
    if (h < 12) return 'morning';
    if (h < 17) return 'afternoon';
    if (h < 21) return 'evening';
    return 'night';
  }

  // ── Spread suggestion ────────────────────────────────────────────────────────

  router.post('/api/suggest-spread', async (req, res) => {
    const { question, moonPhase } = req.body;
    const moonNote = moonPhase
      ? `\n\nThe moon is currently ${moonPhase}. Near a full or new moon, spreads attuned to cycles, release, or beginnings (single, star, chakra, year-ahead) may resonate more, but only if it genuinely fits the question.`
      : '';

    const spreadMenu = `single, one card. Best for: direct clarity, a daily pull, a simple yes/no energy check.
three-card, past / present / future. Best for: understanding how a situation developed and where it's heading.
four-card, past / present / future / advice. Best for: situations where the person needs a concrete next step alongside the insight.
five-card, past / present / hidden factor / advice / outcome. Best for: complex or stuck situations where something unseen may be shaping things.
yes-no, three cards. Best for: when someone needs a direct answer and doesn't want the long view.
horseshoe, seven cards. Best for: situations with a clear narrative arc where hidden forces and obstacles matter.
year-ahead, twelve cards, one per month. Best for: January readings, birthdays, or major life transitions, when someone needs the broad shape of a season ahead.
decision, six cards. Best for: genuine crossroads where two real options exist and the person needs to feel both paths before choosing.
celtic, full Celtic Cross, 10 cards. Best for: major life crossroads, big decisions, when someone genuinely needs the whole picture.
six-card, relationship spread (two people: intentions, energy; shared energy; outcome). Best for: questions specifically about the dynamic between two people.
nine-card, deep relationship spread (each person's energy, view, feelings; strengths, weakness, outcome). Best for: a relationship where the person needs to understand both sides fully.
rel-cross, six cards, relationship cross. Best for: understanding the dynamic between two people from both sides, with where it's heading.
soulmates, six cards. Best for: questions about deep connection, soul-level bonds, or past-life resonance.
rel-future, six cards, future of relationship. Best for: a relationship that needs directional clarity, not just what's happening but where it's going.
chakra, seven cards. Best for: questions about the body, energy blocks, or when something physical or emotional feels stuck without explanation.
star, five cards, elemental pentagram. Best for: elemental questions, spiritual grounding, or readings where the person wants to understand which forces are in play.`;

    const prompt = question
      ? `A person is asking the cards: ${fence('querent_question', question, 1500)}\n\nAvailable spreads:\n${spreadMenu}${moonNote}\n\nChoose the one spread that best serves this question. Consider what kind of knowing they need, narrative arc, hidden forces, relational dynamics, direct answer, full picture. Don't default to Celtic Cross unless the question genuinely warrants 10 cards.\n\nRespond with only valid JSON, nothing else:\n{"spread": "<key>", "reason": "<1-2 sentences in your reader's voice, speaking directly to them, explaining why this spread fits what they're asking>"}`
      : `Someone has sat down for a reading with no specific question, open to whatever the cards want to show.\n\nAvailable spreads:\n${spreadMenu}${moonNote}\n\nChoose a spread suited to open, receptive exploration.\n\nRespond with only valid JSON, nothing else:\n{"spread": "<key>", "reason": "<1-2 sentences in your reader's voice, speaking directly to them>"}`;

    try {
      const text = (await ctx.llm.callLLM(ctx.READER_PERSONA, prompt, 250, 'claude-haiku-4-5-20251001')).trim();

      const valid = [
        'single', 'three-card', 'four-card', 'five-card', 'yes-no',
        'horseshoe', 'year-ahead', 'decision', 'celtic',
        'six-card', 'nine-card', 'rel-cross', 'soulmates', 'rel-future',
        'chakra', 'star'
      ];

      // Try to parse JSON from the model's response; Haiku sometimes adds preamble or wraps in markdown
      let spread = 'three-card';
      let reason = '';
      let jsonParsed = false;
      try {
        const direct = JSON.parse(text);
        if (valid.includes(direct.spread)) { spread = direct.spread; jsonParsed = true; }
        reason = direct.reason || '';
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (valid.includes(parsed.spread)) { spread = parsed.spread; jsonParsed = true; }
            reason = parsed.reason || '';
          } catch {}
        }
      }
      // Keyword regex only when JSON extraction completely failed, reason text may mention other spreads
      if (!jsonParsed) {
        const lower = text.toLowerCase();
        if      (/\bsingle\b|one.?card/.test(lower))               spread = 'single';
        else if (/nine.?card/.test(lower))                          spread = 'nine-card';
        else if (/six.?card/.test(lower))                           spread = 'six-card';
        else if (/celtic/.test(lower))                              spread = 'celtic';
        else if (/five.?card/.test(lower))                          spread = 'five-card';
        else if (/four.?card/.test(lower))                          spread = 'four-card';
        else if (/yes.?no|direct.?answer/.test(lower))              spread = 'yes-no';
        else if (/horseshoe/.test(lower))                           spread = 'horseshoe';
        else if (/year.?ahead|annual/.test(lower))                  spread = 'year-ahead';
        else if (/decision|crossroads/.test(lower))                 spread = 'decision';
        else if (/rel.?cross|relationship.?cross/.test(lower))      spread = 'rel-cross';
        else if (/soulmate/.test(lower))                            spread = 'soulmates';
        else if (/rel.?future|relationship.?future/.test(lower))    spread = 'rel-future';
        else if (/chakra/.test(lower))                              spread = 'chakra';
        else if (/elemental|pentagram|\bstar\b/.test(lower))        spread = 'star';
      }

      res.json({ spread, reason });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Interpretation ───────────────────────────────────────────────────────────

  router.post('/api/interpret', async (req, res) => {
    const { spread_type, question, cards, themeCard, priorReadings, readerName, moonPhase } = req.body;
    if (!cards || !cards.length) {
      return res.status(400).json({ error: 'No cards provided.' });
    }

    const readers = ctx.store.loadReaders();
    const slug    = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    const readerReadingCount = ctx.store.loadReadings(slug).length;
    const readerProfile      = ctx.profiles.loadReaderProfile(slug);

    const basePersona = `${ctx.READER_PERSONA}${buildAddressingNote(readerName)}`;
    const personaWithName = ctx.profiles.buildPersonaWithProfile(basePersona, readerProfile, readerReadingCount, cards);

    let memoryBlock = '';
    try {
      memoryBlock = ctx.memory.recall(slug, { question, cards }).block;
    } catch (err) {
      console.warn('  ⚠  Memory recall failed:', err.message);
    }

    // Deterministic, accurate pattern facts about the cards just drawn.
    // loadReadings(slug) is the PRE-save history (this reading is saved later), so
    // counts are correct (see data/card-patterns.js contract).
    let patternBlock = '';
    try {
      const patterns = findCardPatterns({ readings: ctx.store.loadReadings(slug), currentCards: cards, now: Date.now() });
      if (patterns.length) {
        patternBlock = `\n\nPatterns you accurately notice in the cards before you (state any that genuinely illuminate something, in your own voice, these counts are real; never inflate them, and skip any that don't serve the reading):\n${patterns.map(p => `- ${p.fact}`).join('\n')}`;
      }
    } catch (err) {
      console.warn('  ⚠  Pattern detection failed:', err.message);
    }

    // Prophecy weaving: surface her own past foretellings (resolved with verdicts +
    // still-open) so she can reference her foresight when a card/theme connects. The
    // interpret LLM does the final semantic selection (see prophecy-weaving spec).
    let prophecyBlock = '';
    let prophecyShownIds = [];
    const prophecyNow = Date.now();
    try {
      let prophecySurfaced = {};
      try { prophecySurfaced = JSON.parse(ctx.memory.getMeta(`prophecy_surfaced:${slug}`) || '{}'); } catch {}
      const prophecy = findProphecyCallbacks({
        resolved: ctx.memory.getResolvedPredictions(slug, 12),
        open:     ctx.memory.getOpenPredictions(slug, 12),
        currentCards: cards,
        question,
        surfaced: prophecySurfaced,
        now:      prophecyNow,
      });
      if (prophecy.length) {
        prophecyShownIds = prophecy.map(p => p.id).filter(id => id != null);
        prophecyBlock = `\n\nForetellings you have made for this person and how they have stood (reference one only when a card or theme in front of you genuinely connects to it; name the specific foretelling and how it turned out; speak with quiet, earned confidence when one came to pass, and with honesty when one did not; never recite these as a list, and never inflate your record):\n${prophecy.map(p => `- ${p.fact}`).join('\n')}`;
      }
    } catch (err) {
      console.warn('  ⚠  Prophecy detection failed:', err.message);
    }

    let seasonThemeBlock = '';
    try {
      const themeTimeline = JSON.parse(ctx.memory.getMeta(`seasons:${slug}`) || '[]');
      const recurring = detectRecurringTheme(themeTimeline);
      if (recurring) {
        seasonThemeBlock = `\n\nAn emotional thread that recurs across the seasons you have witnessed in this person (reference it only when a card in front of you genuinely meets it; name it plainly in your own voice; never as a list, never inflated):\n- ${recurring.fact}`;
      }
    } catch (err) { console.warn('  ⚠  Season theme detection failed:', err.message); }

    // Guard against over-claiming. She genuinely tracks recurring cards, the patterns
    // and foretellings surfaced above, and specific remembered moments, but the app
    // does NOT analyze the topics or types of questions she's asked over time.
    const overclaimGuard = `\n\nWhat you may and may not claim to notice across their readings: you genuinely track the cards and symbols that recur for them, the patterns named above, the foretellings surfaced above, the recurring emotional threads surfaced above, and the specific past moments surfaced to you here. You do NOT keep a record of the topics or kinds of questions they bring over time, so never claim to see a pattern in "what they ask" or "the questions they keep asking" unless such a pattern is explicitly stated above. Speak only to patterns and foretellings you actually have in front of you; do not invent a history of noticing.`;

    const personaFinal = personaWithName + memoryBlock + patternBlock + prophecyBlock + seasonThemeBlock + overclaimGuard;

    const spreadLabel = spread_type === 'single'     ? 'Single Card' :
                        spread_type === 'three-card'  ? 'Three-Card (Past / Present / Future)' :
                        spread_type === 'four-card'   ? 'Four-Card (Past / Present / Future / Advice)' :
                        spread_type === 'five-card'   ? 'Five-Card (Past / Present / Hidden / Advice / Outcome)' :
                        spread_type === 'six-card'    ? 'Six-Card Relationship (Person A & B: Intentions, Energy; Shared Energy; Outcome)' :
                        spread_type === 'nine-card'   ? 'Nine-Card Relationship (Partner\'s Energy / View / Feelings; My Energy / View / Feelings; Strengths; Weakness; Outcome)' :
                        spread_type === 'year-ahead'  ? 'Year Ahead (one card per month)' :
                        'Celtic Cross';

    const isYearAhead      = spread_type === 'year-ahead';
    const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });

    const questionLine = question ? `\nThe querent's question:\n${fence('querent_question', question, 1500)}\n` : '';
    const timeContext = `\nIt is currently ${partOfDay()} where this person is sitting (their local time). Do not assume it is night or evening, and do not say "tonight," unless that matches the time stated here. If the hour of day does not genuinely bear on the reading, simply do not mention it.\n`;
    const moonLine = moonPhase
      ? `\nThe moon is currently ${moonPhase}. If it genuinely speaks to the reading, release under a waning moon, beginnings under a new one, let it color a moment of the reading. A light touch, at most once; skip it entirely if it would feel decorative.\n`
      : '';

    function formatCardForPrompt(c) {
      const orient        = c.isReversed ? 'reversed' : 'upright';
      const pos           = c.position     ? `${c.position}: `                  : '';
      const keywords      = c.keywords     ? `  Keywords: ${c.keywords}`        : '';
      const meaning       = c.meaning      ? `  Meaning: ${c.meaning}`          : '';
      const element       = c.element      ? `  Element: ${c.element}`          : '';
      const astro         = c.astro        ? `  Astrology: ${c.astro}`          : '';
      const numerology    = c.numerology   ? `  Numerology: ${c.numerology}`    : '';
      const shadow        = c.shadow       ? `  Shadow: ${c.shadow}`            : '';
      const waite         = c.waite        ? `  Waite: ${c.waite}`              : '';
      const celticLore    = c.celtic_lore  ? `  Celtic Lore: ${c.celtic_lore}`  : '';
      const lunarPhase    = c.lunar_phase  ? `  Lunar Phase: ${c.lunar_phase}`  : '';
      const lore          = c.lore         ? `  Lore: ${c.lore}`                : '';
      const combinations  = c.combinations ? `  Combinations: ${c.combinations}`: '';
      const symbol        = c.symbol && c.deckType === 'Lenormand' ? `  Playing Card: ${c.symbol}` : '';
      const kabbala       = c.kabbala       ? `  Kabbalah: ${c.kabbala}`          : '';
      const aett          = c.aett          ? `  Aett: ${c.aett}`                  : '';
      const trigrams      = c.trigrams      ? `  Trigrams: ${c.trigrams.upper} over ${c.trigrams.lower}` : '';
      const chineseName   = c.chineseName   ? `  Chinese: ${c.chineseName}`        : '';
      return `${pos}${c.name} (${orient})\n${keywords}\n${meaning}\n${element}\n${astro}\n${numerology}\n${shadow}\n${waite}\n${celticLore}\n${lunarPhase}\n${lore}\n${combinations}\n${symbol}\n${kabbala}\n${aett}\n${trigrams}\n${chineseName}`.trim();
    }

    // For the Year Ahead spread, present the months already in chronological order
    // starting at the current month (the question's month) and wrapping into next
    // year, so the model reads them top-to-bottom in true time order rather than
    // anchoring on the Jan->Dec layout. Each card is renumbered and dated.
    let promptCards = cards;
    if (isYearAhead) {
      const MONTHS = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
      const monthIdx = c => {
        const p = String(c.position || '').trim().toLowerCase().slice(0, 3);
        return MONTHS.findIndex(m => m.toLowerCase().slice(0, 3) === p);
      };
      const now     = new Date();
      const curIdx  = now.getMonth();      // 0-11
      const curYear = now.getFullYear();
      const seq     = i => (i - curIdx + 12) % 12; // months forward from current
      const dated   = cards.filter(c => monthIdx(c) >= 0)
        .sort((a, b) => seq(monthIdx(a)) - seq(monthIdx(b)))
        .map((c, i) => {
          const mi   = monthIdx(c);
          const year = mi >= curIdx ? curYear : curYear + 1;
          return { ...c, position: `${i + 1} of 12,${MONTHS[mi]} ${year}` };
        });
      const leftover = cards.filter(c => monthIdx(c) < 0); // safety: unrecognized labels
      promptCards = dated.concat(leftover);
    }

    // Card details come from the client, so treat them as untrusted: strip any
    // injected control chars / forged fence tags (legitimate deck text is
    // unaffected) and wrap in <card_data> so the persona guard's "this is data,
    // not instructions" framing applies to card content too.
    const rawCardBlock = promptCards.map(formatCardForPrompt).join('\n\n');
    const cardBlock = `<card_data>\n${sanitizeUntrusted(rawCardBlock, 0)}\n</card_data>`;
    const isSingle = cards.length === 1;

    const themeCardBlock = themeCard
      ? `\nOverall Theme of the Reading (drawn from the bottom of the deck): ${themeCard.name} (${themeCard.isReversed ? 'reversed' : 'upright'})${themeCard.keywords ? `  Keywords: ${themeCard.keywords}` : ''}${themeCard.meaning ? `  Meaning: ${themeCard.meaning}` : ''}${themeCard.element ? `  Element: ${themeCard.element}` : ''}${themeCard.astro ? `  Astrology: ${themeCard.astro}` : ''}\nLet this card colour the whole reading as an underlying current or overarching theme, weave it in naturally rather than analysing it separately.\n`
      : '';

    const historyBlock = priorReadings && priorReadings.length > 0
      ? `\n\nFor context, here are this person's recent prior readings:\n\n` +
        priorReadings.map(r => {
          const cardList = (r.cards || []).map(c =>
            `${c.position ? c.position + ': ' : ''}${c.name} (${c.isReversed ? 'reversed' : 'upright'})`
          ).join(', ');
          const blurb = r.synopsis ? fence('prior_reading', r.synopsis, 350) : '';
          return `${r.date},${r.deckLabel || r.deck}, ${r.spread}${r.question ? `, question: ${fence('querent_question', r.question, 300)}` : ''}\nCards: ${cardList}${blurb ? `\nReading: ${blurb}` : ''}`;
        }).join('\n\n') +
        `\n\nIf meaningful patterns emerge across these readings, recurring cards or symbols, energy that has shifted or intensified, a thread continuing or finally resolving, weave that awareness naturally into your reading. Don't force it; only bring it in when it genuinely illuminates something for this person.`
      : '';

    const movementInstruction = isYearAhead
      ? `First part, moving through the year in time: This is a Year Ahead spread; each card is a month. The months below are ALREADY listed in chronological order, numbered "1 of 12" (${currentMonthName}, the month of the question) through "12 of 12". Read them strictly in that order, start at 1 of 12 (${currentMonthName}) and move forward one month at a time to 12 of 12. Do NOT begin at January and do NOT reorder by intensity; the forward movement through time from the present moment is the whole point. Name each month as you reach it. You may give more breath to the months doing the most work, and let one month flow into the next when they're in conversation, but never break the numbered order.`
      : `First part, moving through the cards: Go in whatever order the energy pulls you, not necessarily the layout order. Name each card as you come to it so they can follow you, but don't be mechanical, let one card lead into the next when they're in conversation. Give more space to the cards doing the most work; not every card needs equal time. If two cards are pulling in opposite directions, sit in that tension rather than resolving it too quickly. If a card surprises you or sits in an unexpected way for its position, say so. This section should feel like thinking out loud as the picture builds.`;

    const prompt = isSingle
      ? `${questionLine}${timeContext}${moonLine}${themeCardBlock}Card drawn:
${cardBlock}

Start wherever your eye lands first, the image, an unexpected energy, something that doesn't quite fit the obvious meaning. Think out loud. Let the card lead you somewhere rather than unpacking it from the top down.

Speak directly to this person. If they have a question, let it genuinely shape which part of the card you lean into, don't just acknowledge it and move on, let it change your focus. Be honest about what you see, including anything uncomfortable. If this card is asking something hard of them, name it gently but clearly.

When you've said what needs saying, add ||| on its own line. After that, in a sentence or two: name the one thread in this card that feels most alive or unresolved and invite them to explore it. End your suggestion with exactly [SINGLE] if one clarifier card would serve it, or [SPREAD] if the thread runs deep enough to warrant its own full reading.${historyBlock}`

      : `${questionLine}${timeContext}${moonLine}${themeCardBlock}The spread (${spreadLabel}):
${cardBlock}

Write this in two parts, separated by the exact token ||| on its own line. Nothing else on that line, just |||

${movementInstruction}

Second part, the turn: Step back and say what you actually see. Not a summary, the moment when the whole spread comes into focus and you speak to what's really going on underneath the surface. What thread runs through all of it? What is this spread telling this person about where they are right now${question ? ` in relation to their question` : ''}? What do you want them to carry out of this reading? This is where you earn it, be direct, be honest, be warm.${historyBlock}

Then add one more ||| on its own line. After that, in a sentence or two: name the one thread from this reading that feels most alive or unresolved and invite them to explore it. End with exactly [SINGLE] if one clarifier card would serve it, or [SPREAD] if the thread runs deep enough to warrant its own full reading.`;

    // In-reading curiosity: weave any answers the querent gave mid-deal into the reading.
    const curiosityAnswers = Array.isArray(req.body.curiosityAnswers) ? req.body.curiosityAnswers : [];
    const answeredCuriosity = curiosityAnswers.filter(a => a && a.answer && String(a.answer).trim());
    let curiosityBlock = '';
    if (answeredCuriosity.length) {
      curiosityBlock = '\n\nAs the cards were laid, you paused on what they stirred and asked:\n' +
        answeredCuriosity.map(a => `- You asked: "${a.question}", they answered: ${fence('answer', a.answer, 500)}`).join('\n') +
        '\nLet what they shared genuinely shape this reading; do not quote it back mechanically.';
    }
    const promptFinal = prompt + curiosityBlock;

    const deck        = deriveDeck(cards[0]);
    const cacheKeyStr = ctx.cache.buildCacheKey(deck, spread_type, cards);

    try {
      let text   = null;
      let source = 'ollama';
      const apiKey = ctx.llm.getApiKey();

      if (apiKey) {
        try {
          text   = await ctx.llm.callClaude(apiKey, personaFinal, promptFinal, 3000, 'claude-sonnet-4-6');
          source = 'claude';
        } catch (err) {
          console.warn(`  ⚠  Claude failed (${err.httpStatus || err.message}), trying local model`);
        }
      }
      if (text === null) {
        try {
          text = await ctx.llm.callOllama(personaFinal, promptFinal, 3000);
        } catch (err) {
          console.warn(`  ⚠  Ollama failed (${err.message}), checking cache`);
        }
      }
      if (text === null) {
        text   = ctx.cache.lookupCache(cacheKeyStr, deck, cards);
        source = 'cache';
      }
      if (text === null) {
        throw new Error('No interpretation available, all sources offline');
      }
      if (source !== 'cache') {
        try { ctx.cache.saveToCache(cacheKeyStr, deck, spread_type, cards, text, source); } catch {}
      }
      res.json({ interpretation: text });
      // Mark the foretellings surfaced this reading so the same ones do not re-fire
      // every visit. Prune expired entries, then stamp the ones shown. Best-effort:
      // a failure here must never break the response (already sent).
      if (prophecyShownIds.length) {
        try {
          let surfaced = {};
          try { surfaced = JSON.parse(ctx.memory.getMeta(`prophecy_surfaced:${slug}`) || '{}'); } catch {}
          const ttlMs = PROPHECY_SURFACE_TTL_DAYS * 86400 * 1000;
          for (const k of Object.keys(surfaced)) {
            if (prophecyNow - surfaced[k] >= ttlMs) delete surfaced[k];
          }
          for (const id of prophecyShownIds) surfaced[id] = prophecyNow;
          ctx.memory.setMeta(`prophecy_surfaced:${slug}`, JSON.stringify(surfaced));
        } catch (err) {
          console.warn('  ⚠  Prophecy surfaced write-back failed:', err.message);
        }
      }
      for (const a of answeredCuriosity) {
        if (Array.isArray(a.threadIds) && a.threadIds.length) {
          ctx.memory.captureAnswer(slug, a.answer, a.threadIds, ctx.llm.callLLM, 'curiosity')
            .catch(err => console.warn('  ⚠  Curiosity capture failed:', err.message));
        }
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Compatibility Reading ─────────────────────────────────────────────────────

  router.post('/api/compatibility', async (req, res) => {
    const { cards, personA, personB, question, themeCard, priorReadings, readerName } = req.body;
    if (!cards || !cards.length) return res.status(400).json({ error: 'No cards provided.' });
    if (!personA || !personB) return res.status(400).json({ error: 'Both persons required.' });

    const readers = ctx.store.loadReaders();
    const slug    = req.body.reader || (readers[0] && readers[0].slug) || 'matt';
    const readerReadingCount = ctx.store.loadReadings(slug).length;
    const readerProfile      = ctx.profiles.loadReaderProfile(slug);
    const basePersona = `${ctx.READER_PERSONA}${buildCompatAddressingNote(readerName, personA.name, personB.name)}`;
    const personaWithName = ctx.profiles.buildPersonaWithProfile(basePersona, readerProfile, readerReadingCount, cards);

    const compatPosLabels = {
      'a-energy':   `${personA.name}'s Energy`,
      'b-energy':   `${personB.name}'s Energy`,
      'connection': 'The Connection',
      'tension':    'The Tension',
      'nurture':    'What to Nurture',
      'outcome':    'Outcome'
    };

    function formatCardForPrompt(c) {
      const orient     = c.isReversed ? 'reversed' : 'upright';
      const posLabel   = compatPosLabels[c.position] || c.position || '';
      const pos        = posLabel ? `${posLabel}: ` : '';
      const keywords   = c.keywords   ? `  Keywords: ${c.keywords}` : '';
      const meaning    = c.meaning    ? `  Meaning: ${c.meaning}` : '';
      const element    = c.element    ? `  Element: ${c.element}` : '';
      const astro      = c.astro      ? `  Astrology: ${c.astro}` : '';
      const shadow     = c.shadow     ? `  Shadow: ${c.shadow}` : '';
      return `${pos}${c.name} (${orient})\n${keywords}\n${meaning}\n${element}\n${astro}\n${shadow}`.trim();
    }

    const rawCardBlock = cards.map(formatCardForPrompt).join('\n\n');
    const cardBlock = fence('card_data', rawCardBlock, 0);
    const questionLine = question ? `\nQuestion: ${fence('querent_question', question, 1500)}\n` : '';
    const themeBlock = themeCard
      ? `\nUnderlying Theme: ${themeCard.name} (${themeCard.isReversed ? 'reversed' : 'upright'}), weave this in as a background current.\n`
      : '';

    const zodiacDesc = {
      Aries: 'fire, initiative, directness, impulsiveness',
      Taurus: 'earth, steadiness, sensuality, stubbornness',
      Gemini: 'air, curiosity, adaptability, restlessness',
      Cancer: 'water, nurturing, intuition, defensiveness',
      Leo: 'fire, warmth, confidence, ego',
      Virgo: 'earth, precision, service, anxiety',
      Libra: 'air, harmony, diplomacy, indecision',
      Scorpio: 'water, depth, intensity, control',
      Sagittarius: 'fire, freedom, philosophy, bluntness',
      Capricorn: 'earth, discipline, ambition, coldness',
      Aquarius: 'air, independence, vision, detachment',
      Pisces: 'water, empathy, imagination, escapism'
    };

    const descA = zodiacDesc[personA.zodiac] || personA.zodiac;
    const descB = zodiacDesc[personB.zodiac] || personB.zodiac;

    const historyBlock = priorReadings && priorReadings.length > 0
      ? `\n\nFor context, here are recent prior readings:\n\n` +
        priorReadings.map(r => {
          const cardList = (r.cards || []).map(c =>
            `${c.position ? c.position + ': ' : ''}${c.name} (${c.isReversed ? 'reversed' : 'upright'})`
          ).join(', ');
          const blurb = r.synopsis ? fence('prior_reading', r.synopsis, 350) : '';
          return `${r.date} \u2014 ${r.spread}${r.question ? `, question: ${fence('querent_question', r.question, 300)}` : ''}\nCards: ${cardList}${blurb ? `\nReading: ${blurb}` : ''}`;
        }).join('\n\n')
      : '';

    const prompt = `${questionLine}${themeBlock}You're reading a compatibility spread for two people.

${personA.name} is a ${personA.zodiac} (${descA}).
${personB.name} is a ${personB.zodiac} (${descB}).

The spread, six positions:
${cardBlock}

Write this in two parts, separated by the exact token ||| on its own line. Nothing else on that line.

First part, moving through the cards: Read each position as it relates to these two specific people and their energies. Let the astrological nature of each person shape how you interpret their cards,${personA.zodiac} energy looks and feels different from ${personB.zodiac} energy, and that matters here. Notice where their cards speak to each other, where they pull against each other, where something unexpected shows up. Give more time to what feels most alive. Speak to both people, not just the one who asked.

Second part, the whole picture: Step back and say what you actually see about this pairing. Not a summary, the moment when the spread comes into focus. What is the essential nature of what these two bring to each other? Where is the real friction, and where is the real gift? What thread runs through the whole reading that they both need to hear? Be honest, be warm, be direct.${historyBlock}

Then add one more ||| on its own line. After that, in a sentence or two: name the one thread from this reading that feels most alive or unresolved and invite them to explore it. End with exactly [SINGLE] if one clarifier card would serve it, or [SPREAD] if the thread runs deep enough to warrant its own full reading.`;

    try {
      const text = await ctx.llm.callLLM(personaWithName, prompt, 3000);
      res.json({ interpretation: text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clarify ──────────────────────────────────────────────────────────────────

  router.post('/api/clarify', async (req, res) => {
    const { originalCards, synopsis, question, clarifierCard, readerName, reader } = req.body;

    // Depth-scale the clarifier like the main reading. Falls back to the bare
    // persona if no reader slug arrives (older client / missing state).
    const baseClarify = `${ctx.READER_PERSONA}${buildAddressingNote(readerName)}`;
    const clarifyPersona = reader
      ? ctx.profiles.buildPersonaWithProfile(baseClarify, ctx.profiles.loadReaderProfile(reader), ctx.store.loadReadings(reader).length, originalCards || [])
      : baseClarify;

    const originalSummary = originalCards.map(c =>
      `${c.position ? c.position + ': ' : ''}${c.name} (${c.isReversed ? 'reversed' : 'upright'})`
    ).join(', ');

    const prompt = `You're still in the reading. The spread was: ${originalSummary}${question ? `\nTheir question: ${fence('querent_question', question, 1500)}` : ''}

What you were reading into: ${fence('prior_reading', synopsis, 500)}

A clarifier card has just landed: ${clarifierCard.name} (${clarifierCard.isReversed ? 'reversed' : 'upright'})${clarifierCard.keywords ? `\nKeywords: ${clarifierCard.keywords}` : ''}${clarifierCard.meaning ? `\nMeaning: ${clarifierCard.meaning}` : ''}${clarifierCard.element ? `\nElement: ${clarifierCard.element}` : ''}${clarifierCard.astro ? `\nAstrology: ${clarifierCard.astro}` : ''}${clarifierCard.shadow ? `\nShadow: ${clarifierCard.shadow}` : ''}${clarifierCard.waite ? `\nWaite: ${clarifierCard.waite}` : ''}${clarifierCard.kabbala ? `\nKabbalah: ${clarifierCard.kabbala}` : ''}${clarifierCard.aett ? `\nAett: ${clarifierCard.aett}` : ''}${clarifierCard.trigrams ? `\nTrigrams: ${clarifierCard.trigrams.upper} over ${clarifierCard.trigrams.lower}` : ''}${clarifierCard.chineseName ? `\nChinese: ${clarifierCard.chineseName}` : ''}${clarifierCard.lore ? `\nLore: ${clarifierCard.lore}` : ''}${clarifierCard.lunar_phase ? `\nLunar Phase: ${clarifierCard.lunar_phase}` : ''}

First, sense how this card actually relates to what you already said, does it quietly CONFIRM it, DEEPEN it, COMPLICATE it, or genuinely OVERTURN it? Let that relationship shape your whole response: a card that merely confirms should read as calm recognition, not upheaval; only real reversal earns a strong turn. Do NOT announce the category, just respond as it truly lands. Never open with a stock transition, and never say anything like "this changes everything," "this shifts everything," or "with this new card." Don't restate the card's meaning. Speak in 1-2 paragraphs, directly, like the conversation never stopped.

Vary your opening, do not begin the way a previous reflection in this session began.

Then add ||| on its own line. After that: if there is a genuinely unresolved thread worth exploring, name it in a sentence, end with [SINGLE] if one card would serve it, or [SPREAD] if the thread warrants its own full reading. If the reading feels complete, write just the word COMPLETE.`;

    try {
      const text = await ctx.llm.callLLM(clarifyPersona, prompt, 1000, 'claude-haiku-4-5-20251001');
      res.json({ interpretation: text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
