// Generate voiced dialogue for Aurelia with the ElevenLabs text-to-speech API.
//
// This runs on YOUR machine, never in the browser — the API key stays in your
// shell and only the resulting .mp3 files are committed. The game reads them
// through assets/voice/manifest.json (see js/core/Voice.js) and plays fine
// without them, so generating audio is always optional.
//
// Usage:
//   export ELEVENLABS_API_KEY=sk_...        (or put it in .env.local)
//   node tools/gen-voices.mjs --dry-run     # what it would do + cost estimate
//   node tools/gen-voices.mjs --voices      # list the voices on your account
//   node tools/gen-voices.mjs               # generate anything missing
//   node tools/gen-voices.mjs --only maren  # just one character
//   node tools/gen-voices.mjs --force       # re-record even existing lines
//
// Lines already present in the manifest are skipped, so re-running after a
// dialogue edit only pays for what actually changed.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDialogue } from '../js/data/dialogue.js';
import { lineHash, normalizeLine } from '../js/util/hash.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'assets', 'voice');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_multilingual_v2';

// ---------------------------------------------------------------------------
// Casting. `preferred` is matched (case-insensitively) against the voices on
// your account, first hit wins; if none match, an unused voice is assigned so
// every character still sounds different. Put an explicit ElevenLabs voice id
// in `voiceId` to pin one exactly.
// ---------------------------------------------------------------------------
const CAST = {
  maren: {
    note: 'Ancient village elder. Foul-mouthed, warm, zero patience.',
    preferred: ['Grandma', 'Dorothy', 'Matilda', 'Charlotte', 'Rachel'],
    settings: { stability: 0.42, similarity_boost: 0.75, style: 0.45 },
  },
  nyla: {
    note: 'Healer. Brisk, dry, mothers you while insulting you.',
    preferred: ['Alice', 'Lily', 'Freya', 'Bella', 'Elli'],
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0.35 },
  },
  bram: {
    note: 'Guard captain. Loud, gravelly, aggressively enthusiastic.',
    preferred: ['Arnold', 'Bill', 'Daniel', 'Antoni', 'Josh'],
    settings: { stability: 0.38, similarity_boost: 0.8, style: 0.55 },
  },
  tam: {
    note: 'Shopkeep. Smooth, jovial, shameless salesman.',
    preferred: ['Brian', 'George', 'Callum', 'Adam', 'Sam'],
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4 },
  },
  pip: {
    note: 'Excitable kid. Fast, breathless, delighted with himself.',
    preferred: ['Lily', 'River', 'Elli', 'Dorothy', 'Charlie'],
    settings: { stability: 0.3, similarity_boost: 0.7, style: 0.65 },
  },
  rho: {
    note: 'Farmer. Slow, weathered, quietly amused.',
    preferred: ['Bill', 'Chris', 'Daniel', 'Liam', 'Arnold'],
    settings: { stability: 0.6, similarity_boost: 0.75, style: 0.25 },
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

/** Walk every NPC through every quest state and collect the unique lines. */
function collectLines(onlyId = null) {
  const ids = Object.keys(CAST).filter((id) => !onlyId || id === onlyId);
  const seen = new Map(); // hash → {speaker, text}

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
        const pages = Array.isArray(node.text) ? node.text : [node.text];
        for (const raw of pages) {
          const text = normalizeLine(raw);
          // Lines with live counters in them ("3 of ten so far") vary at
          // runtime; voicing every value is not worth the credits.
          if (!text || /\d+\s*(of|\/)\s*(5|10|ten|five)\b/i.test(text)) continue;
          const h = lineHash(id, text);
          if (!seen.has(h)) seen.set(h, { speaker: id, text, hash: h });
        }
      }
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------
function apiKey() {
  let key = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_API_KEY;
  if (!key) {
    const envFile = join(ROOT, '.env.local');
    if (existsSync(envFile)) {
      const m = readFileSync(envFile, 'utf8').match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) key = m[1].replace(/^["']|["']$/g, '');
    }
  }
  if (!key) {
    console.error('No API key. Set ELEVENLABS_API_KEY in your environment, or put');
    console.error('  ELEVENLABS_API_KEY=sk_...');
    console.error('in .env.local (which is gitignored).');
    process.exit(1);
  }
  return key;
}

async function api(path, key, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': key, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`);
  }
  return res;
}

async function listVoices(key) {
  const res = await api('/voices', key);
  const { voices } = await res.json();
  return voices || [];
}

/** Resolve each character to a distinct voice id. */
function castVoices(available, ids) {
  const byName = new Map(available.map((v) => [v.name.toLowerCase(), v]));
  const used = new Set();
  const casting = {};

  for (const id of ids) {
    const spec = CAST[id];
    let picked = null;
    if (spec.voiceId) {
      picked = available.find((v) => v.voice_id === spec.voiceId) || { voice_id: spec.voiceId, name: '(pinned)' };
    } else {
      for (const name of spec.preferred) {
        const v = byName.get(name.toLowerCase());
        if (v && !used.has(v.voice_id)) { picked = v; break; }
      }
    }
    if (!picked) picked = available.find((v) => !used.has(v.voice_id));
    if (!picked) {
      throw new Error(`No voice available for "${id}" — your account has ${available.length} voices.`);
    }
    used.add(picked.voice_id);
    casting[id] = { voiceId: picked.voice_id, voiceName: picked.name };
  }
  return casting;
}

async function synthesize(key, voiceId, text, settings) {
  const res = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { use_speaker_boost: true, ...settings },
    }),
  });
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const dryRun = has('--dry-run');
const force = has('--force');
const only = valueOf('--only');

