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
const CAST = {
  maren: {
    note: 'Ancient village elder. Foul-mouthed, warm, zero patience.',
    preferred: ['Matilda', 'Alice', 'Charlotte', 'Aria', 'Sarah'],
    settings: { stability: 0.28, similarity_boost: 0.75, style: 0.65 },
    tag: '[a cackling, foul-mouthed old woman, warm but exasperated]',
    lineTags: [
      { match: /butter my ass|actually did it/i, tag: '[overjoyed, cackling with delight]' },
      { match: /jackass with a sword/i, tag: '[dry, unimpressed, weary]' },
      { match: /piss off heroically|Hot damn/i, tag: '[gleeful, shooing them out the door]' },
      { match: /too old to sew/i, tag: '[gruff but genuinely fond]' },
    ],
  },
  nyla: {
    note: 'Healer. Brisk, dry, mothers you while insulting you.',
    preferred: ['Alice', 'Sarah', 'Jessica', 'Lily', 'Aria'],
    settings: { stability: 0.34, similarity_boost: 0.75, style: 0.55 },
    tag: '[brisk, dryly sarcastic healer, fond underneath]',
    lineTags: [
      { match: /speak exclusively to furniture/i, tag: '[deadpan, savoring the punchline]' },
      { match: /happy to see me/i, tag: '[teasing, delighted]' },
      { match: /wolfsbane|THEN kill you/i, tag: '[cheerfully threatening]' },
    ],
  },
  bram: {
    note: 'Guard captain. Loud, gravelly, aggressively enthusiastic.',
    preferred: ['Callum', 'Bill', 'Brian', 'Daniel', 'Roger'],
    settings: { stability: 0.25, similarity_boost: 0.8, style: 0.75 },
    tag: '[booming, gravelly soldier, far too enthusiastic]',
    lineTags: [
      { match: /MOONED me|mooned/i, tag: '[outraged, wounded dignity]' },
      { match: /HA!|Music to my ears/i, tag: '[delighted, barking a laugh]' },
      { match: /ROLL, damn you|Do not block/i, tag: '[shouting an urgent order]' },
      { match: /fart in a bathhouse|club suppository/i, tag: '[gleeful, conspiratorial]' },
    ],
  },
  tam: {
    note: 'Shopkeep. Smooth, jovial, shameless salesman.',
    preferred: ['George', 'Brian', 'Will', 'Eric', 'Roger'],
    settings: { stability: 0.35, similarity_boost: 0.75, style: 0.6 },
    tag: '[warm, oily, delighted market trader working a mark]',
    lineTags: [
      { match: /monopoly and a complete lack of shame/i, tag: '[proud, utterly shameless]' },
      { match: /tastes like feet/i, tag: '[reassuring, breezily dismissive]' },
      { match: /aspirational/i, tag: '[lowering the voice, conspiratorial]' },
    ],
  },
  pip: {
    note: 'Excitable kid. Fast, breathless, delighted with himself.',
    preferred: ['Jessica', 'Lily', 'River', 'Laura', 'Aria'],
    settings: { stability: 0.2, similarity_boost: 0.7, style: 0.85 },
    tag: '[a small breathless child, bursting with secrets, talking too fast]',
    lineTags: [
      { match: /Bigger than TWO wells/i, tag: '[shrieking with excitement]' },
      { match: /FULL OF CRAP|swearing but mum/i, tag: '[gleeful, whispering a forbidden word]' },
      { match: /RULE of secrets/i, tag: '[very serious, self-important]' },
    ],
  },
  rho: {
    note: 'Farmer. Slow, weathered, quietly amused.',
    preferred: ['Bill', 'Brian', 'Chris', 'Eric', 'Daniel'],
    settings: { stability: 0.45, similarity_boost: 0.75, style: 0.4 },
    tag: '[slow weathered old farmer, unhurried, quietly amused]',
    lineTags: [
      { match: /Nobody is fooled, Bram/i, tag: '[dry, faintly scandalized, enjoying the gossip]' },
      { match: /most of my dignity/i, tag: '[rueful, self-deprecating]' },
      { match: /every bard ever/i, tag: '[flatly unimpressed]' },
    ],
  },
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

/** What actually gets sent: the line, prefixed with a delivery tag on v3. */
function scriptFor(line, model) {
  if (model !== MODEL_V3) return line.text;
  const spec = CAST[line.speaker];
  const override = (spec.lineTags || []).find((t) => t.match.test(line.text));
  return `${(override || spec).tag} ${line.text}`;
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
