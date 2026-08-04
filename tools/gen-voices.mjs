// Generate voiced dialogue for Aurelia with the ElevenLabs text-to-speech API.
//
// Runs on your machine or in CI, never in the browser — the API key stays out
// of the repo and only the resulting .mp3 files are committed. The game reads
// them through assets/voice/manifest.json (see js/core/Voice.js) and plays
// fine without them, so this is always optional.
//
// Usage:
//   export ELEVENLABS_API_KEY=sk_...        (or put it in .env.local)
//   node tools/gen-voices.mjs --dry-run     # plan + cost, spends nothing
//   node tools/gen-voices.mjs --voices      # list voices on your account
//   node tools/gen-voices.mjs               # generate what's missing/changed
//   node tools/gen-voices.mjs --only bram   # one character
//   node tools/gen-voices.mjs --model v2    # force the safe model
//
// Lines are re-recorded when their text changes, and also when their voice,
// model or delivery settings change — so recasting a character regenerates
// only that character.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { getDialogue } from '../js/data/dialogue.js';
import { lineHash, normalizeLine } from '../js/util/hash.js';
import { ROOT, apiKey, listVoices, subscription, textToSpeech, modelWorks } from './lib/eleven.mjs';

const OUT_DIR = join(ROOT, 'assets', 'voice');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// eleven_v3 understands inline delivery tags like [laughs] and gives markedly
// more emotional range; multilingual_v2 is the dependable fallback and would
// read the tags aloud, so tags are stripped when it is in use.
const MODEL_V3 = 'eleven_v3';
const MODEL_V2 = 'eleven_multilingual_v2';

// ---------------------------------------------------------------------------
// Casting. `preferred` is matched case-insensitively against the voices on
// your account (first hit wins), and these are the names in ElevenLabs' current
// default library. `tag` is the character's baseline delivery on v3; `lineTags`
// override it for specific moments. Add `voiceId` to pin a voice exactly.
//
// Low stability = more variation and emotion; high style = more theatrical.
// ---------------------------------------------------------------------------
// eleven_v3 stability is a three-point scale, not a slider: 0.0 Creative
// (most responsive to direction, most variation), 0.5 Natural, 1.0 Robust.
// The theatrical characters run Creative; the dry ones sit at Natural where
// wandering delivery would read as a mistake rather than a choice.
const CAST = {
  maren: {
    note: 'Ancient village elder. Foul-mouthed, warm, zero patience.',
    preferred: ['Matilda', 'Alice', 'Charlotte', 'Aria', 'Sarah'],
    settings: { stability: 0.0, similarity_boost: 0.75 },
  },
  nyla: {
    note: 'Healer. Brisk, dry, mothers you while insulting you.',
    preferred: ['Alice', 'Sarah', 'Jessica', 'Lily', 'Aria'],
    settings: { stability: 0.5, similarity_boost: 0.75 },
  },
  bram: {
    note: 'Guard captain. Loud, gravelly, aggressively enthusiastic.',
    preferred: ['Callum', 'Bill', 'Brian', 'Daniel', 'Roger'],
    settings: { stability: 0.0, similarity_boost: 0.8 },
  },
  tam: {
    note: 'Shopkeep. Smooth, jovial, shameless salesman.',
    preferred: ['George', 'Brian', 'Will', 'Eric', 'Roger'],
    settings: { stability: 0.5, similarity_boost: 0.75 },
  },
  pip: {
    note: 'Excitable kid. Fast, breathless, delighted with himself.',
    preferred: ['Jessica', 'Lily', 'River', 'Laura', 'Aria'],
    settings: { stability: 0.0, similarity_boost: 0.7 },
  },
  rho: {
    note: 'Farmer. Slow, weathered, quietly amused.',
    preferred: ['Bill', 'Brian', 'Chris', 'Eric', 'Daniel'],
    settings: { stability: 0.5, similarity_boost: 0.75 },
  },
};

