# Miriel's Lunar Oracle Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Miriel's Lunar Oracle as a fully-functional 45-card deck in the tarot app, with live app-composite text (title + keyword line) over clean art, reversed-image-only behavior, and placeholder images for all cards.

**Architecture:** New `data/miriel-lunar.json` (45 cards, deckType `MirielLunar`) + `public/images/miriel-lunar/` folder registered in both server.js and app.js. A new `.miriel-lunar-card` CSS pattern renders title/keyword as live overlay in the lower 22% of each card face; only the `<img>` rotates on reversed draws while the title stays upright.

**Tech Stack:** Node/Express (server), Vanilla JS (frontend), CSS (overlay), PowerShell (placeholder image setup)

## Global Constraints

- deckType string: `MirielLunar` (matches CamelCase pattern of existing decks)
- Internal deck key: `miriel-lunar` (matches kebab-case pattern of existing keys)
- Display name: `Miriel's Lunar Oracle`
- Image folder: `public/images/miriel-lunar/`
- Data file: `data/miriel-lunar.json`
- Card IDs: hyphenated slugs matching image filenames (e.g. `new-moon`, `new-moon-aries`)
- No text baked into art files — title + keyword_line are live app text
- Reversed draws: only `<img>` rotates 180deg; title overlay + REVERSED badge stay upright
- 45 cards: 8 phase + 12 new-moon-sign + 12 full-moon-sign + 6 phenomena + 7 passage
- Keep existing `moonology` deck intact throughout; this is an addition, not a replacement

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `data/miriel-lunar.json` | Create | All 45 card definitions |
| `public/images/miriel-lunar/` | Create | Placeholder images named by card ID |
| `server.js` | Modify | Register deck in deckFiles, deckDirs, load + serve JSON |
| `public/app.js` | Modify | Register deck in allCards, MIRIEL_DECKS, GRIMOIRE_DECKS, deck-select, buildCardFace, cardBackUrl, spread pools |
| `public/style.css` | Modify | `.miriel-lunar-card` overlay styles |

---

### Task 1: Create data/miriel-lunar.json

**Files:**
- Create: `data/miriel-lunar.json`

**Interfaces:**
- Produces: array of 45 card objects consumed by server.js `/api/cards` response
- Each card shape: `{ id, name, deckType, symbol, keywords, keyword_line, group, halo, upright, reversed }`

- [ ] **Step 1: Create the JSON file**

Create `C:\Users\Matt\projects\tarot\data\miriel-lunar.json` with all 45 cards:

