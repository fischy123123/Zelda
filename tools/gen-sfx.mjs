// Generate sound effects with the ElevenLabs sound-generation API.
//
// The game synthesizes every effect procedurally in WebAudio and keeps doing
// so for anything not generated here, so this pack is purely an upgrade layer:
// where a sample exists it plays instead of the synth (see js/core/Samples.js).
//
// Deliberately omitted: footsteps, UI ticks and the dialogue blip. Those fire
// many times a second, and the synthesized versions are tighter and cheaper
// than streaming samples.
//
// Usage:
//   node tools/gen-sfx.mjs --dry-run      # plan + cost, spends nothing
//   node tools/gen-sfx.mjs                # generate what's missing
//   node tools/gen-sfx.mjs --only sword1
//   node tools/gen-sfx.mjs --force

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { ROOT, apiKey, soundEffect, subscription } from './lib/eleven.mjs';

const OUT_DIR = join(ROOT, 'assets', 'sfx');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// Prompts are written for a stylized cel-shaded fantasy game: punchy, dry,
// close-mic'd, no music, no room tone — the engine adds its own reverb.
const SFX = {
  sword1:    { d: 0.5, p: 'Fast light sword slash through air, short clean metallic whoosh, dry, no reverb, game sound effect' },
  sword2:    { d: 0.5, p: 'Second sword slash, slightly deeper whoosh with a faint metal ring, dry, punchy, game sound effect' },
  sword3:    { d: 0.8, p: 'Heavy finishing sword slash, deep powerful whoosh with metallic shing, dry, impactful, game sound effect' },
  spin:      { d: 1.1, p: 'Spinning blade attack, sustained circular metallic whoosh rising then falling, heroic, dry, game sound effect' },
  hit:       { d: 0.4, p: 'Sword striking flesh, dull wet thud with a short metallic edge, punchy, dry, game sound effect' },
  crit:      { d: 0.7, p: 'Critical hit impact, sharp bright metallic crack with a satisfying low thump, dry, game sound effect' },
  block:     { d: 0.5, p: 'Sword blocked by a wooden shield, hard clunk with metal scrape, dry, game sound effect' },
  enemy_hit: { d: 0.5, p: 'Small goblin creature hurt, short high-pitched pained squeak grunt, cartoonish, dry' },
  enemy_die: { d: 0.9, p: 'Small goblin creature defeated, comical descending squeal with a soft poof, cartoonish, dry' },
  hurt:      { d: 0.6, p: 'Human hero taking damage, short sharp pained grunt, dry, game sound effect' },
  heal:      { d: 1.4, p: 'Magical healing, warm ascending shimmer with soft chimes, gentle and restorative, fantasy game' },
  gem:       { d: 0.5, p: 'Collecting a gem, bright short crystalline ping, cheerful, clean, game pickup sound' },
  key:       { d: 0.7, p: 'Picking up an ornate key, metallic jingle with a bright chime, fantasy game pickup' },
  chest:     { d: 1.2, p: 'Wooden treasure chest creaking open, hinges groaning then a soft wooden clunk, fantasy game' },
  chest_big: { d: 2.2, p: 'Large ornate treasure chest opening with a triumphant magical shimmer revealing treasure, fantasy game' },
  secret:    { d: 1.8, p: 'Secret discovered, bright magical ascending sparkle reveal, mysterious and rewarding, fantasy game' },
  jump:      { d: 0.4, p: 'Light character jump, soft cloth and leather rustle with a small air whoosh, dry' },
  land:      { d: 0.4, p: 'Character landing on grass, soft dull thud with boot leather, dry, game sound effect' },
  roll:      { d: 0.7, p: 'Character combat roll across grass, quick fabric and leather tumble scuff, dry' },
  splash:    { d: 1.0, p: 'Body splashing into a lake, single clean water splash with droplets, outdoor, no music' },
  door:      { d: 1.5, p: 'Heavy ancient stone door grinding open, deep rumbling scrape, echoing dungeon, fantasy game' },
  portal:    { d: 2.0, p: 'Magical portal activating, swirling ethereal whoosh with rising shimmer, fantasy game' },
  explosion: { d: 1.6, p: 'Magical explosion, deep boom with crackling arcane energy, powerful, fantasy game' },
  bolt:      { d: 0.7, p: 'Magic bolt projectile firing, sharp electric zap whoosh, arcane, dry, fantasy game' },
  boss_hit:  { d: 0.8, p: 'Striking a giant stone bone golem, heavy cracking impact of blade on bone and rock, dry' },
  boss_roar: { d: 2.6, p: 'Colossal undead bone golem roaring, deep monstrous bellow with rattling bones, terrifying, fantasy game' },
  quest:     { d: 1.8, p: 'Quest accepted, short noble fanfare with warm strings and a bright chime, fantasy game' },
  brazier:   { d: 1.2, p: 'Torch brazier igniting, whoosh of flame catching and settling into a crackle' },
};

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const dryRun = has('--dry-run');
const force = has('--force');
const only = valueOf('--only');