// ---------------------------------------------------------------------------
// Direction, one entry per line.
//
// An earlier pass tagged each line with a description of the character's voice
// ("[gravelly, cackling]"), which is not direction at all: 31 of 51 lines got
// the same generic label, so Maren's tender "I am too old to sew anyone back
// together" was performed as cackling. Delivery has to come from what the line
// says, so every line is directed individually here.
//
//   m   — matches the line (first hit wins)
//   tag — how it opens
//   ins — [pattern, tag] pairs inserted mid-line, because most of this dialogue
//         is setup-then-punchline and the turn has to be audible
// ---------------------------------------------------------------------------
const DIRECTION = {
  maren: [
    { m: /^Oh good, another wandering/, tag: '[weary, sarcastic]',
      ins: [[/which means I am old/, '[grumbling]']] },
    { m: /^Seventy years ago a star/, tag: '[recounting something vast]',
      ins: [[/Prettiest damn/, '[fondly]']] },
    { m: /^Where it landed/, tag: '[ominous]',
      ins: [[/And ever since/, '[exasperated]']] },
    { m: /^The Hollow Shrine is older/, tag: '[reverent]',
      ins: [[/older than my knees/, '[dry aside]'], [/Legend says/, '[reverent again]']] },
    { m: /^When the star fell/, tag: '[grim]',
      ins: [[/Probably horny/, '[flatly]']] },
    { m: /^You carry a sword/, tag: '[appraising, grudgingly impressed]' },
    { m: /^Haul your shapely ass/, tag: '[brisk, commanding]' },
    { m: /^Do this, and Brindlemere/, tag: '[warm]',
      ins: [[/Which, fair warning/, '[wry]']] },
    { m: /^Hot damn, an actual volunteer/, tag: '[delighted, caught off guard]',
      ins: [[/If you end up in the lake/, '[dry]']] },
    { m: /^Rest here whenever you must/, tag: '[kindly]',
      ins: [[/Now piss off/, '[gruffly affectionate]']] },
    { m: /^Smart\. Dead heroes/, tag: '[approving, matter-of-fact]' },
    { m: /^The shrine is STILL north/, tag: '[exasperated but patient]',
      ins: [[/Neither am I/, '[amused]']] },
    // The line that was previously cackling. It is the softest thing she says.
    { m: /^Go stab the scary thing/, tag: '[quietly tender]' },
    { m: /^Well butter my ass/, tag: '[astonished]',
      ins: [[/You actually did it/, '[laughing with joy]']] },
    { m: /^The valley breathes easier/, tag: '[moved, sincere]',
      ins: [[/mostly because no army/, '[wry]']] },
    { m: /^Take this blessing/, tag: '[solemn]',
      ins: [[/and believe me/, '[wry]']] },
    { m: /^Every lantern in Brindlemere/, tag: '[warm, motherly]',
      ins: [[/Heroes are still idiots/, '[fond scolding]']] },
  ],
  nyla: [
    { m: /^Watch the doorway/, tag: '[brisk, distracted]',
      ins: [[/I will heal you and THEN/, '[cheerfully threatening]'], [/Scrapes, fevers/, '[businesslike]']] },
    { m: /^My potion stores/, tag: '[dryly complaining]',
      ins: [[/the last thing that skittered/, '[wary]']] },
    { m: /^Oh, bless your reckless/, tag: '[fondly condescending]',
      ins: [[/Those people now speak/, '[deadpan]']] },
    { m: /^Bring the shrooms back/, tag: '[brisk, businesslike]' },
    { m: /^Sleep with your boots on/, tag: '[rattling off practiced advice]',
      ins: [[/That last one is not a joke/, '[suddenly serious]'], [/Two were grateful/, '[darkly amused]']] },
    { m: /^Perfect caps/, tag: '[pleased, absorbed in the work]',
      ins: [[/Do not chug them both/, '[scolding]']] },
    { m: /^Drink them when the hearts/, tag: '[instructive]',
      ins: [[/because heroes, as a rule/, '[affectionately insulting]']] },
    { m: /^My shelves glow again/, tag: '[genuinely grateful]',
      ins: [[/If a boglin chews/, '[teasing]']] },
    { m: /^Is that glow coming/, tag: '[teasing, delighted]' },
  ],
  bram: [
    { m: /^Hold there/, tag: '[barking an order]',
      ins: [[/You hold that thing/, '[appraising, impressed]'], [/captain of a guard that consists/, '[self-deprecating]']] },
    { m: /^Boglin camps are creeping/, tag: '[serious briefing]',
      ins: [[/MOONED me/, '[outraged, wounded dignity]']] },
    { m: /^HA! Music to my ears/, tag: '[barking a delighted laugh]' },
    { m: /^Watch the big horned ones/, tag: '[urgent warning]',
      ins: [[/ROLL, damn you/, '[shouting]']] },
    { m: /^Three lessons, free/, tag: '[bored, then warming up]',
      ins: [[/hits like a divorce/, '[amused at his own joke]']] },
    { m: /^Two: hold your swing/, tag: '[instructive]',
      ins: [[/Clears a crowd/, '[gleeful]']] },
    { m: /^Three: lock on/, tag: '[instructive]',
      ins: [[/gets a club suppository/, '[relishing it]']] },
    { m: /^Outstanding work, soldier/, tag: '[proud]',
      ins: [[/Long story/, '[sheepish]']] },
    { m: /^Deeper breaths/, tag: '[gruff, hiding that he is moved]' },
    { m: /^The watchfires burn quiet/, tag: '[sincere]',
      ins: [[/It is me\. I am the company/, '[proudly deadpan]']] },
    { m: /^Word travels/, tag: '[delighted, hugely impressed]' },
  ],
  tam: [
    { m: /^Welcome, welcome/, tag: '[booming showman]',
      ins: [[/on account of being the only one/, '[sly]']] },
    { m: /^What will it be/, tag: '[cheerful]',
      ins: [[/I have a monopoly/, '[shamelessly proud]']] },
    { m: /^Pleasure doing business/, tag: '[delighted]',
      ins: [[/if it tastes like feet/, '[breezily dismissive]']] },
    { m: /^Broke, eh/, tag: '[mock sympathy]',
      ins: [[/well, some shame/, '[sly]'], [/Gems: green ones/, '[brisk sales patter]']] },
    { m: /^Crack open a boglin camp/, tag: '[enthusiastic]',
      ins: [[/You did not hear that from me/, '[conspiratorial]'], [/aspirational/, '[evasive]']] },
  ],
  pip: [
    { m: /^Psst! Traveller/, tag: '[whispering conspiratorially]',
      ins: [[/I know ALL the secrets/, '[bursting with pride]']] },
    { m: /^The old standing stones/, tag: '[excited]',
      ins: [[/Rho is FULL OF CRAP/, '[indignant]'], [/That is swearing/, '[guilty thrill]']] },
    { m: /^Also there is a chest/, tag: '[excited]',
      ins: [[/You are HUGE/, '[awed]']] },
    { m: /^Down by Mirrowmere/, tag: '[excited]',
      ins: [[/But the deep water is scary/, '[frightened]']] },
    { m: /^If you find gems in it/, tag: '[very serious, self-important]',
      ins: [[/THAT one does not count/, '[defensive]']] },
    { m: /^You went INSIDE the shrine/, tag: '[shrieking with awe]',
      ins: [[/Captain Bram said a word/, '[scandalized delight]']] },
  ],
  rho: [
    { m: /^Grass is good this season/, tag: '[contented, unhurried]',
      ins: [[/and Bram doing shirtless/, '[dryly scandalized]']] },
    { m: /^Aye — wisps/, tag: '[wistful]',
      ins: [[/Lost half a haystack/, '[rueful]']] },
    { m: /^They fade at dawn/, tag: '[matter-of-fact]',
      ins: [[/Looking at you, every bard/, '[flatly annoyed]']] },
  ],
};