```json
[
  {
    "id": "new-moon",
    "name": "New Moon",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["new beginnings", "intention", "potential", "blank slate"],
    "keyword_line": "The seed waits in the dark.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The moment before the moment. You stand at the threshold of a cycle that does not yet have a shape. Name what you want to call into being — not as a demand, but as a seed pressed into soil. The dark holds it. Intention set now moves with the current of what is coming; intention withheld stays unreachable. What do you most want to plant in the dark before the light returns?",
    "reversed": "You are entering a new cycle still carrying the weight of the last one. The blank slate is not yet blank. Before you plant new seed, clear the ground. What are you holding that does not belong in the next chapter?"
  },
  {
    "id": "waxing-crescent",
    "name": "Waxing Crescent",
    "deckType": "MirielLunar",
    "symbol": "🌒",
    "keywords": ["first steps", "commitment", "faith", "momentum"],
    "keyword_line": "A first green shoot breaks the soil.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The first action is taken. The thing you set in motion at the new moon is showing its first visible signs of life. This is the moment when doubt most wants to creep in — the shoot is fragile and the soil is still uncertain. Keep going. Water what you have started without demanding it prove itself yet.",
    "reversed": "The shoot appeared and you second-guessed it. You are pulling up what you planted before it has had time to take root. Resist the urge to restart. What you began had life in it; trust it a little longer before you abandon it."
  },
  {
    "id": "first-quarter",
    "name": "First Quarter",
    "deckType": "MirielLunar",
    "symbol": "🌓",
    "keywords": ["challenge", "decision", "action", "resolve"],
    "keyword_line": "The path forks; choose, and walk.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The obstacle has arrived exactly on schedule. The first quarter always brings a test — some friction, some fork in the road, some cost that makes you question whether the intention was real. It was. Make the choice. The point of this moment is not to have the perfect answer, but to prove to yourself that you have the resolve to keep moving even when it costs something.",
    "reversed": "You are stuck at the crossroads. Waiting will not dissolve the choice; the road is still forked. The paralysis is information — something about this decision feels misaligned. Look at what is holding you and name it, then make the call anyway."
  },
  {
    "id": "waxing-gibbous",
    "name": "Waxing Gibbous",
    "deckType": "MirielLunar",
    "symbol": "🌔",
    "keywords": ["refinement", "patience", "tending", "perseverance"],
    "keyword_line": "Tend, patiently, what you have begun.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "You are further along than you feel. The work is deep in the middle stretch — not the excitement of beginning, not the satisfaction of completion. This is where most things quietly fail for lack of tending. Stay close to what you started. Adjust without abandoning. The full moon is coming; what you nurture now will meet it.",
    "reversed": "You are pushing too hard or not hard enough. Either you are forcing growth that needs time, or you have drifted from the tending entirely. Return to the original intention. Steady, patient attention — not urgency, not neglect."
  },
  {
    "id": "full-moon",
    "name": "Full Moon",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["culmination", "illumination", "revelation", "fullness"],
    "keyword_line": "All is laid bare in the light.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The culmination has arrived. Whatever you set in motion is now fully visible — its truth, its fruits, and its costs. This is the moment for honest seeing, not for judgment. What the full moon illuminates is what is actually here, not what you hoped or feared. Receive the fullness of what you have built and allow yourself to see it clearly.",
    "reversed": "The fullness of this moment is being resisted. Something is true that you are not yet ready to look at directly. The light is on it regardless. What are you avoiding knowing? The full moon does not wait for permission."
  },
  {
    "id": "waning-gibbous",
    "name": "Waning Gibbous",
    "deckType": "MirielLunar",
    "symbol": "🌖",
    "keywords": ["gratitude", "sharing", "generosity", "release"],
    "keyword_line": "Give back what the harvest gave you.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The peak has passed and the energy begins to move outward. This is the time of generosity — what was given to you through this cycle wants to move through you to something beyond you. Share what you have learned, what you have made, what you have received. Gratitude that does not express itself stagnates; let what filled you flow.",
    "reversed": "You are holding the harvest too tightly. Hoarding what this cycle brought — whether recognition, insight, or resource — keeps the energy from completing its circle. What are you unwilling to share, teach, or release? The waning moon asks you to open your hands."
  },
  {
    "id": "last-quarter",
    "name": "Last Quarter",
    "deckType": "MirielLunar",
    "symbol": "🌗",
    "keywords": ["release", "letting go", "forgiveness", "clearing"],
    "keyword_line": "Set down what you no longer carry.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The time has come to release what the cycle revealed is no longer yours to hold. The last quarter brings the conscious work of letting go — not the passive fading of the waning phase, but the active, deliberate setting down of what does not belong in the next cycle. What habit, belief, relationship, or story needs to be laid down before the dark returns?",
    "reversed": "You know what needs releasing and you are still carrying it. The holding has become a habit, and the habit has a grip. Something in you believes you need it still — examine that belief. The next cycle cannot fully begin while you are weighted with the old one."
  },
  {
    "id": "balsamic-moon",
    "name": "Balsamic Moon",
    "deckType": "MirielLunar",
    "symbol": "🌘",
    "keywords": ["surrender", "rest", "integration", "stillness"],
    "keyword_line": "Return to the still water and wait.",
    "group": "phase",
    "halo": "neutral white-silver",
    "upright": "The lightest sliver of moon before the dark. This is not a time for action; it is a time for surrender. The cycle is completing and the soul requires stillness. Rest here without forcing the next beginning. Something is integrating in the quiet that cannot be rushed. Trust the dark to do its necessary work.",
    "reversed": "You are fighting the need to rest. The momentum of the cycle is over and you are still pushing, still striving, still filling the silence with motion. The balsamic moon cannot be outrun. The dark will come regardless; choosing rest now is wiser than collapsing into it."
  },
  {
    "id": "new-moon-aries",
    "name": "New Moon in Aries",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["initiative", "courage", "spark", "action"],
    "keyword_line": "Strike the first spark and begin.",
    "group": "new-moon-sign",
    "halo": "deep warm amber",
    "upright": "The new moon meets the most initiating energy in the zodiac. This is not a time for caution or planning — it is a time to act. The spark struck now ignites a fire that can carry you through the whole cycle. What have you been preparing to begin? Begin it. Aries does not ask permission. The new moon gives you the dark in which to strike the first match.",
    "reversed": "You are starting without direction, or you are refusing to start at all out of fear of failure. Aries energy reversed either scatters into false starts or locks into inaction. Reconnect to the real intention beneath the urgency, then move."
  },
  {
    "id": "new-moon-taurus",
    "name": "New Moon in Taurus",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["rootedness", "patience", "longevity", "cultivation"],
    "keyword_line": "Plant your roots in fertile ground.",
    "group": "new-moon-sign",
    "halo": "soft pewter-gold",
    "upright": "The new moon in the sign of deep rootedness invites you to plant something that will last. Taurus understands that what endures requires real soil — not ambition alone, but patience, care, and time. What do you want to build that would still be standing in five years? Name it now, in the dark, and begin the slow work of tending it.",
    "reversed": "You are either refusing to commit to what you are planting, or you are planting in ground that is not ready. Taurus reversed can mean stubborn clinging to what should be released rather than genuine rootedness. Make sure what you are cultivating truly belongs in your next chapter."
  },
  {
    "id": "new-moon-gemini",
    "name": "New Moon in Gemini",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["inquiry", "curiosity", "communication", "possibility"],
    "keyword_line": "Two paths open; ask, then listen.",
    "group": "new-moon-sign",
    "halo": "pale silver-blue",
    "upright": "The new moon in Gemini opens a cycle of inquiry. The questions you ask in this dark are seeds as real as any intention. What do you need to understand? Who do you need to speak with? The information that arrives in the weeks ahead will shape your direction — stay curious, stay open, and be willing to change your mind.",
    "reversed": "You are asking questions without listening to the answers, or you are so overwhelmed by possibilities that you cannot settle on a direction. The new moon in Gemini reversed asks you to quiet the chatter and hear what is actually being said."
  },
  {
    "id": "new-moon-cancer",
    "name": "New Moon in Cancer",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["nurturing", "shelter", "emotional truth", "belonging"],
    "keyword_line": "Make a home for the new feeling.",
    "group": "new-moon-sign",
    "halo": "soft silver-blue",
    "upright": "Cancer is the sign of nurturing, shelter, and emotional truth. The new moon here asks what new tenderness needs a container — what feeling, connection, or part of yourself requires care and protection. Whatever you are growing this cycle needs to be held gently. Build the nest before you demand the eggs hatch.",
    "reversed": "Old wounds are cluttering the new beginning. The need for safety is turning into self-protection that shuts out the new. What emotional pattern from the past is you trying to repeat as this cycle begins? You cannot make a home for the new feeling until you have made peace with the old one."
  },
  {
    "id": "new-moon-leo",
    "name": "New Moon in Leo",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["creativity", "visibility", "self-expression", "confidence"],
    "keyword_line": "Let the small flame declare itself.",
    "group": "new-moon-sign",
    "halo": "warm gold",
    "upright": "The new moon in Leo — the sign of the creative self and its fullest expression — asks you to let yourself be seen, even before you are ready. The flame is small right now; that is the point. You do not have to be brilliant or finished or certain. You have to let what is already alive in you show itself. What do you want to create or express this cycle?",
    "reversed": "You are either hiding your light or demanding an audience before you have done the work. Leo reversed here is a signal to find the joy in the making before the showing — or to stop waiting for permission to be visible."
  },
  {
    "id": "new-moon-virgo",
    "name": "New Moon in Virgo",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["discernment", "precision", "service", "attention"],
    "keyword_line": "Begin with one clean, careful thread.",
    "group": "new-moon-sign",
    "halo": "cool silver-sage",
    "upright": "Virgo brings its gift of discernment to the new moon's invitation. You do not need to overhaul everything at once. Find the one thread to pull — the one area, practice, or system that, if tended carefully, would improve everything else. Begin with precision and patience. The work of Virgo is never about perfection; it is about attention.",
    "reversed": "You are over-thinking the beginning until there is no beginning left. Virgo's analytical gift has become a paralysis, or the perfectionism is a wall that keeps you from starting imperfect and real. One imperfect step forward is worth more than the perfect step imagined."
  },
  {
    "id": "new-moon-libra",
    "name": "New Moon in Libra",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["balance", "relationship", "weighing", "harmony"],
    "keyword_line": "Set the scales even, then start.",
    "group": "new-moon-sign",
    "halo": "balanced pale silver",
    "upright": "The new moon in the sign of balance and relationship asks you to consider what needs to be brought into equilibrium before you begin. What relationship, decision, or internal tension is pulling you off-center? Address it now — not to achieve perfect balance, but to begin from a place of honest assessment. What do you need to weigh before you move?",
    "reversed": "You are either stuck in endless weighing without deciding, or you are starting before you have acknowledged what is genuinely out of balance. The scales will never be perfectly even. Start with what you have."
  },
  {
    "id": "new-moon-scorpio",
    "name": "New Moon in Scorpio",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["transformation", "depth", "truth", "regeneration"],
    "keyword_line": "Enter the dark water willingly.",
    "group": "new-moon-sign",
    "halo": "deep muted violet",
    "upright": "The new moon in the deepest sign — the one that asks the hardest questions and demands real transformation. What are you willing to look at directly this cycle? Scorpio's new moon is not for small intentions; it is for the fundamental re-makings, the things you have been circling around for too long. Enter willingly, and the waters will carry you somewhere new.",
    "reversed": "The depth is frightening and you are staying at the surface. Or you are entering the dark water with hidden motives — setting intentions that serve your need for control rather than genuine transformation. What are you really trying to hold onto?"
  },
  {
    "id": "new-moon-sagittarius",
    "name": "New Moon in Sagittarius",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["vision", "expansion", "quest", "belief"],
    "keyword_line": "Take the first step of the long road.",
    "group": "new-moon-sign",
    "halo": "muted amber",
    "upright": "Sagittarius governs the long horizon — the journey, the vision, the expanding of what you know and believe. The new moon here seeds a cycle of movement and discovery. What do you want to understand that you don't yet? Where do you want to go, inwardly or outwardly, that you have been putting off? Take the first step, even when you cannot see the whole road.",
    "reversed": "The vision is too large and paralyzing, or you are starting a journey you have not honestly committed to. Sagittarius reversed here can mean the wandering is an escape, not an exploration. What are you running from, and what do you genuinely want to move toward?"
  },
  {
    "id": "new-moon-capricorn",
    "name": "New Moon in Capricorn",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["ambition", "discipline", "long game", "structure"],
    "keyword_line": "Lay the first stone of the work.",
    "group": "new-moon-sign",
    "halo": "cool slate-silver",
    "upright": "Capricorn brings its remarkable patience and structural discipline to the new moon. This is the time for the intention that is not glamorous but lasting — the work that requires consistency over months or years. What long ambition have you been postponing? Lay one stone today. Not the whole structure — just the first one.",
    "reversed": "You are either planning without building, or you are building in the wrong direction because you have not honestly faced what you want. Are you working toward your real goal, or someone else's idea of achievement?"
  },
  {
    "id": "new-moon-aquarius",
    "name": "New Moon in Aquarius",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["innovation", "original vision", "future", "community"],
    "keyword_line": "Imagine what has not yet been.",
    "group": "new-moon-sign",
    "halo": "muted teal-silver",
    "upright": "Aquarius is the sign of the future, of original vision, of what the world could become. The new moon here seeds ideas that are ahead of their time. Do not trim your vision to fit what already exists. What genuinely new thing wants to come through you — in your work, your community, your life? Imagine it without apology and let the cycle show you the way toward it.",
    "reversed": "The originality has become detachment — the vision is so abstract it has lost its human root. Or you are imposing your idea of what should be on people who did not ask for it. Bring the vision back into contact with what is actually needed."
  },
  {
    "id": "new-moon-pisces",
    "name": "New Moon in Pisces",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["receptivity", "imagination", "dreaming", "dissolution"],
    "keyword_line": "Let the dream choose its own shape.",
    "group": "new-moon-sign",
    "halo": "soft sea-green / muted violet",
    "upright": "The new moon in the most receptive, imaginal sign of the zodiac. Do not force a hard intention here — let the intention be more like a permission: permission for what wants to emerge, for the dream that does not yet have a name. Pisces knows that some of what we most need arrives as feeling before it arrives as form. Stay open. The shape will come.",
    "reversed": "The openness has become formlessness — you are dissolving rather than receiving. Or you are using the dreaming as a way to avoid the concrete step. The new moon in Pisces reversed asks you to hold the dream while also keeping one foot on the ground."
  },
  {
    "id": "full-moon-aries",
    "name": "Full Moon in Aries",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["revelation", "courage tested", "initiative's fruit", "will"],
    "keyword_line": "What you started now stands revealed.",
    "group": "full-moon-sign",
    "halo": "deep warm amber",
    "upright": "The fire you ignited is visible in full now. The full moon in Aries illuminates your courage, your initiative, your will — where it has burned bright and where it has consumed more than was intended. What did you begin and what is it actually becoming? See it clearly, without softening what is difficult or diminishing what is genuinely strong.",
    "reversed": "The fire has gone too far or not far enough. Something begun with boldness has overreached — or the initiative stalled somewhere along the way. What do you see when the full moon lights the whole of what you started?"
  },
  {
    "id": "full-moon-taurus",
    "name": "Full Moon in Taurus",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["abundance", "harvest", "receiving", "satisfaction"],
    "keyword_line": "The harvest is ripe; gather it in.",
    "group": "full-moon-sign",
    "halo": "soft pewter-gold",
    "upright": "The full moon in Taurus asks you to receive. The material world, the body, the senses, the accumulated wealth of time and effort — it is all visible now in its fullness. What has this cycle produced? Do not look past it toward the next thing. Gather what is ready. Taurus knows that abundance ungathered is not truly received.",
    "reversed": "You are looking at the harvest and finding it insufficient, or you are so attached to what you built that you cannot let any of it complete and release. What fear of lack is distorting your vision of what is actually here?"
  },
  {
    "id": "full-moon-gemini",
    "name": "Full Moon in Gemini",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["understanding", "clarity", "communication", "revelation"],
    "keyword_line": "The words you needed arrive.",
    "group": "full-moon-sign",
    "halo": "pale silver-blue",
    "upright": "The full moon in Gemini is the moment of understanding. Something you have been trying to grasp intellectually or communicate clearly crystallizes now. Listen for it in unexpected places — a conversation, a text, an idea that arrives fully formed. The mind is bright tonight. What has been circling without resolution? It may be ready to land.",
    "reversed": "The information has arrived and you are not hearing it, or you are hearing too many things at once and cannot find the thread. Gemini's full moon reversed can mean signal lost in noise. Quiet the chatter and listen for the single true thing."
  },
  {
    "id": "full-moon-cancer",
    "name": "Full Moon in Cancer",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["home", "belonging", "nourishment", "emotional truth"],
    "keyword_line": "The tide turns and carries you home.",
    "group": "full-moon-sign",
    "halo": "soft silver-blue",
    "upright": "The full moon in the sign of home and feeling illuminates what truly nourishes you and what you have been calling home that is not. This is not a harsh revelation — it is a warm one. The tides of this sign move toward shelter, toward belonging, toward the people and places where you are most fully yourself. Where is your real home, and are you moving toward it?",
    "reversed": "The emotional tide has turned against you, or you are holding so tightly to an idea of home that you cannot see it has changed. Cancer reversed at the full moon often means clinging to what was once nourishing but no longer is."
  },
  {
    "id": "full-moon-leo",
    "name": "Full Moon in Leo",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["visibility", "full expression", "pride", "radiance"],
    "keyword_line": "Stand in the full light, unashamed.",
    "group": "full-moon-sign",
    "halo": "warm gold",
    "upright": "The full moon in Leo is the invitation to be fully seen — not to perform, but to genuinely occupy your own visibility. What you have created, who you are, how brightly you burn — this is the moment to let it be undimmed. The instinct to shrink or deflect is especially strong tonight; the invitation is to resist it.",
    "reversed": "The full light is exposing something about how you present yourself — either an ego that has outrun its substance, or a hiding so habitual it has become invisible to you. Which is it? The light is neutral; it simply shows what is there."
  },
  {
    "id": "full-moon-virgo",
    "name": "Full Moon in Virgo",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["discernment", "editing", "clarity", "refinement"],
    "keyword_line": "See what to keep and what to cut.",
    "group": "full-moon-sign",
    "halo": "cool silver-sage",
    "upright": "Virgo's full moon is the master editor. What in your life, work, body, or routine is genuinely serving you and what has become habit, excess, or noise? This is not the time for self-criticism — it is the time for clear-eyed discernment. What would you cut if you were being truly honest? And what, when you look at it in the full light, is actually working beautifully?",
    "reversed": "The discernment has turned into criticism — of yourself or of others. Virgo reversed at the full moon tends toward fault-finding rather than refinement. What would you see if you applied the same rigor to what is right as to what is wrong?"
  },
  {
    "id": "full-moon-libra",
    "name": "Full Moon in Libra",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["balance", "truth in relationship", "justice", "equilibrium"],
    "keyword_line": "Balance is found at the brink.",
    "group": "full-moon-sign",
    "halo": "balanced pale silver",
    "upright": "The full moon in Libra illuminates the tension between what you give and what you receive, between your needs and the needs of those you love, between what is just and what is merely comfortable. The balance Libra seeks is not stillness — it is the alive equilibrium of two real things held in honest relation. What is the actual truth of the balance in this situation?",
    "reversed": "The scales are tipping and you are pretending they are level. Or you have been maintaining a peace that costs too much — keeping the balance by making yourself smaller. The full moon in Libra reversed does not permit the comfortable lie."
  },
  {
    "id": "full-moon-scorpio",
    "name": "Full Moon in Scorpio",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["surfacing", "transformation", "power", "depth"],
    "keyword_line": "What was buried rises to the surface.",
    "group": "full-moon-sign",
    "halo": "deep muted violet",
    "upright": "The deep water shows its contents at the full moon. What has been submerged — emotion, truth, power, desire — is visible now. This is not cause for alarm; it is the gift of Scorpio's full light. The things that surface in the full moon in Scorpio were always there; the moon simply gives you the chance to finally see them clearly and decide what to do with them.",
    "reversed": "What is rising is being pushed back down. Or the revelation is being received through the lens of shadow — through jealousy, obsession, or the need for control rather than genuine transformation. What are you not ready to see?"
  },
  {
    "id": "full-moon-sagittarius",
    "name": "Full Moon in Sagittarius",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["vision", "meaning", "long horizon", "truth"],
    "keyword_line": "The far country comes into view.",
    "group": "full-moon-sign",
    "halo": "muted amber",
    "upright": "The full moon in Sagittarius lights up the horizon. What have you been seeking — the understanding, the journey, the belief that would make the world make sense? The view is clearer tonight. What do you know now that you did not know at the beginning of this cycle? What is the next road opening in front of you?",
    "reversed": "The vision is too far away to be useful, or you have been mistaking movement for direction. Sagittarius reversed at the full moon can mean the search has become its own avoidance — endlessly seeking without arriving. What truth is close at hand that you have been too busy journeying to see?"
  },
  {
    "id": "full-moon-capricorn",
    "name": "Full Moon in Capricorn",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["achievement", "the long climb", "mastery", "recognition"],
    "keyword_line": "The long climb reaches its ridge.",
    "group": "full-moon-sign",
    "halo": "cool slate-silver",
    "upright": "This is the full moon of the long game paying off. What you have been building through sustained effort, patient discipline, and the willingness to do unglamorous work is visible at its ridge line tonight. You do not have to have arrived at the summit — reaching the ridge and seeing the full shape of what you have climbed is its own completion. Let yourself see how far you have come.",
    "reversed": "The effort has been real but the direction has been wrong, or the summit you have climbed is someone else's mountain. Capricorn's full moon reversed sometimes reveals that what you achieved is not actually what you wanted."
  },
  {
    "id": "full-moon-aquarius",
    "name": "Full Moon in Aquarius",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["pattern", "systems", "collective", "insight"],
    "keyword_line": "The hidden pattern shows itself.",
    "group": "full-moon-sign",
    "halo": "muted teal-silver",
    "upright": "Aquarius sees the system from a distance — the structures, the networks, the invisible logic that connects things that appear unrelated. The full moon here illuminates the pattern beneath the surface of your situation. Step back far enough to see it. What has been operating below the level of your direct attention? What does the shape of this reveal?",
    "reversed": "The pattern is visible but you are reading it through ideology rather than seeing it freshly. Aquarius reversed at the full moon can mean seeing what confirms your existing view rather than what is actually there. What would you see if you let the pattern surprise you?"
  },
  {
    "id": "full-moon-pisces",
    "name": "Full Moon in Pisces",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["grace", "dissolution", "mercy", "transcendence"],
    "keyword_line": "The veil thins; mercy flows in.",
    "group": "full-moon-sign",
    "halo": "soft sea-green / muted violet",
    "upright": "The full moon in Pisces is the most tender of the lunations — the one that opens the door between what is seen and what is felt beneath seeing. Let what has hardened soften tonight. Let what you have been holding at arm's length draw close. The veil that separates you from your own depth is thin right now, and what comes through is not danger but grace.",
    "reversed": "The thinning of the veil is overwhelming rather than opening. The boundary between yourself and everything else has dissolved too fully — you are absorbing what is not yours to carry. Pisces reversed at the full moon asks: what do you need to release in order to be present to your own experience?"
  },
  {
    "id": "supermoon",
    "name": "Supermoon",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["amplification", "intensity", "magnification", "presence"],
    "keyword_line": "Whatever is true now, the Moon makes larger.",
    "group": "phenomena",
    "halo": "bright cool-white",
    "upright": "The supermoon amplifies what is already present. If there is love, it will feel vast. If there is grief, it will feel total. If there is clarity, it arrives with unusual force. This is not a time to begin something new — it is a time to pay attention to what is already alive in your life, because it is speaking at maximum volume. What is the moon making unmissable right now?",
    "reversed": "The amplification is distortion. Something is larger than its actual size — a fear, a conflict, a feeling — and you are responding to the amplified version rather than the thing itself. Step back from the intensity and ask what this actually is without the magnification."
  },
  {
    "id": "blue-moon",
    "name": "Blue Moon",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["rarity", "opportunity", "timing", "the unexpected"],
    "keyword_line": "A door that opens once in a long while.",
    "group": "phenomena",
    "halo": "cool blue",
    "upright": "The rare second full moon in a calendar month is not a mistake in the counting — it is an extra dose of moonlight, a gift of fullness that the cycle does not usually offer. The door this opens is not ordinary. What has been waiting, long-delayed, for the right moment? What rare opportunity, rare conversation, rare insight is available right now that will not easily come again? Step through.",
    "reversed": "The rare door is here and you are hesitating. Or you have been telling yourself something is rare and precious as a reason not to commit to the ordinary work of building it. What ordinary step have you been avoiding under the cover of waiting for the perfect moment?"
  },
  {
    "id": "blood-moon",
    "name": "Blood Moon",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["ending", "transformation", "irreversible change", "rebirth"],
    "keyword_line": "The Moon turns red; one thing ends, another wakes.",
    "group": "phenomena",
    "halo": "deep red",
    "upright": "The blood moon is the total lunar eclipse — the most dramatic of the lunar exceptions. Something is ending at root level, not at the surface. The coppery-red moon is not an omen of disaster; it is the sign of fundamental change, the kind that cannot be undone once it begins. What has been completing quietly in your life? The blood moon makes it irreversible. Let it end.",
    "reversed": "You are fighting a change that has already happened at root level. The ending is real but you are refusing to register it as final. The resistance has a cost. What do you need to let be over?"
  },
  {
    "id": "ring-of-fire",
    "name": "The Ring of Fire",
    "deckType": "MirielLunar",
    "symbol": "🌑",
    "keywords": ["eclipse", "disorientation", "revelation", "reorientation"],
    "keyword_line": "Day goes dark a moment, and the world is changed.",
    "group": "phenomena",
    "halo": "brilliant fire corona",
    "upright": "The solar eclipse — the sun briefly disappeared behind the moon — is the rarest and most disorienting of the celestial events in this deck. The light source goes dark. What you took for granted as permanent and stable reveals itself as contingent. Something about the way you have been orienting your life was based on assumptions that this moment exposes as assumptions. What changes now that you can see that clearly?",
    "reversed": "The disorientation of the eclipse is becoming paralysis. The moment the normal light went out, you lost your footing, and you have not yet found a new one. The ground is still there. Orient yourself to what you actually know to be true, and begin from there."
  },
  {
    "id": "earthshine",
    "name": "The Old Moon in the New Moon's Arms",
    "deckType": "MirielLunar",
    "symbol": "🌒",
    "keywords": ["continuity", "past light", "gentle memory", "inheritance"],
    "keyword_line": "The old light still lingers within the new.",
    "group": "phenomena",
    "halo": "faint neutral glow",
    "upright": "Earthshine — the faint glow that illuminates the dark portion of the crescent moon, reflected light from the Earth itself — is one of the most gentle and overlooked of the lunar phenomena. The old cycle is still faintly visible within the new. What wisdom, what learning, what love from what came before is still faintly illuminating what you are building now? Honor the continuity. The new does not erase the old; it carries it.",
    "reversed": "You are carrying the old light as burden rather than gift. What was true before has become a lens that distorts the new rather than illuminating it. Is the past enhancing your vision or obscuring it?"
  },
  {
    "id": "moon-halo",
    "name": "The Ring",
    "deckType": "MirielLunar",
    "symbol": "🌕",
    "keywords": ["change approaching", "atmosphere", "weather turning", "signal"],
    "keyword_line": "A ring round the Moon: change is on the wind.",
    "group": "phenomena",
    "halo": "neutral cool halo with wide ring",
    "upright": "The moon halo — the ring of light that appears around the moon when ice crystals in the upper atmosphere refract its light — is a traditional omen of weather change. Not of disaster, but of shift. Something in your situation is about to change; the atmospheric conditions for it are already in place. Pay attention to what is moving at the edges of your life. The ring is the sign, not the thing itself.",
    "reversed": "The signs of change are being misread. You are seeing the halo as a warning of catastrophe rather than a signal of ordinary (if significant) shift. Or you are seeing change everywhere when the atmosphere is actually quite still. What is the change that is actually approaching?"
  },
  {
    "id": "the-still-water",
    "name": "The Still Water",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["pause", "reflection", "clarity through stillness", "inner listening"],
    "keyword_line": "Before you act, let the water grow still.",
    "group": "passage",
    "halo": "soft blue",
    "upright": "This is Miriel's counsel of pause. Not all stillness is stagnation; the still water is the medium that shows you your own reflection. The question you are asking cannot be answered through more thinking, more striving, more motion. Let everything settle. What wants to emerge from the quiet that cannot be heard over the noise you are making?",
    "reversed": "You have been still too long and it has become avoidance. The water has grown stagnant rather than reflective. The pause that was meant to bring clarity has become a place you are hiding in. What action have you been refusing to take under the cover of waiting for the right moment?"
  },
  {
    "id": "the-turning-tide",
    "name": "The Turning Tide",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["reversal", "return", "shift", "renewal"],
    "keyword_line": "What was pulling away now flows toward you.",
    "group": "passage",
    "halo": "muted teal",
    "upright": "Something has shifted. The tide that was going out — the energy, the luck, the possibility that felt like it was leaving — has reached its low mark and begun to return. You may not feel it yet as arrival, but the direction has changed. Do not make permanent decisions based on the low water. What was moving away from you is now moving back, and the return requires only that you are present to receive it.",
    "reversed": "You believe the tide has turned when it is still going out. The wishful reading of a momentary lull as a reversal is sending you out to meet what is not yet arriving. Or the tide genuinely has turned but you are still behaving as though you are losing. Which is it?"
  },
  {
    "id": "the-threshold",
    "name": "The Threshold",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["crossing", "commitment", "the unknown", "readiness"],
    "keyword_line": "You stand at the doorway; the next step is yours.",
    "group": "passage",
    "halo": "clean cool white",
    "upright": "You are at a genuine threshold — not a fork in the road, but a doorway that opens only one way. What lies ahead is unknown and that is entirely appropriate; the nature of a threshold is that you cannot know what is on the other side until you have crossed. You have done the preparation that was yours to do. The next step is not a step away from anything — it is a step into.",
    "reversed": "You are standing at the threshold and looking back. The pull of what you are leaving is stronger than the call of what you are entering. This is understandable — thresholds are real crossings. But you cannot stand here indefinitely. What is the true cost of not stepping through?"
  },
  {
    "id": "the-long-dark",
    "name": "The Long Dark",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["endurance", "sustained difficulty", "faith in the unseen", "night season"],
    "keyword_line": "The night is long, but you are not lost in it.",
    "group": "passage",
    "halo": "deep muted violet",
    "upright": "This is the card for the season of difficulty — not the dramatic crisis but the sustained, wearing dark, the kind that asks you to keep going without the reward of visible progress or the consolation of an end in sight. You are not lost. The night being long is not the same as the night being permanent. What does it mean to be present to exactly where you are, without adding the suffering of an imagined endless future?",
    "reversed": "The long dark has become something you are maintaining rather than moving through. The suffering has become familiar enough to feel like safety. What would it mean to allow the beginning of the light, even if you are not certain it is real?"
  },
  {
    "id": "the-keepers-stone",
    "name": "The Keeper's Stone",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["legacy", "foundation", "inheritance", "what endures"],
    "keyword_line": "What was carved before you still holds.",
    "group": "passage",
    "halo": "warm amber",
    "upright": "There is a wisdom in what came before — in the traditions, the knowledge, the relationships, the foundations that were laid long ago. This card asks you to look at what has been given to you that you may be taking for granted. What holds you that you did not build yourself? What has endured because someone else did the work of carving it into stone? Honor that. It is still holding.",
    "reversed": "The old stone has become a weight rather than a foundation. You are maintaining something that was built for a different time, a different need, a different person — and the maintenance is costing you. What has been handed down that you are keeping out of obligation rather than genuine need?"
  },
  {
    "id": "the-wild-path",
    "name": "The Wild Path",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["instinct", "uncharted", "trust", "divergence"],
    "keyword_line": "Leave the marked road; trust what the wild knows.",
    "group": "passage",
    "halo": "soft green",
    "upright": "The marked road has taken you as far as it can. The next part of this journey does not have a trail. Miriel's wild path asks you to trust the knowing that lives below the level of logic — the sense of direction that does not come from a map, the instinct that the path exists even where you cannot see it. What would you do if you trusted what you knew without needing it confirmed?",
    "reversed": "The wild path has become recklessness — the abandonment of the marked road as rebellion rather than genuine calling. Or you are on the marked road and pretending it is wild because that feels more alive. Where are you actually being led, and is that where you genuinely want to go?"
  },
  {
    "id": "the-uncarved-stone",
    "name": "The Uncarved Stone",
    "deckType": "MirielLunar",
    "symbol": "✦",
    "keywords": ["potential", "unformed", "freedom", "choice before form"],
    "keyword_line": "Nothing is set; the shape is still yours to choose.",
    "group": "passage",
    "halo": "soft blue (dissolution)",
    "upright": "This is the deck's one dissolution card — the moon not yet fully formed, one side solid and real, the other dissolving into luminous possibility. The situation you are asking about has not yet set into its final shape. This is not uncertainty; this is freedom. You are being given the rarest of gifts: the chance to choose before the form is fixed. What do you want this to become?",
    "reversed": "The formlessness is frightening rather than freeing. You are looking at uncarved stone and seeing failure instead of possibility. Or the dissolution is happening to something that should be solid by now — the form that was meant to set has not, and you are avoiding the decision that would make it real. What are you afraid to commit to, and what becomes possible when you do?"
  }
]
```