if (only && !SFX[only]) {
  console.error(`Unknown effect "${only}". Known: ${Object.keys(SFX).join(', ')}`);
  process.exit(1);
}
const names = Object.keys(SFX).filter((n) => !only || n === only);

let manifest = { version: 1, sounds: {} };
if (existsSync(MANIFEST) && !force) {
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch (e) { /* fresh */ }
}
manifest.sounds = manifest.sounds || {};

const keyOf = (n) => createHash('sha256').update(`${SFX[n].p}|${SFX[n].d}`).digest('hex').slice(0, 12);
const pending = names.filter((n) => {
  const e = manifest.sounds[n];
  if (force || !e) return true;
  if (!existsSync(join(OUT_DIR, e.file))) return true;
  return e.promptKey !== keyOf(n);
});
const seconds = pending.reduce((s, n) => s + SFX[n].d, 0);

console.log(`Sound effects defined: ${names.length}`);
console.log(`To generate now:       ${pending.length}  (~${seconds.toFixed(1)}s of audio)`);
if (dryRun) {
  for (const n of pending) console.log(`  ${n.padEnd(11)} ${SFX[n].d}s  ${SFX[n].p.slice(0, 66)}…`);
  const sub = await subscription(apiKey()).catch(() => null);
  if (sub) console.log(`\nQuota: ${sub.remaining.toLocaleString()} of ${sub.limit.toLocaleString()} characters left (${sub.tier}).`);
  console.log('\n--dry-run: nothing generated, no credits spent.');
  console.log('Sound effects are billed by duration, and the character-equivalent');
  console.log('rate is not something this script can look up. To find it exactly,');
  console.log('generate one short effect and compare the quota before and after:');
  console.log('');
  console.log('    --only sword1        (0.5s, the cheapest thing here)');
  console.log('');
  console.log('A real run prints the quota it consumed and extrapolates the rest,');
  console.log('so one cheap effect tells you whether the full set fits.');
  process.exit(0);
}
if (pending.length === 0) { console.log('Nothing to do. Use --force to regenerate.'); process.exit(0); }

const key = apiKey();
const before = await subscription(key);
if (before) console.log(`Quota before: ${before.remaining.toLocaleString()} of ${before.limit.toLocaleString()} (${before.tier}).`);
mkdirSync(OUT_DIR, { recursive: true });
let done = 0, failed = 0, madeSeconds = 0;
for (const n of pending) {
  const spec = SFX[n];
  process.stdout.write(`  [${String(++done).padStart(2)}/${pending.length}] ${n.padEnd(11)} ${spec.d}s\n`);
  try {
    const mp3 = await soundEffect(key, spec.p, { duration: spec.d, influence: 0.6 });
    const rel = `${n}.mp3`;
    writeFileSync(join(OUT_DIR, rel), mp3);
    manifest.sounds[n] = { file: rel, seconds: spec.d, bytes: mp3.length, promptKey: keyOf(n) };
    madeSeconds += spec.d;
  } catch (err) {
    failed++;
    console.error(`      ✗ ${err.message}`);
    if (err.status === 401 || err.status === 403) { console.error('\nAuth failed — check the API key.'); break; }
    if (err.status === 429 || /quota|credit/i.test(err.message)) {
      console.error('\nOut of credits or rate limited. Finished effects are kept; re-run later.');
      break;
    }
    if (err.status === 404) {
      console.error('\nThis account does not appear to have the sound-generation endpoint.');
      break;
    }
  }
}

manifest.version = 1;
manifest.generated = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nWrote ${Object.keys(manifest.sounds).length} effects to assets/sfx/`);
if (failed) console.log(`${failed} failed — re-run to retry just those.`);

// Report what this actually cost, and what finishing the set would cost.
const after = await subscription(key);
if (before && after && madeSeconds > 0) {
  const spent = Math.max(0, before.remaining - after.remaining);
  console.log(`\nQuota after: ${after.remaining.toLocaleString()} of ${after.limit.toLocaleString()}.`);
  console.log(`This run generated ${madeSeconds.toFixed(1)}s and consumed ${spent.toLocaleString()} credits.`);
  if (spent > 0) {
    const perSec = spent / madeSeconds;
    const left = names.filter((n) => !manifest.sounds[n]).reduce((t, n) => t + SFX[n].d, 0);
    console.log(`That is about ${perSec.toFixed(0)} credits per second of audio.`);
    if (left > 0) {
      const need = Math.ceil(left * perSec);
      console.log(`Remaining effects: ${left.toFixed(1)}s ≈ ${need.toLocaleString()} credits.`);
      console.log(need <= after.remaining
        ? '  That fits in what you have left.'
        : `  That exceeds your remaining ${after.remaining.toLocaleString()} — generate the rest after your quota resets.`);
    }
  }
}
