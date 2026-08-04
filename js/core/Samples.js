// Optional generated audio: sound effects and mood music produced by
// tools/gen-sfx.mjs and tools/gen-music.mjs.
//
// Both packs are upgrades layered over the procedural engine, never
// replacements for it. If a pack is absent — or missing a particular effect or
// mood — AudioEngine synthesizes that sound exactly as it always has. Nothing
// here is required for the game to sound complete.

const SFX_MANIFEST = 'assets/sfx/manifest.json';
const SFX_BASE = 'assets/sfx/';
const MUSIC_MANIFEST = 'assets/music/manifest.json';
const MUSIC_BASE = 'assets/music/';

// ---------------------------------------------------------------------------
// Sound effects: small, decoded up front, fired as buffer sources.
// ---------------------------------------------------------------------------
export class SfxPack {
  constructor(game) {
    this.game = game;
    this.manifest = null;
    this.available = false;
    this._buffers = new Map();
    this._loading = new Map();
    this.load();
  }

  async load() {
    try {
      const res = await fetch(SFX_MANIFEST, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const m = await res.json();
      if (!m || !m.sounds || !Object.keys(m.sounds).length) throw new Error('empty');
      this.manifest = m;
      this._ver = String(m.generated || '').replace(/[^0-9a-zA-Z]/g, '').slice(-14) || '1';
      this.available = true;
      console.info(`[sfx] ${Object.keys(m.sounds).length} generated effects available`);
    } catch (e) {
      this.manifest = null;
      this.available = false;
    }
  }

  has(name) { return !!(this.manifest && this.manifest.sounds[name]); }

  /**
   * Play a generated effect. Returns false if there isn't one, so the caller
   * can fall back to synthesis.
   */
  play(name, { gain = 1, rate = 1, dest } = {}) {
    if (!this.available) return false;
    const entry = this.manifest.sounds[name];
    if (!entry) return false;
    const audio = this.game.audio;
    const ctx = audio && audio.ctx;
    if (!ctx || ctx.state !== 'running') return false;

    const buf = this._buffers.get(name);
    if (!buf) { this._fetch(name, entry, ctx); return false; } // synth this once
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(dest || audio.sfxBus || audio.master);
      src.start();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Decode ahead of time so the first trigger isn't the one that misses. */
  warm(names) {
    if (!this.available) return;
    const ctx = this.game.audio && this.game.audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    for (const n of names || Object.keys(this.manifest.sounds)) {
      const e = this.manifest.sounds[n];
      if (e && !this._buffers.has(n)) this._fetch(n, e, ctx);
    }
  }

  async _fetch(name, entry, ctx) {
    if (this._loading.has(name)) return this._loading.get(name);
    const p = (async () => {
      try {
        const res = await fetch(`${SFX_BASE}${entry.file}?v=${this._ver}`);
        if (!res.ok) throw new Error(String(res.status));
        const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
        this._buffers.set(name, decoded);
      } catch (e) {
        console.warn('[sfx] could not load', entry.file, e.message);
      } finally {
        this._loading.delete(name);
      }
    })();
    this._loading.set(name, p);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Music: streamed through media elements (tracks are far too big to decode
// into memory) and crossfaded on mood changes.
// ---------------------------------------------------------------------------
const FADE = 1.8;

// Generated tracks arrive at commercial loudness — measured ~14x hotter than
// the procedural score they replace, and level with the voice clips, which
// buried dialogue completely. This trim seats them a little above where the
// synthesized score sat. A track may override it with a `gain` in the manifest.
const MUSIC_TRIM = 0.15;

export class MusicPack {
  constructor(game) {
    this.game = game;
    this.manifest = null;
    this.available = false;
    this.current = null;      // mood name currently playing
    this._players = new Map();  // mood → {el, node, gain}
    this._enabled = true;
    this.load();
  }

  async load() {
    try {
      const res = await fetch(MUSIC_MANIFEST, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const m = await res.json();
      if (!m || !m.tracks || !Object.keys(m.tracks).length) throw new Error('empty');
      this.manifest = m;
      this._ver = String(m.generated || '').replace(/[^0-9a-zA-Z]/g, '').slice(-14) || '1';
      this.available = true;
      console.info(`[music] ${Object.keys(m.tracks).length} generated tracks available`);
    } catch (e) {
      this.manifest = null;
      this.available = false;
    }
  }

  has(mood) { return !!(this.manifest && this.manifest.tracks[mood]); }

  /**
   * Crossfade to a mood's track. Returns false when there's no track for it,
   * so the procedural sequencer stays in charge.
   */
  setMood(mood) {
    if (!this.available || !this._enabled) return false;
    if (!this.has(mood)) return false;
    const audio = this.game.audio;
    const ctx = audio && audio.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    if (this.current === mood) return true;

    const now = ctx.currentTime;
    for (const [name, pl] of this._players) {
      if (name !== mood) {
        pl.gain.gain.cancelScheduledValues(now);
        pl.gain.gain.setValueAtTime(pl.gain.gain.value, now);
        pl.gain.gain.linearRampToValueAtTime(0, now + FADE);
      }
    }

    const pl = this._player(mood, ctx, audio);
    if (!pl) return false;
    pl.el.play().catch(() => {});
    pl.gain.gain.cancelScheduledValues(now);
    pl.gain.gain.setValueAtTime(pl.gain.gain.value, now);
    pl.gain.gain.linearRampToValueAtTime(pl.trim, now + FADE);
    this.current = mood;
    return true;
  }

  /** Silence generated music (used when the pack can't cover a mood). */
  fadeOutAll() {
    const ctx = this.game.audio && this.game.audio.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const pl of this._players.values()) {
      pl.gain.gain.cancelScheduledValues(now);
      pl.gain.gain.setValueAtTime(pl.gain.gain.value, now);
      pl.gain.gain.linearRampToValueAtTime(0, now + FADE);
    }
    this.current = null;
  }

  _player(mood, ctx, audio) {
    let pl = this._players.get(mood);
    if (pl) return pl;
    const entry = this.manifest.tracks[mood];
    if (!entry) return null;
    try {
      const el = new Audio(`${MUSIC_BASE}${entry.file}?v=${this._ver}`);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      const node = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      // Through _musicDuck, not straight to the bus: that node is what dips
      // the score under dialogue, and bypassing it was why voices were buried.
      gain.connect(audio._musicDuck || audio.musicBus || audio.master);
      const trim = typeof entry.gain === 'number' ? entry.gain : MUSIC_TRIM;
      pl = { el, node, gain, trim };
      this._players.set(mood, pl);
      return pl;
    } catch (e) {
      console.warn('[music] could not start', mood, e.message);
      return null;
    }
  }
}