- [ ] **Step 2: Verify card count**

```powershell
$cards = Get-Content "C:\Users\Matt\projects\tarot\data\miriel-lunar.json" | ConvertFrom-Json
Write-Output "Total: $($cards.Count)"
$cards | Group-Object group | Select-Object Name, Count
```

Expected output:
```
Total: 45
Name              Count
----              -----
phase             8
new-moon-sign     12
full-moon-sign    12
phenomena         6
passage           7
```

- [ ] **Step 3: Commit**

```powershell
git -C "C:\Users\Matt\projects\tarot" add data/miriel-lunar.json
git -C "C:\Users\Matt\projects\tarot" commit -m "feat: add Miriel's Lunar Oracle card data (45 cards)"
```

---

### Task 2: Create image folder with placeholder images

**Files:**
- Create: `public/images/miriel-lunar/` (directory + 46 files: 45 card images + 1 card back)

**Interfaces:**
- Produces: `imageManifest['miriel-lunar'][cardId]` resolves to a URL for every card ID
- Image filenames must exactly match card IDs from miriel-lunar.json

- [ ] **Step 1: Create folder and copy placeholder images**

```powershell
$dest = "C:\Users\Matt\projects\tarot\public\images\miriel-lunar"
New-Item -ItemType Directory -Force $dest | Out-Null

# Card IDs from miriel-lunar.json
$cardIds = @(
  "new-moon","waxing-crescent","first-quarter","waxing-gibbous","full-moon",
  "waning-gibbous","last-quarter","balsamic-moon",
  "new-moon-aries","new-moon-taurus","new-moon-gemini","new-moon-cancer",
  "new-moon-leo","new-moon-virgo","new-moon-libra","new-moon-scorpio",
  "new-moon-sagittarius","new-moon-capricorn","new-moon-aquarius","new-moon-pisces",
  "full-moon-aries","full-moon-taurus","full-moon-gemini","full-moon-cancer",
  "full-moon-leo","full-moon-virgo","full-moon-libra","full-moon-scorpio",
  "full-moon-sagittarius","full-moon-capricorn","full-moon-aquarius","full-moon-pisces",
  "supermoon","blue-moon","blood-moon","ring-of-fire","earthshine","moon-halo",
  "the-still-water","the-turning-tide","the-threshold","the-long-dark",
  "the-keepers-stone","the-wild-path","the-uncarved-stone"
)

# Use full moon image as a generic placeholder for all cards
$placeholder = "C:\Users\Matt\projects\tarot\public\images\moonology\full moon.jpg"
foreach ($id in $cardIds) {
  Copy-Item $placeholder "$dest\$id.jpg"
}

# Card back placeholder
$backPlaceholder = "C:\Users\Matt\projects\tarot\public\images\moonology\card back 4.jpg"
Copy-Item $backPlaceholder "$dest\card-back.jpg"

Write-Output "Created $((Get-ChildItem $dest).Count) files in miriel-lunar/"
```