if (only && !CAST[only]) {
  console.error(`Unknown character "${only}". Known: ${Object.keys(CAST).join(', ')}`);
  process.exit(1);
}

if (has('--voices')) {
  const voices = await listVoices(apiKey());
  console.log(`${voices.length} voices on this account:\n`);
  for (const v of voices) {
    console.log(`  ${v.name.padEnd(22)} ${v.voice_id}  ${v.labels?.description || v.category || ''}`);
  }
  process.exit(0);
}

const lines = collectLines(only);
const totalChars = lines.reduce((n, l) => n + l.text.length, 0);

// Load the existing manifest so re-runs only pay for new lines.
let manifest = { version: 1, model: MODEL, voices: {}, lines: {} };
if (existsSync(MANIFEST) && !force) {
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
  catch (e) { console.warn('Existing manifest unreadable, starting fresh.'); }
}
manifest.lines = manifest.lines || {};
manifest.voices = manifest.voices || {};

const pending = lines.filter((l) => force || !manifest.lines[l.hash] || !existsSync(join(OUT_DIR, manifest.lines[l.hash].file)));
const pendingChars = pending.reduce((n, l) => n + l.text.length, 0);

console.log(`Dialogue lines found:  ${lines.length}  (${totalChars.toLocaleString()} characters)`);
console.log(`Already generated:     ${lines.length - pending.length}`);
console.log(`To generate now:       ${pending.length}  (${pendingChars.toLocaleString()} characters)`);
for (const id of Object.keys(CAST).filter((k) => !only || k === only)) {
  const n = lines.filter((l) => l.speaker === id).length;
  const p = pending.filter((l) => l.speaker === id).length;
  console.log(`  ${id.padEnd(8)} ${String(n).padStart(3)} lines  ${p} pending  — ${CAST[id].note}`);
}

if (dryRun) {
  console.log('\n--dry-run: nothing generated, no credits spent.');
  console.log('ElevenLabs bills roughly 1 credit per character, so this run would');
  console.log(`cost about ${pendingChars.toLocaleString()} credits. Check your quota with --voices or on their dashboard.`);
  process.exit(0);
}

if (pending.length === 0) {
  console.log('\nEverything is already generated. Use --force to re-record.');
  process.exit(0);
}

const key = apiKey();
console.log('\nFetching voices…');
const available = await listVoices(key);
const casting = castVoices(available, Object.keys(CAST).filter((k) => !only || k === only));
for (const [id, c] of Object.entries(casting)) {
  console.log(`  ${id.padEnd(8)} → ${c.voiceName} (${c.voiceId})`);
  manifest.voices[id] = c;
}

mkdirSync(OUT_DIR, { recursive: true });
let done = 0, failed = 0;
for (const line of pending) {
  const c = casting[line.speaker];
  const rel = `${line.speaker}/${line.hash}.mp3`;
  const abs = join(OUT_DIR, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const label = line.text.length > 58 ? line.text.slice(0, 55) + '…' : line.text;
  process.stdout.write(`  [${String(++done).padStart(3)}/${pending.length}] ${line.speaker.padEnd(6)} ${label}\n`);
  try {
    const mp3 = await synthesize(key, c.voiceId, line.text, CAST[line.speaker].settings);
    writeFileSync(abs, mp3);
    manifest.lines[line.hash] = {
      file: rel, speaker: line.speaker, text: line.text, chars: line.text.length, bytes: mp3.length,
    };
  } catch (err) {
    failed++;
    console.error(`        ✗ ${err.message}`);
    if (/401|403/.test(err.message)) { console.error('\nAuth failed — check your API key.'); break; }
    if (/429|quota|credit/i.test(err.message)) {
      console.error('\nOut of credits or rate limited. Re-run later; finished lines are kept.');
      break;
    }
  }
}

// Drop manifest entries whose dialogue no longer exists.
const live = new Set(lines.map((l) => l.hash));
for (const h of Object.keys(manifest.lines)) {
  if (only && manifest.lines[h].speaker !== only) continue;
  if (!live.has(h)) {
    const stale = join(OUT_DIR, manifest.lines[h].file);
    if (existsSync(stale)) { try { rmSync(stale); } catch (e) { /* leave it */ } }
    delete manifest.lines[h];
  }
}

manifest.generated = new Date().toISOString();
manifest.model = MODEL;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nWrote ${Object.keys(manifest.lines).length} lines to assets/voice/`);
if (failed) console.log(`${failed} line(s) failed — re-run to retry just those.`);
console.log('Reload the game; voiced dialogue turns on automatically.');
