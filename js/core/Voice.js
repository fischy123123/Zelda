// Voiced dialogue playback.
//
// Audio is generated ahead of time by tools/gen-voices.mjs (which talks to
// ElevenLabs on a developer's machine — no API key ever reaches the browser)
// and committed under assets/voice/. This module just maps a line of dialogue
// to its clip and plays it through the engine's voice bus.
//
// Everything here degrades quietly: if the manifest is absent, or a particular
// line was never generated (dynamic text with counts in it, say), the game
// behaves exactly as it did before — typewriter blips and no voice.

import { lineHash } from '../util/hash.js';

const MANIFEST_URL = 'assets/voice/manifest.json';
const BASE_URL = 'assets/voice/';
const MAX_CACHED = 48;

export class Voice {
  constructor(game) {
    this.game = game;
    this.manifest = null;
    this.ready = false;
    this.available = false;      // true once a manifest with lines is loaded
    this._buffers = new Map();   // hash → decoded AudioBuffer
    this._order = [];            // hash insertion order, for LRU trimming
    this._src = null;            // currently playing BufferSource
    this._playing = null;        // hash of the current line
    this._fetching = new Map();  // hash → in-flight promise

    this.load();
  }

  /** Fetch the manifest once at boot. Missing file is a normal, quiet outcome. */
  async load() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const m = await res.json();
      if (!m || typeof m !== 'object' || !m.lines) throw new Error('malformed manifest');
      this.manifest = m;
      this.available = Object.keys(m.lines).length > 0;
      if (this.available) {
        console.info(`[voice] ${Object.keys(m.lines).length} lines available`);
      }
    } catch (e) {
      // No voice pack installed — the game is fully playable without one.
      this.manifest = null;
      this.available = false;
    }
    this.ready = true;
  }

  /** Manifest entry for a line, or null if it was never generated. */
  entryFor(speaker, text) {
    if (!this.manifest) return null;
    return this.manifest.lines[lineHash(speaker, text)] || null;
  }

  has(speaker, text) { return !!this.entryFor(speaker, text); }

  /**
   * Speak one line. Returns true if a clip was found and started (or is
   * loading), false if this line has no audio and the caller should fall back
   * to the typewriter blips.
   */
  play(speaker, text) {
    if (!this.available) return false;
    const hash = lineHash(speaker, text);
    const entry = this.manifest.lines[hash];
    if (!entry) return false;

    const audio = this.game.audio;
    if (!audio || !audio.ctx || audio.ctx.state !== 'running') return false;

    this.stop();
    this._playing = hash;

    const buf = this._buffers.get(hash);
    if (buf) { this._start(hash, buf); return true; }

    this._fetch(hash, entry).then((decoded) => {
      // A newer line may have started while this one was downloading.
      if (decoded && this._playing === hash) this._start(hash, decoded);
    });
    return true;
  }

  /** Stop whatever is speaking and let the music swell back. */
  stop() {
    this._playing = null;
    if (this._src) {
      try { this._src.onended = null; this._src.stop(); } catch (e) { /* already ended */ }
      this._src = null;
    }
    this.game.audio?.setVoiceDucking?.(false);
  }

  /** True while a clip is actually sounding. */
  get speaking() { return !!this._src; }

  // -------------------------------------------------------------------------
  _start(hash, buffer) {
    const audio = this.game.audio;
    const ctx = audio && audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(audio.voiceBus || audio.master);
    src.onended = () => {
      if (this._src === src) {
        this._src = null;
        this._playing = null;
        audio.setVoiceDucking?.(false);
      }
    };
    try { src.start(); } catch (e) { return; }
    this._src = src;
    audio.setVoiceDucking?.(true);
  }

  async _fetch(hash, entry) {
    if (this._fetching.has(hash)) return this._fetching.get(hash);
    const p = (async () => {
      try {
        const res = await fetch(BASE_URL + entry.file);
        if (!res.ok) throw new Error(`clip ${res.status}`);
        const bytes = await res.arrayBuffer();
        const ctx = this.game.audio && this.game.audio.ctx;
        if (!ctx) return null;
        const decoded = await ctx.decodeAudioData(bytes);
        this._cache(hash, decoded);
        return decoded;
      } catch (e) {
        console.warn('[voice] could not load', entry.file, e.message);
        return null;
      } finally {
        this._fetching.delete(hash);
      }
    })();
    this._fetching.set(hash, p);
    return p;
  }

  _cache(hash, buffer) {
    this._buffers.set(hash, buffer);
    this._order.push(hash);
    while (this._order.length > MAX_CACHED) {
      const old = this._order.shift();
      if (old !== this._playing) this._buffers.delete(old);
    }
  }
}