Expected: `Created 46 files in miriel-lunar/`

- [ ] **Step 2: Commit**

```powershell
git -C "C:\Users\Matt\projects\tarot" add public/images/miriel-lunar/
git -C "C:\Users\Matt\projects\tarot" commit -m "feat: add miriel-lunar placeholder images (45 cards + back)"
```

---

### Task 3: Register deck in server.js

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\server.js` (lines ~401, ~474–482, ~504–512)

**Interfaces:**
- Consumes: `data/miriel-lunar.json` on disk
- Produces: `/api/cards` response includes `miriel-lunar` key; `/api/images` manifest includes `miriel-lunar` key

- [ ] **Step 1: Add to deckFiles array (line ~401)**

Find:
```javascript
const deckFiles = ['tarot', 'thoth', 'celtic-dragon', 'moonology', 'lenormand', 'runic', 'iching', 'oracle'];
```
Replace with:
```javascript
const deckFiles = ['tarot', 'thoth', 'celtic-dragon', 'moonology', 'miriel-lunar', 'lenormand', 'runic', 'iching', 'oracle'];
```

- [ ] **Step 2: Add to deckDirs image manifest map (line ~474–482)**

Find:
```javascript
    'moonology':     'moonology',
    'oracle':        'moonology',
```
Replace with:
```javascript
    'moonology':     'moonology',
    'miriel-lunar':  'miriel-lunar',
    'oracle':        'moonology',