// ---------------------------------------------------------------------------
// A stand-in for the live `game` object, good enough for dialogue.js to build
// its node trees. Sweeping it across quest states surfaces every line.
// ---------------------------------------------------------------------------
function mockGame({ mainStage = 0, shroomStage = 0, hordeStage = 0, glowshroom = 0, hordeCount = 0, gems = 0, shrineCleared = false }) {
  const stages = {
    'shattered-star': mainStage,
    'mushroom-medicine': shroomStage,
    'thin-the-horde': hordeStage,
  };
  return {
    state: { items: { glowshroom }, flags: { shrineCleared }, gems },
    quests: {
      stage: (id) => stages[id] ?? 0,
      get: (id) => ({ stage: stages[id] ?? 0, count: id === 'thin-the-horde' ? hordeCount : 0 }),
      canTurnInShrooms: () => shroomStage === 1 && glowshroom >= 5,
      canTurnInHorde: () => hordeStage === 1 && hordeCount >= 10,
    },
  };
}

function collectLines(onlyId = null) {
  const ids = Object.keys(CAST).filter((id) => !onlyId || id === onlyId);
  const seen = new Map();
  const permutations = [];
  for (const mainStage of [0, 1, 2, 3]) {
    for (const shroomStage of [0, 1, 2]) {
      for (const hordeStage of [0, 1, 2]) {
        for (const [glowshroom, hordeCount] of [[0, 0], [5, 10], [2, 4]]) {
          for (const shrineCleared of [false, true]) {
            permutations.push({ mainStage, shroomStage, hordeStage, glowshroom, hordeCount, shrineCleared, gems: 50 });
          }
        }
      }
    }
  }
  for (const opts of permutations) {
    const game = mockGame(opts);
    for (const id of ids) {
      let def;
      try { ({ def } = getDialogue(id, game)); } catch (e) { continue; }
      if (!def || !def.nodes) continue;
      for (const node of Object.values(def.nodes)) {
        for (const raw of (Array.isArray(node.text) ? node.text : [node.text])) {
          const text = normalizeLine(raw);
          // Lines with live counters vary as you play; not worth the credits.
          if (!text || /\d+\s*(of|\/)\s*(5|10|ten|five)\b/i.test(text)) continue;
          const h = lineHash(id, text);
          if (!seen.has(h)) seen.set(h, { speaker: id, text, hash: h });
        }
      }
    }
  }
  return [...seen.values()];
}

