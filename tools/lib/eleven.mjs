// Shared ElevenLabs plumbing for the generator scripts: key loading, HTTP,
// voice listing, and the three generation endpoints (speech, sound effects,
// music). Nothing here ever runs in the browser.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.elevenlabs.io/v1';

export function apiKey() {
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

export async function api(path, key, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': key, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${init.method || 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

export async function listVoices(key) {
  const res = await api('/voices', key);
  const { voices } = await res.json();
  return voices || [];
}

/** Report remaining quota so a run can warn before it burns credits. */
export async function subscription(key) {
  try {
    const res = await api('/user/subscription', key);
    const s = await res.json();
    const used = s.character_count ?? 0;
    const limit = s.character_limit ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used), tier: s.tier || 'unknown' };
  } catch (e) {
    return null;
  }
}

export async function textToSpeech(key, voiceId, text, { model, settings }) {
  const res = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { use_speaker_boost: true, ...settings },
    }),
  });
  return Buffer.from(await res.arrayBuffer());
}

/** Text-to-sound-effects. duration in seconds (0.5–22), or null to let it choose. */
export async function soundEffect(key, prompt, { duration = null, influence = 0.55, loop = false } = {}) {
  const body = { text: prompt, prompt_influence: influence };
  if (duration != null) body.duration_seconds = duration;
  if (loop) body.loop = true;
  const res = await api('/sound-generation?output_format=mp3_44100_128', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return Buffer.from(await res.arrayBuffer());
}

/** ElevenLabs Music. lengthMs is clamped by the API to its supported range. */
export async function music(key, prompt, { lengthMs = 30000 } = {}) {
  const res = await api('/music?output_format=mp3_44100_128', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: lengthMs }),
  });
  return Buffer.from(await res.arrayBuffer());
}

/** Probe whether a TTS model works on this account, cheaply. */
export async function modelWorks(key, voiceId, model) {
  try {
    await textToSpeech(key, voiceId, 'Ah.', { model, settings: { stability: 0.5 } });
    return true;
  } catch (e) {
    return false;
  }
}

/** Pretty byte size. */
export const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