```

- [ ] **Step 3: Load JSON in /api/cards handler (line ~506)**

Find:
```javascript
  const moonology    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'moonology.json'), 'utf8'));
```
Replace with:
```javascript
  const moonology    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'moonology.json'), 'utf8'));
  const mirielLunar  = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'miriel-lunar.json'), 'utf8'));
```

- [ ] **Step 4: Include in /api/cards response (line ~512)**

Find:
```javascript
  res.json({ tarot, oracle, moonology, 'celtic-dragon': celticDragon, lenormand, thoth, runic, iching });
```
Replace with:
```javascript
  res.json({ tarot, oracle, moonology, 'miriel-lunar': mirielLunar, 'celtic-dragon': celticDragon, lenormand, thoth, runic, iching });
```

- [ ] **Step 5: Verify server responds correctly**

```powershell
# Start server in background, test endpoints, kill it
$job = Start-Job { node "C:\Users\Matt\projects\tarot\server.js" }
Start-Sleep 3
$cards = Invoke-RestMethod http://localhost:3000/api/cards
Write-Output "miriel-lunar card count: $($cards.'miriel-lunar'.Count)"
$images = Invoke-RestMethod http://localhost:3000/api/images
Write-Output "miriel-lunar image keys: $($images.'miriel-lunar'.PSObject.Properties.Name.Count)"
Stop-Job $job; Remove-Job $job
```

Expected:
```
miriel-lunar card count: 45
miriel-lunar image keys: 46
```

- [ ] **Step 6: Commit**

```powershell
git -C "C:\Users\Matt\projects\tarot" add server.js
git -C "C:\Users\Matt\projects\tarot" commit -m "feat: register miriel-lunar deck in server endpoints"
```

---

### Task 4: Register deck in app.js frontend

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\public\app.js`