/** The direction entry for a line, or null if nobody wrote one. */
function directionFor(line) {
  const list = DIRECTION[line.speaker] || [];
  return list.find((d) => d.m.test(line.text)) || null;
}

/**
 * What actually gets sent. On v3 the line is opened with its direction and the
 * mid-line turns are marked inline; on v2 the text goes out clean, since that
 * model would read the brackets aloud.
 */
function scriptFor(line, model) {
  if (model !== MODEL_V3) return line.text;
  const d = directionFor(line);
  if (!d) return line.text;
  let text = line.text;
  for (const [pattern, tag] of d.ins || []) {
    text = text.replace(pattern, (hit) => `${tag} ${hit}`);
  }
  return `${d.tag} ${text}`;
}

/** Fingerprint of everything that affects how a line sounds. */
function renderKey(line, model, casting) {
  const spec = CAST[line.speaker];
  return [
    model,
    casting[line.speaker]?.voiceId,
    JSON.stringify(spec.settings),
    scriptFor(line, model),
  ].join('|');
}

function castVoices(available, ids) {
  const byName = new Map(available.map((v) => [v.name.toLowerCase(), v]));
  // Names in the library carry descriptions ("Callum - Husky Trickster"), so
  // match on the leading word too.
  const byFirstWord = new Map();
  for (const v of available) {
    const first = v.name.split(/[\s\-–—(,]/)[0].toLowerCase();
    if (first && !byFirstWord.has(first)) byFirstWord.set(first, v);
  }
  const used = new Set();
  const casting = {};
  for (const id of ids) {
    const spec = CAST[id];
    let picked = null;
    if (spec.voiceId) {
      picked = available.find((v) => v.voice_id === spec.voiceId) || { voice_id: spec.voiceId, name: '(pinned)' };
    } else {
      for (const name of spec.preferred) {
        const key = name.toLowerCase();
        const v = byName.get(key) || byFirstWord.get(key);
        if (v && !used.has(v.voice_id)) { picked = v; break; }
      }
    }
    if (!picked) picked = available.find((v) => !used.has(v.voice_id));
    if (!picked) throw new Error(`No voice available for "${id}".`);
    used.add(picked.voice_id);
    casting[id] = { voiceId: picked.voice_id, voiceName: picked.name };
  }
  return casting;
}

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const dryRun = has('--dry-run');
const force = has('--force');
const only = valueOf('--only');
const modelArg = (valueOf('--model') || 'auto').toLowerCase();

if (only && !CAST[only]) {
  console.error(`Unknown character "${only}". Known: ${Object.keys(CAST).join(', ')}`);
  process.exit(1);
}

if (has('--voices')) {
  const voices = await listVoices(apiKey());
  console.log(`${voices.length} voices on this account:\n`);
  for (const v of voices) console.log(`  ${v.name.padEnd(46)} ${v.voice_id}`);
  process.exit(0);
}

const ids = Object.keys(CAST).filter((k) => !only || k === only);
const lines = collectLines(only);

let manifest = { version: 2, voices: {}, lines: {} };
if (existsSync(MANIFEST) && !force) {
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch (e) { console.warn('Existing manifest unreadable, starting fresh.'); }
}
manifest.lines = manifest.lines || {};
manifest.voices = manifest.voices || {};

if (dryRun) {
  const model = modelArg === 'v2' ? MODEL_V2 : MODEL_V3;
  const chars = lines.reduce((n, l) => n + scriptFor(l, model).length, 0);
  console.log(`Model:                 ${model}${modelArg === 'auto' ? ' (falls back to ' + MODEL_V2 + ' if unavailable)' : ''}`);
  console.log(`Dialogue lines:        ${lines.length}`);
  console.log(`Characters to send:    ${chars.toLocaleString()}`);
  for (const id of ids) {
    const n = lines.filter((l) => l.speaker === id).length;
    console.log(`  ${id.padEnd(8)} ${String(n).padStart(3)} lines — ${CAST[id].note}`);
    console.log(`  ${' '.repeat(8)}     wants: ${CAST[id].preferred.join(', ')}`);
  }
  const undirected = lines.filter((l) => !directionFor(l));
  console.log(`\nDirection coverage:    ${lines.length - undirected.length}/${lines.length} lines`);
  if (undirected.length) {
    console.log('  These would fall back to a flat read — add them to DIRECTION:');
    for (const l of undirected) console.log(`    ${l.speaker}: ${l.text.slice(0, 70)}…`);
  }
  const withIns = lines.filter((l) => (directionFor(l)?.ins || []).length).length;
  console.log(`Lines with mid-line turns: ${withIns}`);

  const sub = await subscription(apiKey()).catch(() => null);
  if (sub) console.log(`\nQuota: ${sub.remaining.toLocaleString()} of ${sub.limit.toLocaleString()} characters left (${sub.tier}).`);
  console.log('\n--dry-run: nothing generated, no credits spent.');
  console.log('Recasting or changing delivery re-records affected lines, so expect');
  console.log('close to a full run the first time after a casting change.');
  process.exit(0);
}

const key = apiKey();
console.log('Fetching voices…');
const available = await listVoices(key);
const casting = castVoices(available, ids);

// Pick the model: prefer the expressive one, verify it actually works here.
let model = MODEL_V2;
if (modelArg === 'v3') model = MODEL_V3;
else if (modelArg === 'v2') model = MODEL_V2;
else {
  const probe = Object.values(casting)[0].voiceId;
  process.stdout.write(`Checking ${MODEL_V3} availability… `);
  const ok = await modelWorks(key, probe, MODEL_V3);
  model = ok ? MODEL_V3 : MODEL_V2;
  console.log(ok ? 'available.' : `not available, using ${MODEL_V2}.`);
}
console.log(`Model: ${model}${model === MODEL_V3 ? ' (emotional delivery tags enabled)' : ''}`);
for (const id of ids) console.log(`  ${id.padEnd(8)} → ${casting[id].voiceName}`);

const pending = lines.filter((l) => {
  const e = manifest.lines[l.hash];
  if (force || !e) return true;
  if (!existsSync(join(OUT_DIR, e.file))) return true;
  return e.renderKey !== renderKey(l, model, casting);   // recast or retuned
});
const chars = pending.reduce((n, l) => n + scriptFor(l, model).length, 0);
console.log(`\n${pending.length} of ${lines.length} lines to record (${chars.toLocaleString()} characters).`);

const sub = await subscription(key);
if (sub) {
  console.log(`Quota: ${sub.remaining.toLocaleString()} of ${sub.limit.toLocaleString()} left (${sub.tier}).`);
  if (sub.remaining < chars) {
    console.warn(`\n⚠ This run needs ~${chars.toLocaleString()} characters but only ${sub.remaining.toLocaleString()} remain.`);
    console.warn('  It will generate as much as it can and stop; re-run when quota resets.');
  }
}
if (pending.length === 0) { console.log('Nothing to do.'); process.exit(0); }

mkdirSync(OUT_DIR, { recursive: true });
for (const id of ids) manifest.voices[id] = { ...casting[id], note: CAST[id].note };

let done = 0, failed = 0;
for (const line of pending) {
  const script = scriptFor(line, model);
  const rel = `${line.speaker}/${line.hash}.mp3`;
  const abs = join(OUT_DIR, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const label = line.text.length > 52 ? line.text.slice(0, 49) + '…' : line.text;
  process.stdout.write(`  [${String(++done).padStart(3)}/${pending.length}] ${line.speaker.padEnd(6)} ${label}\n`);
  try {
    const mp3 = await textToSpeech(key, casting[line.speaker].voiceId, script, {
      model, settings: CAST[line.speaker].settings,
    });
    writeFileSync(abs, mp3);
    manifest.lines[line.hash] = {
      file: rel, speaker: line.speaker, text: line.text,
      chars: script.length, bytes: mp3.length,
      renderKey: renderKey(line, model, casting),
    };
  } catch (err) {
    failed++;
    console.error(`        ✗ ${err.message}`);
    if (err.status === 401 || err.status === 403) { console.error('\nAuth failed — check the API key.'); break; }
    if (err.status === 429 || /quota|credit/i.test(err.message)) {
      console.error('\nOut of credits or rate limited. Finished lines are kept; re-run later.');
      break;
    }
  }
}

// Drop entries whose dialogue no longer exists.
const live = new Set(lines.map((l) => l.hash));
for (const h of Object.keys(manifest.lines)) {
  if (only && manifest.lines[h].speaker !== only) continue;
  if (!live.has(h)) {
    const stale = join(OUT_DIR, manifest.lines[h].file);
    if (existsSync(stale)) { try { rmSync(stale); } catch (e) { /* leave it */ } }
    delete manifest.lines[h];
  }
}

manifest.version = 2;
manifest.model = model;
manifest.generated = new Date().toISOString();
delete manifest.note;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nWrote ${Object.keys(manifest.lines).length} lines to assets/voice/`);
if (failed) console.log(`${failed} failed — re-run to retry just those.`);
