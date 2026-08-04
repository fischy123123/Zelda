// Generate mood music with the ElevenLabs Music API.
//
// The game ships a fully procedural score built on one leitmotif, which keeps
// playing for any mood not generated here. Where a track exists it is streamed
// and crossfaded instead (see js/core/Samples.js).
//
// Cost warning: music is billed far more heavily than speech or effects, and
// these are 40-second tracks. Run --dry-run first, and consider generating one
// mood at a time with --only.
//
// Usage:
//   node tools/gen-music.mjs --dry-run
//   node tools/gen-music.mjs --only village
//   node tools/gen-music.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ROOT, apiKey, music, subscription, mb } from './lib/eleven.mjs';

const OUT_DIR = join(ROOT, 'assets', 'music');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// Prompts describe the same leitmotif-driven world as the procedural score:
// warm orchestral fantasy, pentatonic, no vocals, loopable.
const MOODS = {
  title:   { ms: 45000, p: 'Noble orchestral fantasy adventure main theme, warm strings and French horn stating a soaring heroic melody, gentle harp, hopeful and grand, cinematic game title music, no vocals, seamless loop' },
  explore: { ms: 50000, p: 'Gentle pastoral fantasy exploration music, soft strings and woodwinds, sparse harp, airy and wide open, wandering green hills, calm and unhurried, no vocals, seamless loop' },
  village: { ms: 45000, p: 'Cozy medieval village waltz in 3/4, plucked lute and light fiddle with tambourine, warm friendly and lilting, fantasy game town theme, no vocals, seamless loop' },
  night:   { ms: 45000, p: 'Quiet nighttime fantasy ambience music, sparse music box and soft sustained strings, gentle minor key, moonlit and peaceful with a hint of mystery, no vocals, seamless loop' },
  combat:  { ms: 40000, p: 'Driving orchestral fantasy battle music, urgent low strings ostinato, taiko and snare percussion, brass stabs, heroic and tense, no vocals, seamless loop' },
  boss:    { ms: 40000, p: 'Epic fantasy boss battle music, thunderous percussion, dissonant brass, frantic strings, ominous choir-like pads, overwhelming and dangerous, no vocals, seamless loop' },
  dungeon: { ms: 45000, p: 'Dark ancient dungeon ambience music, low drones, distant echoing bells, sparse and foreboding, cavernous reverb, slow and unsettling, no vocals, seamless loop' },
};

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const dryRun = has('--dry-run');
const force = has('--force');
const only = valueOf('--only');

if (only && !MOODS[only]) {
  console.error(`Unknown mood "${only}". Known: ${Object.keys(MOODS).join(', ')}`);
  process.exit(1);
}
const names = Object.keys(MOODS).filter((n) => !only || n === only);

let manifest = { version: 1, tracks: {} };
if (existsSync(MANIFEST) && !force) {
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch (e) { /* fresh */ }
}
manifest.tracks = manifest.tracks || {};

const keyOf = (n) => createHash('sha256').update(`${MOODS[n].p}|${MOODS[n].ms}`).digest('hex').slice(0, 12);
const pending = names.filter((n) => {
  const e = manifest.tracks[n];
  if (force || !e) return true;
  if (!existsSync(join(OUT_DIR, e.file))) return true;
  return e.promptKey !== keyOf(n);
});
const totalSec = pending.reduce((s, n) => s + MOODS[n].ms / 1000, 0);

console.log(`Moods defined:    ${names.length}`);
console.log(`To generate now:  ${pending.length}  (${(totalSec / 60).toFixed(1)} minutes of music)`);
if (dryRun) {
  for (const n of pending) console.log(`  ${n.padEnd(8)} ${(MOODS[n].ms / 1000).toFixed(0)}s  ${MOODS[n].p.slice(0, 60)}…`);
  const sub = await subscription(apiKey()).catch(() => null);
  if (sub) console.log(`\nQuota: ${sub.remaining.toLocaleString()} of ${sub.limit.toLocaleString()} characters left (${sub.tier}).`);
  console.log('\n--dry-run: nothing generated, no credits spent.');
  console.log('⚠ Music is the most expensive thing on the API and may not be enabled');
  console.log('  on every plan. Try one mood first:  --only village');
  process.exit(0);
}
if (pending.length === 0) { console.log('Nothing to do. Use --force to regenerate.'); process.exit(0); }

const key = apiKey();
mkdirSync(OUT_DIR, { recursive: true });
let done = 0, failed = 0, bytes = 0;
for (const n of pending) {
  const spec = MOODS[n];
  process.stdout.write(`  [${String(++done).padStart(2)}/${pending.length}] ${n.padEnd(8)} ${(spec.ms / 1000).toFixed(0)}s …\n`);
  try {
    const mp3 = await music(key, spec.p, { lengthMs: spec.ms });
    const rel = `${n}.mp3`;
    writeFileSync(join(OUT_DIR, rel), mp3);
    bytes += mp3.length;
    manifest.tracks[n] = { file: rel, ms: spec.ms, bytes: mp3.length, promptKey: keyOf(n) };
    console.log(`      ✓ ${mb(mp3.length)}`);
  } catch (err) {
    failed++;
    console.error(`      ✗ ${err.message}`);
    if (err.status === 401 || err.status === 403) { console.error('\nAuth failed — check the API key.'); break; }
    if (err.status === 404) {
      console.error('\nThe music endpoint is not available on this account or plan.');
      console.error('The game keeps using its procedural score, which is fine.');
      break;
    }
    if (err.status === 429 || /quota|credit/i.test(err.message)) {
      console.error('\nOut of credits or rate limited. Finished tracks are kept; re-run later.');
      break;
    }
  }
}

manifest.version = 1;
manifest.generated = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${Object.keys(manifest.tracks).length} tracks to assets/music/ (${mb(bytes)} this run)`);
if (failed) console.log(`${failed} failed — re-run to retry just those.`);