**Touch points (search for these exact strings):**
1. `allCards` init object (line ~1)
2. `MIRIEL_DECKS` array (line ~1955)
3. `GRIMOIRE_DECKS` array (line ~1231)
4. deck-select options (line ~1235)
5. `buildCardFace` deckType map (line ~2792)
6. `cardBackUrl` function (line ~2776)
7. Spread card pool builders (lines ~2328, ~2412, ~2420)

- [ ] **Step 1: Add to allCards initializer**

Find:
```javascript
let allCards = { tarot: [], oracle: [], moonology: [], 'celtic-dragon': [], lenormand: [], thoth: [], runic: [], iching: [] };
```
Replace with:
```javascript
let allCards = { tarot: [], oracle: [], moonology: [], 'miriel-lunar': [], 'celtic-dragon': [], lenormand: [], thoth: [], runic: [], iching: [] };
```

- [ ] **Step 2: Add to MIRIEL_DECKS**

Find:
```javascript
const MIRIEL_DECKS = ['tarot', 'thoth', 'celtic-dragon', 'moonology', 'lenormand', 'runic', 'iching', 'oracle', 'mixed'];
```
Replace with:
```javascript
const MIRIEL_DECKS = ['tarot', 'thoth', 'celtic-dragon', 'moonology', 'miriel-lunar', 'lenormand', 'runic', 'iching', 'oracle', 'mixed'];
```

