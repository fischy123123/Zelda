// Even out the loudness of generated music tracks.
//
// ElevenLabs masters each track independently, so a gentle title theme can come
// back four times quieter than a combat cue. A single trim in the player can
// only serve one of them. This measures each track and writes a per-track
// `gain` into assets/music/manifest.json, which js/core/Samples.js already
// honours, so every mood sits at the same perceived level.
//
// Decoding needs a real audio decoder, so this drives headless Chromium and a
// local static server — the same pair the screenshot tooling uses.
//
// Usage:  node tools/normalize-music.mjs [--target 0.03] [--port 8123]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { ROOT } from './lib/eleven.mjs';

const MANIFEST = join(ROOT, 'assets', 'music', 'manifest.json');
const argv = process.argv.slice(2);
const valueOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

// Source-level RMS every track is scaled toward. Chosen so a normalized track
// lands a little above where the procedural score sat once the music bus
// applies its own gain.
const TARGET = parseFloat(valueOf('--target', '0.03'));
const PORT = parseInt(valueOf('--port', '8123'), 10);

if (!existsSync(MANIFEST)) {
  console.error('No music manifest — generate music first with tools/gen-music.mjs.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const tracks = Object.entries(manifest.tracks || {});
if (!tracks.length) { console.log('No tracks to normalize.'); process.exit(0); }

// Minimal static server so the browser can fetch the mp3s.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.css': 'text/css' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

let chromium;
try {
  ({ chromium } = await import(join(ROOT, 'node_modules', 'playwright', 'index.mjs')));
} catch (e) {
  console.error('Playwright is required to decode audio. Install it with: npm i -D playwright');
  server.close();
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });

const measured = await page.evaluate(async ([files, port]) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = {};
  for (const [mood, file] of files) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/assets/music/${file}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const d = buf.getChannelData(0);
      let sum = 0, peak = 0, n = 0;
      const step = Math.max(1, Math.floor(d.length / 500000));
      for (let i = 0; i < d.length; i += step) {
        const v = d[i]; const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v; n++;
      }
      out[mood] = { rms: Math.sqrt(sum / n), peak, seconds: buf.duration };
    } catch (e) {
      out[mood] = { error: String(e && e.message || e) };
    }
  }
  return out;
}, [tracks.map(([m, e]) => [m, e.file]), PORT]);

await browser.close();
server.close();

console.log(`Target source RMS: ${TARGET}\n`);
console.log('mood      rms      peak   gain   (clipping headroom)');
let changed = 0;
for (const [mood, entry] of tracks) {
  const m = measured[mood];
  if (!m || m.error) { console.log(`  ${mood.padEnd(8)} failed: ${m && m.error}`); continue; }
  // Scale toward the target, but never so far that peaks would clip.
  let gain = TARGET / m.rms;
  const ceiling = 0.98 / Math.max(m.peak, 1e-6);
  if (gain > ceiling) gain = ceiling;
  gain = Math.round(gain * 1000) / 1000;
  const head = (m.peak * gain).toFixed(2);
  console.log(`  ${mood.padEnd(8)} ${m.rms.toFixed(4)}  ${m.peak.toFixed(3)}  ${String(gain).padEnd(6)} (peak → ${head})`);
  if (entry.gain !== gain) { entry.gain = gain; changed++; }
  entry.measuredRms = Math.round(m.rms * 10000) / 10000;
}

manifest.normalized = { target: TARGET, at: new Date().toISOString() };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nUpdated ${changed} track gain(s) in assets/music/manifest.json.`);
console.log('The player reads these directly — no code change needed.');