- [ ] **Step 3: Add to GRIMOIRE_DECKS**

Find:
```javascript
  ['moonology',     'Moonology'],
```
Replace with:
```javascript
  ['moonology',     'Moonology'],
  ['miriel-lunar',  "Miriel's Lunar Oracle"],
```

- [ ] **Step 4: Add to deck selector**

Find:
```javascript
  ['moonology',     'Moonology'],
```
(in the deck-select options array — the one that populates the `<select>` dropdown, near line ~1235)
Replace with:
```javascript
  ['moonology',     'Moonology'],
  ['miriel-lunar',  "Miriel's Lunar Oracle"],
```

- [ ] **Step 5: Add to buildCardFace deckType map**

Find:
```javascript
  const deckKey = card.deckType === 'Moonology'  ? 'moonology' :
```
Replace with:
```javascript
  const deckKey = card.deckType === 'MirielLunar' ? 'miriel-lunar' :
                  card.deckType === 'Moonology'  ? 'moonology' :
```

- [ ] **Step 6: Add card back URL**

Find:
```javascript
  if (card && card.deckType === 'Moonology') {
    return '/images/moonology/card%20back%204.jpg';
  }
```
Replace with:
```javascript
  if (card && card.deckType === 'MirielLunar') {
    return '/images/miriel-lunar/card-back.jpg';
  }
  if (card && card.deckType === 'Moonology') {
    return '/images/moonology/card%20back%204.jpg';
  }
```

- [ ] **Step 7: Add to spread card pools**

Find (line ~2328):
```javascript
    { label: 'Moonology Oracle',    cards: allCards.moonology },
```
Replace with:
```javascript
    { label: 'Moonology Oracle',    cards: allCards.moonology },
    { label: "Miriel's Lunar Oracle", cards: allCards['miriel-lunar'] },
```

Find (line ~2412 — mixed deck pool):
```javascript
    ...allCards.moonology, ...allCards.lenormand,
```
Replace with:
```javascript
    ...allCards.moonology, ...allCards['miriel-lunar'], ...allCards.lenormand,
```

Find (line ~2420 — second mixed pool occurrence):
```javascript
    ...allCards.moonology, ...allCards.lenormand,
```
Replace with:
```javascript
    ...allCards.moonology, ...allCards['miriel-lunar'], ...allCards.lenormand,
```

- [ ] **Step 8: Wire up card data from /api/cards response**

Search for where allCards is populated from the API response. Find the pattern that does `allCards.moonology = data.moonology` (or similar) and add the miriel-lunar assignment alongside it.

```javascript
// Look for this pattern and add the miriel-lunar line:
allCards.moonology      = data.moonology      || [];
// ADD:
allCards['miriel-lunar'] = data['miriel-lunar'] || [];
```

- [ ] **Step 9: Commit**

```powershell
git -C "C:\Users\Matt\projects\tarot" add public/app.js
git -C "C:\Users\Matt\projects\tarot" commit -m "feat: register miriel-lunar deck in frontend"
```

---

### Task 5: Add live text overlay + fix reversed behavior

This task implements the compliance kit requirement: title + keyword line as live app text in the lower 22% of each card, with only the image rotating on reversed draws.

**Files:**
- Modify: `C:\Users\Matt\projects\tarot\public\style.css`
- Modify: `C:\Users\Matt\projects\tarot\public\app.js` (`buildCardFace` function)

**Interfaces:**
- Consumes: `card.name`, `card.keyword_line`, `card.isReversed`, `card.deckType === 'MirielLunar'`
- Produces: `.miriel-lunar-card` container with `.miriel-lunar-img` (rotates on reversed) + `.miriel-lunar-overlay` (stays upright always)

- [ ] **Step 1: Add CSS for the overlay**

Append to `public/style.css`:

```css
/* ── Miriel's Lunar Oracle — live text overlay ─────────────────────────────
   Art is clean (no baked text). App composites title + keyword into the
   lower 22% title-safe zone. On reversed draws only the img rotates;
   the overlay stays upright so the title is always readable.            */

.miriel-lunar-card {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.miriel-lunar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.miriel-lunar-img.miriel-reversed {
  transform: rotate(180deg);
}

.miriel-lunar-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 22%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 6px;
  background: linear-gradient(to top, rgba(0,0,0,0.75) 60%, transparent);
  pointer-events: none;
}

.miriel-lunar-title {
  font-family: 'Cinzel', 'Palatino Linotype', serif;
  font-size: 0.65em;
  font-variant: small-caps;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.92);
  text-align: center;
  line-height: 1.1;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.miriel-lunar-keyword {
  font-family: 'Cormorant Garamond', 'Palatino Linotype', serif;
  font-size: 0.55em;
  font-style: italic;
  color: rgba(220, 220, 235, 0.82);
  text-align: center;
  line-height: 1.2;
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.miriel-lunar-badge {
  font-family: 'Cinzel', serif;
  font-size: 0.5em;
  font-variant: small-caps;
  letter-spacing: 0.1em;
  color: rgba(180, 160, 220, 0.9);
  text-align: center;
  margin-top: 1px;
}
```

- [ ] **Step 2: Modify buildCardFace to handle MirielLunar differently**

Find the `buildCardFace` function. The current structure is:

```javascript
function buildCardFace(face, card, arcanaLabel) {
  const deckKey = card.deckType === 'Moonology'  ? 'moonology' :
                  ...
  const imgSrc  = deckKey && imageManifest[deckKey] && imageManifest[deckKey][card.id];

  if (imgSrc) {
    face.classList.add('has-image');
    ...
    const img = document.createElement('img');
    ...
    face.appendChild(img);
    if (card.isReversed) {
      const badge = ...
      face.appendChild(badge);
    }
  } else {
    face.innerHTML = cardTextHTML(card, arcanaLabel);
  }
}
```

After the `deckKey` assignment and `imgSrc` lookup, add an early-return branch for MirielLunar cards that builds the overlay structure:

Find the block (after `const imgSrc = ...`):
```javascript
  if (imgSrc) {
    face.classList.add('has-image');
    if (card.deckType === 'Runic') face.classList.add('rune-stone');
    if (card.deckType === 'IChing') face.classList.add('iching-hex');
    const img = document.createElement('img');
    img.className = 'card-image';
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      face.classList.remove('has-image');
      face.innerHTML = cardTextHTML(card, arcanaLabel);
    };
    face.appendChild(img);
    if (card.isReversed) {
      const badge = document.createElement('div');
      badge.className = 'card-reversed-badge card-img-badge';
      badge.textContent = 'Reversed';
      face.appendChild(badge);
    }
  } else {
```

Replace with:
```javascript
  if (imgSrc && card.deckType === 'MirielLunar') {
    face.classList.add('has-image');
    const wrapper = document.createElement('div');
    wrapper.className = 'miriel-lunar-card';

    const img = document.createElement('img');
    img.className = 'miriel-lunar-img' + (card.isReversed ? ' miriel-reversed' : '');
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      face.classList.remove('has-image');
      face.innerHTML = cardTextHTML(card, arcanaLabel);
    };
    wrapper.appendChild(img);

    const overlay = document.createElement('div');
    overlay.className = 'miriel-lunar-overlay';

    const title = document.createElement('div');
    title.className = 'miriel-lunar-title';
    title.textContent = card.name;
    overlay.appendChild(title);

    if (card.keyword_line) {
      const kw = document.createElement('div');
      kw.className = 'miriel-lunar-keyword';
      kw.textContent = card.keyword_line;
      overlay.appendChild(kw);
    }

    if (card.isReversed) {
      const badge = document.createElement('div');
      badge.className = 'miriel-lunar-badge';
      badge.textContent = 'Reversed';
      overlay.appendChild(badge);
    }

    wrapper.appendChild(overlay);
    face.appendChild(wrapper);
    return;
  }

  if (imgSrc) {
    face.classList.add('has-image');
    if (card.deckType === 'Runic') face.classList.add('rune-stone');
    if (card.deckType === 'IChing') face.classList.add('iching-hex');
    const img = document.createElement('img');
    img.className = 'card-image';
    img.alt = card.name;
    img.src = imgSrc;
    img.onerror = () => {
      face.classList.remove('has-image');
      face.innerHTML = cardTextHTML(card, arcanaLabel);
    };
    face.appendChild(img);
    if (card.isReversed) {
      const badge = document.createElement('div');
      badge.className = 'card-reversed-badge card-img-badge';
      badge.textContent = 'Reversed';
      face.appendChild(badge);
    }
  } else {
```

- [ ] **Step 3: Commit**

```powershell
git -C "C:\Users\Matt\projects\tarot" add public/style.css public/app.js
git -C "C:\Users\Matt\projects\tarot" commit -m "feat: add miriel-lunar live text overlay and reversed-image-only behavior"
```

- [ ] **Step 4: Smoke test**

Start the app and verify manually:

1. `node server.js` (or `tarot.bat`)
2. Open deck selector — confirm "Miriel's Lunar Oracle" appears
3. Select the deck and draw a single card
4. Verify: image shows, card name appears in lower band, keyword line appears below it
5. Draw a reversed card: image should be upside down, title should be upright, "Reversed" badge visible
6. Open Grimoire — confirm "Miriel's Lunar Oracle" appears as an option

---

## Self-Review

**Spec coverage check:**
- [x] 45 cards (8+12+12+6+7) — Task 1
- [x] deckType `MirielLunar`, key `miriel-lunar` — throughout
- [x] Display name "Miriel's Lunar Oracle" — Tasks 4 + 5
- [x] Placeholder images named by card ID — Task 2
- [x] Server endpoints serve the deck — Task 3
- [x] Frontend deck selector, Grimoire, spread pools — Task 4
- [x] Live text overlay (title + keyword_line) in title-safe zone — Task 5
- [x] Reversed: only image rotates, title stays upright — Task 5
- [x] Moonology deck preserved intact — no touch points on existing moonology code

**Type consistency:** `card.deckType === 'MirielLunar'` used consistently in Tasks 4 and 5. `allCards['miriel-lunar']` used consistently (bracket notation required for hyphenated key).

**Placeholder scan:** No TBDs. All code blocks are complete. Task 4 Step 8 is the only "find the pattern" step — the pattern is well-described.
