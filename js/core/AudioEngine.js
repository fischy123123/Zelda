// AudioEngine — 100% procedural WebAudio: synthesized SFX driven by the event
// bus, a generative-but-composed layered score (one leitmotif reused across
// moods), and a context-aware ambience bed (birds, crickets, wind, lake,
// dungeon rumble). No samples, no fetches. The AudioContext is created lazily
// in resume(), which Game wires to the first user gesture — until then this
// module is completely silent and inert.

import { SITES, LAKE } from '../world/layout.js';
import { SfxPack, MusicPack } from './Samples.js';

// ---------------------------------------------------------------------------
// Pattern helpers. Sequences are authored on an eighth-note grid:
// seq(len, [[step, semi|chordArray, durSteps], ...]) — semitones relative to
// the layer's base frequency (A). drums(len, {k:[steps], ...}) for percussion.
// ---------------------------------------------------------------------------
function seq(len, notes) {
  const map = new Array(len).fill(null);
  for (const n of notes) {
    const step = n[0];
    if (step < 0 || step >= len) continue;
    if (!map[step]) map[step] = [];
    map[step].push({ semi: n[1], dur: n[2] || 1 });
  }
  return { len, map };
}

function drums(len, spec) {
  const map = new Array(len).fill(null);
  for (const type of Object.keys(spec)) {
    for (const s of spec[type]) {
      if (s < 0 || s >= len) continue;
      if (!map[s]) map[s] = [];
      map[s].push(type);
    }
  }
  return { len, map };
}

const semiF = (base, semi) => base * Math.pow(2, semi / 12);

// ---------------------------------------------------------------------------
// The score. Key of A. Major pentatonic (0 2 4 7 9) for warm moods, minor
// pentatonic (0 3 5 7 10) for tense ones. The core leitmotif —
// A C# E F# | A' F# E C# (rise and fall) — appears in every mood: stated
// proudly in the title theme, fragmented in explore, lilted as a waltz in the
// village, shifted minor for combat/boss, rung as lone bells in the dungeon.
// ---------------------------------------------------------------------------
const MOTIF = [[0, 0, 2], [2, 4, 2], [4, 7, 2], [6, 9, 2], [8, 12, 3], [11, 9, 1], [12, 7, 2], [14, 4, 2]];
const ANSWER = [[0, 7, 2], [2, 9, 2], [4, 7, 2], [6, 4, 2], [8, 2, 3], [11, 4, 1], [12, 0, 4]];

function shift(notes, stepOff, semiOff = 0) {
  return notes.map((n) => [n[0] + stepOff, Array.isArray(n[1]) ? n[1].map((s) => s + semiOff) : n[1] + semiOff, n[2]]);
}

const MOODS = {
  // Slow, noble statement of the theme: lead + warm pad + soft bass.
  title: {
    bpm: 72,
    layers: [
      { instr: 'lead', base: 440, gain: 0.15, verb: 0.45, pattern: seq(64, [
        ...MOTIF, ...shift(ANSWER, 16),
        [32, 12, 2], [34, 14, 2], [36, 16, 2], [38, 14, 2], [40, 12, 3], [43, 9, 1], [44, 7, 2], [46, 9, 2],
        [48, 7, 2], [50, 9, 2], [52, 12, 2], [54, 9, 2], [56, 4, 2], [58, 2, 2], [60, 0, 4],
      ]) },
      { instr: 'pad', base: 220, gain: 0.045, verb: 0.3, pattern: seq(64, [
        [0, [0, 4, 7], 16], [16, [-3, 0, 4], 16], [32, [5, 9, 12], 16], [48, [7, 11, 14], 8], [56, [0, 4, 7], 8],
      ]) },
      { instr: 'bass', base: 55, gain: 0.2, pattern: seq(64, [
        [0, 0, 8], [8, 0, 8], [16, -3, 8], [24, -3, 8], [32, 5, 8], [40, 5, 8], [48, 7, 8], [56, 0, 8],
      ]) },
      { instr: 'sparkle', base: 880, gain: 0.045, verb: 0.7, pattern: seq(64, [
        [12, 24], [28, 19], [44, 24], [60, 28],
      ]) },
    ],
  },

  // Sparse, airy: long pads, the motif drifting in as occasional fragments.
  explore: {
    bpm: 76,
    layers: [
      { instr: 'pad', base: 220, gain: 0.04, verb: 0.35, pattern: seq(64, [
        [0, [0, 4, 7], 24], [32, [5, 9, 12], 16], [48, [-3, 0, 4], 16],
      ]) },
      { instr: 'bass', base: 55, gain: 0.16, pattern: seq(64, [
        [0, 0, 12], [16, 0, 6], [32, 5, 10], [48, -3, 10],
      ]) },
      { instr: 'lead', base: 440, gain: 0.075, verb: 0.55, pattern: seq(64, [
        [16, 4, 2], [18, 7, 2], [20, 9, 2], [22, 12, 4],
        [48, 7, 2], [50, 9, 2], [52, 7, 2], [54, 4, 3], [58, 0, 5],
      ]) },
      { instr: 'sparkle', base: 880, gain: 0.035, verb: 0.7, pattern: seq(64, [
        [4, 24], [36, 19], [58, 21],
      ]) },
    ],
  },

  // Cozy 3/4 waltz: plucked chords on beats 2 & 3, the motif lilting on top.
  village: {
    bpm: 112,
    layers: [
      { instr: 'bass', base: 55, gain: 0.19, pattern: seq(48, [
        [0, 0, 2], [6, 5, 2], [12, 0, 2], [18, 7, 2], [24, 0, 2], [30, -3, 2], [36, 7, 2], [42, 0, 2],
      ]) },
      { instr: 'pluck', base: 220, gain: 0.085, verb: 0.3, pattern: seq(48, [
        [2, [4, 7]], [4, [7, 12]], [8, [9, 12]], [10, [12, 17]],
        [14, [4, 7]], [16, [7, 12]], [20, [11, 14]], [22, [14, 19]],
        [26, [4, 7]], [28, [7, 12]], [32, [0, 4]], [34, [4, 9]],
        [38, [11, 14]], [40, [14, 19]], [44, [4, 7]], [46, [7, 12]],
      ]) },
      { instr: 'pluck', base: 440, gain: 0.1, verb: 0.35, pattern: seq(48, [
        [0, 4, 2], [2, 7, 2], [4, 9, 2], [6, 12, 4], [10, 9, 2],
        [12, 7, 2], [14, 9, 2], [16, 7, 2], [18, 4, 4],
        [24, 2, 2], [26, 4, 2], [28, 7, 2], [30, 9, 4], [34, 7, 2],
        [36, 4, 2], [38, 2, 2], [40, 4, 2], [42, 0, 6],
      ]) },
    ],
  },

  // Thin pad + music-box sparkle over minor colors (crickets live in ambience).
  night: {
    bpm: 60,
    layers: [
      { instr: 'pad', base: 220, gain: 0.032, verb: 0.4, pattern: seq(64, [
        [0, [0, 3, 7], 16], [16, [-4, 0, 3], 16], [32, [3, 7, 10], 16], [48, [-2, 2, 5], 16],
      ]) },
      { instr: 'bass', base: 55, gain: 0.11, pattern: seq(64, [
        [0, 0, 16], [16, -4, 16], [32, 3, 16], [48, -2, 16],
      ]) },
      { instr: 'sparkle', base: 880, gain: 0.055, verb: 0.75, pattern: seq(64, [
        [0, 12], [6, 15], [16, 19], [22, 12], [30, 17], [38, 15], [44, 22], [54, 19],
      ]) },
    ],
  },

  // Driving percussion + ostinato bass, the motif shifted minor and urgent.
  combat: {
    bpm: 132,
    layers: [
      { instr: 'bass', base: 55, gain: 0.21, pattern: seq(8, [
        [0, 0], [1, 0], [2, 7], [3, 0], [4, 10], [5, 0], [6, 7], [7, 5],
      ]) },
      { instr: 'lead', base: 440, gain: 0.11, verb: 0.3, pattern: seq(32, [
        [0, 0, 2], [2, 3, 2], [4, 7, 2], [6, 10, 2], [8, 12, 3], [11, 10, 1], [12, 7, 2], [14, 3, 2],
        [16, 0, 2], [18, 3, 2], [20, 5, 2], [22, 7, 2], [24, 5, 3], [27, 3, 1], [28, 0, 4],
      ]) },
    ],
    perc: { gain: 0.5, pattern: drums(32, {
      k: [0, 4, 8, 12, 16, 20, 24, 28],
      s: [6, 14, 22, 30],
      h: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31],
      t: [27, 29, 31],
    }) },
  },

  // Low drones, lone echoing bells (the motif, one note at a time), heartbeat.
  dungeon: {
    bpm: 66,
    layers: [
      { instr: 'drone', base: 110, gain: 0.05, verb: 0.4, pattern: seq(64, [
        [0, [0, 7], 32], [32, [-2, 5], 32],
      ]) },
      { instr: 'bass', base: 55, gain: 0.13, pattern: seq(64, [
        [0, 0, 32], [32, -2, 32],
      ]) },
      { instr: 'bell', base: 440, gain: 0.075, verb: 0.85, pattern: seq(64, [
        [0, 12], [20, 15], [34, 19], [52, 10],
      ]) },
    ],
    perc: { gain: 0.34, pattern: drums(8, { T: [0, 3] }) },
  },

  // Intense: dissonant ostinato (minor + b5), pounding drums, high lead.
  boss: {
    bpm: 140,
    layers: [
      { instr: 'bass', base: 55, gain: 0.22, pattern: seq(8, [
        [0, 0], [1, 0], [2, 3], [3, 5], [4, 6], [5, 5], [6, 3], [7, 0],
      ]) },
      { instr: 'lead', base: 880, gain: 0.095, verb: 0.35, pattern: seq(32, [
        [0, 0, 1], [2, 3, 1], [4, 5, 2], [8, 3, 1], [10, 0, 1], [12, -2, 2],
        [16, 0, 1], [18, 3, 1], [20, 7, 2], [24, 6, 2], [26, 5, 1], [28, 3, 1], [30, 0, 2],
      ]) },
      { instr: 'bell', base: 220, gain: 0.05, verb: 0.6, pattern: seq(32, [[8, 6], [24, 1]]) },
    ],
    perc: { gain: 0.55, pattern: drums(32, {
      k: [0, 3, 6, 8, 11, 14, 16, 19, 22, 24, 27, 30],
      s: [4, 12, 20, 28],
      h: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
      t: [29, 30, 31],
    }) },
  },

  // Triumphant cadence sting, then calm — the mood times out back to context.
  victory: {
    bpm: 100,
    layers: [
      { instr: 'lead', base: 440, gain: 0.15, verb: 0.5, pattern: seq(64, [
        [0, 7, 1], [2, 7, 1], [4, 7, 1], [6, 12, 6],
        [16, 9, 2], [18, 12, 2], [20, 14, 2], [22, 16, 8],
        [40, 12, 4], [48, 9, 4], [56, 7, 8],
      ]) },
      { instr: 'pad', base: 220, gain: 0.05, verb: 0.35, pattern: seq(64, [
        [0, [0, 4, 7], 16], [16, [5, 9, 12], 8], [24, [7, 11, 14], 8], [32, [0, 4, 7], 32],
      ]) },
      { instr: 'bass', base: 55, gain: 0.2, pattern: seq(64, [
        [0, 0, 8], [8, 5, 4], [12, 7, 4], [16, 0, 16], [32, 0, 32],
      ]) },
    ],
    perc: { gain: 0.5, pattern: drums(64, { k: [0, 2, 4, 6], c: [6] }) },
  },
};

const MOOD_FADE = 2.0;          // seconds of crossfade between moods
const LOOKAHEAD = 0.12;         // scheduler lookahead window (s)
const STORE_KEY = 'aurelia-audio';

// ~50ms of silence. Played through an <audio> element on the first gesture
// so iOS treats this page as media playback (see resume()).
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

// ---------------------------------------------------------------------------
export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this._low = game.quality === 'low';
    this._maxVoices = this._low ? 40 : 64;
    this._nVoices = 0;

    this._vol = { master: 0.9, music: 0.8, sfx: 0.9, voice: 1 };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) {
        for (const k of ['master', 'music', 'sfx', 'voice']) {
          if (typeof saved[k] === 'number') this._vol[k] = Math.min(1, Math.max(0, saved[k]));
        }
      }
    } catch (e) { /* private mode etc. — defaults are fine */ }

    // Music/mood state.
    this._mood = null;
    this._moodOverride = null;
    this._moodGains = {};
    this._pattern = null;
    this._stepDur = 0.2;
    this._step = 0;
    this._nextStep = 0;
    this._moodPoll = 0;
    this._duck = 1;
    this._voiceDucking = false;

    // Optional generated audio. Absent packs simply never take over.
    this.sfxPack = new SfxPack(game);
    this.musicPack = new MusicPack(game);
    this._warmed = false;

    // Context flags fed by events.
    this._bossActive = false;
    this._victoryTimer = 0;
    this._combatTimer = 0;
    this._aggroed = new WeakSet();
    this._gemCombo = 0;
    this._gemComboT = 0;

    // Ambience state.
    this._birdTimer = 3;
    this._biomePoll = 0;
    this._biomeId = 'meadow';
    this._lastSfx = Object.create(null);

    this._wireEvents();
  }

  // -- public API ------------------------------------------------------------
  /**
   * Bring audio to life. Safe to call repeatedly — Game retries on every
   * gesture until the context is genuinely running, because a single tap is
   * not reliable on mobile.
   *
   * iOS Safari needs three things beyond a plain resume():
   *  1. An audio session of type "playback", or WebAudio is silenced by the
   *     physical ring/silent switch — the usual reason an iPhone plays
   *     nothing at all while everything looks fine in code.
   *  2. A media element played once inside a real gesture, which promotes the
   *     session on versions predating navigator.audioSession.
   *  3. A buffer actually started on the context to finish unlocking it.
   */
  resume() {
    this._claimPlaybackSession();
    if (!this.ctx) this._build();
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this._primeMediaElement();
    this._kick();
  }

  /** True once sound can actually be heard. */
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Tell iOS this page is media playback, not an incidental UI beep. */
  _claimPlaybackSession() {
    try {
      const sess = navigator.audioSession;
      if (sess && sess.type !== 'playback') sess.type = 'playback';
    } catch (e) { /* not supported — the media-element path below covers it */ }
  }

  /**
   * Play a fragment of silence through an <audio> element. Media elements use
   * the playback audio category on iOS, which drags WebAudio out from under
   * the mute switch on versions without navigator.audioSession.
   */
  _primeMediaElement() {
    if (this._primed) return;
    try {
      if (!this._silentEl) {
        const el = new Audio(SILENT_WAV);
        el.setAttribute('playsinline', '');
        el.preload = 'auto';
        el.loop = false;
        el.volume = 0.001;
        this._silentEl = el;
      }
      const p = this._silentEl.play();
      if (p && p.then) p.then(() => { this._primed = true; }).catch(() => {});
      else this._primed = true;
    } catch (e) { /* blocked until a real gesture; we retry on the next one */ }
  }

  /** Start a one-sample silent buffer — the classic iOS WebAudio unlock. */
  _kick() {
    if (this._kicked || !this.ctx) return;
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
      this._kicked = true;
    } catch (e) { /* retry next gesture */ }
  }

  /** Snapshot for debugging mobile audio: window.game.audio.diagnostics(). */
  diagnostics() {
    return {
      contextState: this.ctx ? this.ctx.state : 'not-created',
      sampleRate: this.ctx ? this.ctx.sampleRate : null,
      audioSession: (() => {
        try { return navigator.audioSession ? navigator.audioSession.type : 'unsupported'; }
        catch (e) { return 'error'; }
      })(),
      mediaElementPrimed: !!this._primed,
      contextKicked: !!this._kicked,
      volumes: this.volumes,
      masterGain: this.master ? this.master.gain.value : null,
      hint: this.running
        ? 'Audio is running. If you still hear nothing, check the iPhone ring/silent switch and the volume rocker.'
        : 'Audio is not running yet — tap the screen once.',
    };
  }

  get volumes() {
    const v = this._vol;
    return { master: v.master, music: v.music, sfx: v.sfx, voice: v.voice };
  }

  setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx', 'voice']) {
      if (typeof v[k] === 'number') this._vol[k] = Math.min(1, Math.max(0, v[k]));
    }
    this._applyVolumes();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this._vol)); } catch (e) { /* ignore */ }
  }

  /** Force a mood ('title'|'explore'|...) or pass null to resume auto-pick. */
  setMood(m) {
    this._moodOverride = (m && MOODS[m]) ? m : null;
    if (this.ctx) this._applyMood(this._pickMood());
  }

  update(rawDt) {
    if (!this.ctx || this.ctx.state !== 'running') return;

    this._victoryTimer = Math.max(0, this._victoryTimer - rawDt);
    this._combatTimer = Math.max(0, this._combatTimer - rawDt);
    this._gemComboT = Math.max(0, this._gemComboT - rawDt);
    if (this._gemComboT === 0) this._gemCombo = 0;

    this._moodPoll -= rawDt;
    if (this._moodPoll <= 0) {
      this._moodPoll = 0.25;
      this._scanCombat();
      this._applyMood(this._pickMood());
      // The title mood is applied before the first user gesture, while the
      // context is still suspended and setMood() must decline — and once
      // _mood is set, _applyMood never revisits it. Catch that here so a
      // generated track still takes over the moment audio comes alive.
      if (this._mood && this._pattern && this.musicPack.has(this._mood)) {
        this._handOffToTrack(this._mood, this.ctx.currentTime);
      }
    }

    // Duck the score when the hero falls, and again under voiced dialogue
    // so speech stays intelligible over the music.
    const duckT = this.game.mode === 'dead' ? 0.12 : (this._voiceDucking ? 0.28 : 1);
    // Asymmetric, like a real ducker: get out of the way almost immediately
    // when a line starts, then ease back so the music does not lurch. A single
    // slow rate meant the first second or two of every line stayed buried.
    const duckRate = duckT < this._duck ? 9 : 1.6;
    this._duck += (duckT - this._duck) * Math.min(1, rawDt * duckRate);
    this._musicDuck.gain.value = this._duck;

    if (!this._warmed && this.sfxPack.available) {
      this._warmed = true;
      this.sfxPack.warm();
    }

    this._tickSequencer();
    this._updateAmbience(rawDt);
  }

  /** Pull the music down while a voice clip is speaking (see Voice.js). */
  setVoiceDucking(on) { this._voiceDucking = !!on; }

  /** Play a named sound effect immediately. opts vary by name (see defs). */
  sfx(name, opts) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap = name === 'step' ? 0.1 : 0.045;
    const last = this._lastSfx[name];
    if (last !== undefined && now - last < minGap) return;
    this._lastSfx[name] = now;
    // A generated effect wins when one exists and is decoded; otherwise the
    // procedural voice plays, so coverage gaps are inaudible.
    if (this.sfxPack.play(name, { gain: (opts && opts.gain) || 1 })) return;
    this._playSfx(name, now + 0.002, opts || {});
  }

  // -- graph construction ----------------------------------------------------
  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
    const ctx = this.ctx;

    // Master -> gentle glue compressor -> speakers.
    this.master = ctx.createGain();
    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -16;
    this._comp.knee.value = 18;
    this._comp.ratio.value = 5;
    this._comp.attack.value = 0.004;
    this._comp.release.value = 0.24;
    this.master.connect(this._comp);
    this._comp.connect(ctx.destination);

    // Buses.
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this._musicDuck = ctx.createGain();
    this._musicDuck.connect(this.musicBus);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.9;
    this.ambBus.connect(this.master);
    // Voiced dialogue (see js/core/Voice.js) gets its own bus so players
    // can turn speech down without muting the score.
    this.voiceBus = ctx.createGain();
    this.voiceBus.connect(this.master);
    this._applyVolumes();

    // Shared white-noise buffer for every burst/loop.
    const len = Math.floor(ctx.sampleRate * 1.5);
    this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._buildReverb();
    this._buildAmbience();

    this._nextStep = ctx.currentTime + 0.1;
    this._applyMood(this._pickMood());
  }

  // Lush-ish cheap reverb: stacked feedback delays through a lowpass.
  _buildReverb() {
    const ctx = this.ctx;
    this.reverbIn = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    wet.connect(this.master);
    const times = this._low ? [0.211, 0.331] : [0.211, 0.287, 0.353];
    for (const dt of times) {
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = dt;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      this.reverbIn.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(wet);
    }
  }

  _loopNoise(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const lvl = ctx.createGain();
    lvl.gain.value = 0;
    src.connect(f);
    f.connect(lvl);
    lvl.connect(this.ambBus);
    src.start();
    return { filter: f, level: lvl };
  }

  _buildAmbience() {
    const ctx = this.ctx;

    // Wind — broad lowpassed noise; level rises with altitude.
    this._wind = this._loopNoise('lowpass', 420, 0.4).level;

    // Lake lapping — band of noise with a slow tremolo swell.
    {
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 320;
      bp.Q.value = 0.8;
      const trem = ctx.createGain();
      trem.gain.value = 0.55;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      lfo.connect(depth);
      depth.connect(trem.gain);
      const lvl = ctx.createGain();
      lvl.gain.value = 0;
      src.connect(bp); bp.connect(trem); trem.connect(lvl); lvl.connect(this.ambBus);
      src.start(); lfo.start();
      this._lake = lvl;
    }

    // Crickets — high square trill, AM chopped fast + gated slow.
    {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 4250;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 4250;
      bp.Q.value = 7;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const fast = ctx.createOscillator();
      fast.frequency.value = 26;
      const fd = ctx.createGain();
      fd.gain.value = 0.5;
      fast.connect(fd); fd.connect(chop.gain);
      const gate = ctx.createGain();
      gate.gain.value = 0.5;
      const slow = ctx.createOscillator();
      slow.frequency.value = 1.3;
      const sd = ctx.createGain();
      sd.gain.value = 0.5;
      slow.connect(sd); sd.connect(gate.gain);
      const lvl = ctx.createGain();
      lvl.gain.value = 0;
      osc.connect(bp); bp.connect(chop); chop.connect(gate); gate.connect(lvl); lvl.connect(this.ambBus);
      osc.start(); fast.start(); slow.start();
      this._crickets = lvl;
    }

    // Dungeon rumble — deep noise + sub sine.
    {
      const noise = this._loopNoise('lowpass', 85, 0.5);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 38;
      const sg = ctx.createGain();
      sg.gain.value = 0.4;
      sub.connect(sg);
      sg.connect(noise.level);
      sub.start();
      this._rumble = noise.level;
    }
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const v = this._vol;
    this.master.gain.value = v.master * v.master;
    this.musicBus.gain.value = v.music * v.music;
    this.sfxBus.gain.value = v.sfx * v.sfx;
    if (this.voiceBus) this.voiceBus.gain.value = v.voice * v.voice;
  }

  // -- mood selection --------------------------------------------------------
  _scanCombat() {
    const g = this.game;
    if (g.mode !== 'playing') return;
    const p = g.player.position;
    const enemies = g.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.removed || !this._aggroed.has(e)) continue;
      const ep = e.group ? e.group.position : null;
      if (!ep) continue;
      const dx = ep.x - p.x, dz = ep.z - p.z;
      if (dx * dx + dz * dz < 45 * 45) { this._combatTimer = Math.max(this._combatTimer, 1.6); break; }
    }
  }

  _pickMood() {
    if (this._moodOverride) return this._moodOverride;
    const g = this.game;
    if (g.mode === 'title') return 'title';
    if (this._bossActive) return 'boss';
    if (this._victoryTimer > 0) return 'victory';
    if (g.inDungeon) return 'dungeon';
    if (this._combatTimer > 0) return 'combat';
    const p = g.player.position;
    const dx = p.x - SITES.village.x, dz = p.z - SITES.village.z;
    if (dx * dx + dz * dz < SITES.village.r * SITES.village.r) return 'village';
    if (g.sky && g.sky.isNight) return 'night';
    return 'explore';
  }

  _moodGain(name) {
    let gn = this._moodGains[name];
    if (!gn) {
      gn = this.ctx.createGain();
      gn.gain.value = 0;
      gn.connect(this._musicDuck);
      this._moodGains[name] = gn;
    }
    return gn;
  }

  _applyMood(name) {
    if (name === this._mood || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Generated track for this mood? Then silence the sequencer entirely
    // rather than layering two scores on top of each other.
    if (this._handOffToTrack(name, now)) return;
    this.musicPack.fadeOutAll();
    if (this._mood) {
      const old = this._moodGain(this._mood);
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + MOOD_FADE);
    }
    const next = this._moodGain(name);
    next.gain.cancelScheduledValues(now);
    next.gain.setValueAtTime(next.gain.value, now);
    next.gain.linearRampToValueAtTime(1, now + MOOD_FADE);

    this._mood = name;
    this._pattern = MOODS[name];
    this._stepDur = 60 / this._pattern.bpm / 2; // eighth notes
    this._step = 0;
    this._nextStep = Math.max(this._nextStep, now + 0.06);
  }

  /**
   * Hand a mood over to its generated track, muting the sequencer. Returns
   * false when there is no track (or audio is not running yet), leaving the
   * procedural score in charge.
   */
  _handOffToTrack(name, now) {
    if (!this.musicPack.setMood(name)) return false;
    if (this._mood) {
      const old = this._moodGain(this._mood);
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + MOOD_FADE);
    }
    this._mood = name;
    this._pattern = null;
    return true;
  }

  // -- sequencer -------------------------------------------------------------
  _tickSequencer() {
    if (!this._pattern) return;   // a generated track is playing instead
    const now = this.ctx.currentTime;
    if (this._nextStep < now - 0.35) this._nextStep = now + 0.05; // resync after tab-sleep
    while (this._nextStep < now + LOOKAHEAD) {
      this._scheduleStep(this._nextStep, this._step);
      this._nextStep += this._stepDur;
      this._step++;
    }
  }

  _scheduleStep(t, step) {
    const pat = this._pattern;
    if (!pat) return;
    const dest = this._moodGain(this._mood);
    const layers = pat.layers;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      if (this._low && L.instr === 'sparkle') continue;
      const evs = L.pattern.map[step % L.pattern.len];
      if (!evs) continue;
      for (let j = 0; j < evs.length; j++) this._playNote(L, evs[j], t, dest);
    }
    if (pat.perc) {
      const hits = pat.perc.pattern.map[step % pat.perc.pattern.len];
      if (hits) {
        for (let j = 0; j < hits.length; j++) {
          if (this._low && hits[j] === 'h') continue;
          this._drum(hits[j], t, pat.perc.gain, dest);
        }
      }
    }
  }

  _playNote(L, ev, t, dest) {
    const dur = ev.dur * this._stepDur;
    const semi = ev.semi;
    if (Array.isArray(semi)) {
      for (let i = 0; i < semi.length; i++) this._instr(L, semiF(L.base, semi[i]), t, dur, dest);
    } else {
      this._instr(L, semiF(L.base, semi), t, dur, dest);
    }
  }

  _instr(L, f, t, dur, dest) {
    const g = L.gain, verb = L.verb || 0;
    switch (L.instr) {
      case 'lead':
        this._tone(t, dur + 0.12, { type: 'triangle', f0: f, gain: g, attack: 0.02, release: 0.12, dest, verb });
        if (!this._low) this._tone(t, dur + 0.1, { type: 'sine', f0: f * 0.5, gain: g * 0.35, attack: 0.02, release: 0.1, dest });
        break;
      case 'pluck':
        this._tone(t, Math.min(dur + 0.15, 0.6), { type: 'triangle', f0: f, gain: g, attack: 0.004, dest, verb });
        break;
      case 'pad':
        this._tone(t, dur, { type: 'sawtooth', f0: f, lp: 780, gain: g, attack: Math.min(1.1, dur * 0.3), release: Math.min(1.4, dur * 0.4), dest, verb, detune: 5 });
        if (!this._low) this._tone(t, dur, { type: 'sawtooth', f0: f, lp: 780, gain: g, attack: Math.min(1.1, dur * 0.3), release: Math.min(1.4, dur * 0.4), dest, detune: -6 });
        break;
      case 'drone':
        this._tone(t, dur, { type: 'sawtooth', f0: f, lp: 320, gain: g, attack: Math.min(1.6, dur * 0.35), release: Math.min(2, dur * 0.4), dest, verb });
        break;
      case 'bass':
        this._tone(t, dur, { type: 'sine', f0: f, gain: g, attack: 0.015, release: 0.12, dest });
        if (!this._low) this._tone(t, dur, { type: 'triangle', f0: f * 2, gain: g * 0.22, attack: 0.015, release: 0.12, dest });
        break;
      case 'bell':
        this._tone(t, 2.2, { type: 'sine', f0: f, gain: g, attack: 0.004, dest, verb });
        this._tone(t, 1.1, { type: 'sine', f0: f * 2.756, gain: g * 0.3, attack: 0.004, dest, verb: verb * 0.6 });
        break;
      case 'sparkle':
        this._tone(t, 0.55, { type: 'sine', f0: f, gain: g, attack: 0.002, dest, verb });
        break;
    }
  }

  _drum(type, t, g, dest) {
    switch (type) {
      case 'k':
        this._tone(t, 0.17, { type: 'sine', f0: 118, f1: 42, gain: g * 0.9, attack: 0.002, dest });
        this._burst(t, 0.02, { type: 'highpass', f0: 1500, gain: g * 0.12, attack: 0.001, dest });
        break;
      case 's':
        this._burst(t, 0.13, { type: 'bandpass', f0: 1900, q: 0.7, gain: g * 0.35, attack: 0.002, dest });
        this._tone(t, 0.09, { type: 'triangle', f0: 195, f1: 120, gain: g * 0.28, attack: 0.002, dest });
        break;
      case 'h':
        this._burst(t, 0.04, { type: 'highpass', f0: 6800, gain: g * 0.15, attack: 0.001, dest });
        break;
      case 't':
        this._tone(t, 0.22, { type: 'sine', f0: 150, f1: 74, gain: g * 0.55, attack: 0.003, dest });
        break;
      case 'T': // heartbeat tom
        this._tone(t, 0.26, { type: 'sine', f0: 92, f1: 46, gain: g * 0.75, attack: 0.004, dest });
        break;
      case 'c':
        this._burst(t, 0.9, { type: 'highpass', f0: 4200, gain: g * 0.22, attack: 0.002, dest, verb: 0.4 });
        break;
    }
  }

  // -- low-level voices ------------------------------------------------------
  _trackVoice(src) {
    this._nVoices++;
    const self = this;
    src.onended = function () { self._nVoices--; src.onended = null; };
  }

  /** Oscillator voice with pitch + amp envelope. Returns the gain node. */
  _tone(t, dur, o) {
    if (this._nVoices >= this._maxVoices || dur <= 0) return null;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const f0 = Math.max(1, o.f0 || 440);
    osc.frequency.setValueAtTime(f0, t);
    if (o.f1 && o.f1 !== f0) {
      if (o.slide === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(1, o.f1), t + (o.fTime || dur));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.fTime || dur));
    }
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    const peak = o.gain != null ? o.gain : 0.15;
    const atk = Math.min(o.attack != null ? o.attack : 0.005, dur * 0.5);
    const rel = o.release || 0;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    if (rel > 0 && dur > atk + rel) {
      g.gain.setValueAtTime(peak, t + dur - rel);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
    node.connect(g);
    g.connect(o.dest || this.sfxBus);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      g.connect(s);
      s.connect(this.reverbIn);
    }
    osc.start(t);
    osc.stop(t + dur + 0.06);
    this._trackVoice(osc);
    return g;
  }

  /** Filtered white-noise burst with sweep + amp envelope. */
  _burst(t, dur, o) {
    if (this._nVoices >= this._maxVoices || dur <= 0) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    let node = src;
    if (o.type !== 'none') {
      const f = ctx.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.Q.value = o.q != null ? o.q : 0.9;
      const f0 = Math.max(20, o.f0 || 800);
      f.frequency.setValueAtTime(f0, t);
      if (o.f1 && o.f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.fTime || dur));
      src.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    const peak = o.gain != null ? o.gain : 0.15;
    const atk = Math.min(o.attack != null ? o.attack : 0.004, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(o.dest || this.sfxBus);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      g.connect(s);
      s.connect(this.reverbIn);
    }
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.05);
    this._trackVoice(src);
    return g;
  }

  /** Quick arpeggio of soft blips: semis relative to base, spaced `gap` s. */
  _arp(t, base, semis, gap, o = {}) {
    for (let i = 0; i < semis.length; i++) {
      const last = i === semis.length - 1;
      this._tone(t + i * gap, last ? (o.lastDur || 0.35) : (o.dur || 0.12), {
        type: o.type || 'sine',
        f0: semiF(base, semis[i]),
        gain: (o.gain || 0.1) * (last ? 1.15 : 1),
        attack: 0.003,
        verb: o.verb != null ? o.verb : 0.5,
      });
    }
  }

  // Footstep: a soft filtered tap, voiced per biome (thud on grass, crunch on
  // sand, knock on rock). Named _stepSfx — this._step is the sequencer counter.
  _stepSfx(t, o = {}) {
    const b = o.biome || 'grass';
    const m = o.sprint ? 1.35 : 1;
    if (b === 'beach' || b === 'badland') {
      this._burst(t, 0.07, { type: 'bandpass', f0: 2400, f1: 900, q: 0.8, gain: 0.05 * m, attack: 0.002 });
    } else if (b === 'rock' || b === 'cliff' || b === 'dungeon') {
      this._burst(t, 0.05, { type: 'lowpass', f0: 900, gain: 0.06 * m, attack: 0.001 });
      this._tone(t, 0.04, { type: 'sine', f0: 190, f1: 120, gain: 0.05 * m });
    } else {
      this._burst(t, 0.06, { type: 'lowpass', f0: 520, gain: 0.055 * m, attack: 0.003 });
    }
  }

  // -- SFX definitions -------------------------------------------------------
  _playSfx(name, t, o) {
    switch (name) {
      case 'sword1': case 'sword2': case 'sword3': {
        const p = [1, 1.16, 1.33][name === 'sword1' ? 0 : name === 'sword2' ? 1 : 2];
        this._burst(t, 0.17, { type: 'bandpass', f0: 850 * p, f1: 2500 * p, q: 1.2, gain: 0.2, attack: 0.014 });
        this._burst(t + 0.015, 0.1, { type: 'highpass', f0: 3200, gain: 0.045, attack: 0.008 });
        break;
      }
      case 'spin':
        this._burst(t, 0.24, { type: 'bandpass', f0: 600, f1: 2600, q: 1.1, gain: 0.22, attack: 0.02 });
        this._burst(t + 0.2, 0.28, { type: 'bandpass', f0: 2600, f1: 700, q: 1.1, gain: 0.2, attack: 0.01 });
        this._tone(t, 0.45, { type: 'sine', f0: 220, f1: 460, gain: 0.05 });
        break;
      case 'hit':
        this._tone(t, 0.08, { type: 'square', f0: 2100, f1: 1650, gain: 0.1 });
        this._tone(t, 0.06, { type: 'square', f0: 3250, gain: 0.05 });
        this._tone(t, 0.15, { type: 'sine', f0: 175, f1: 58, gain: 0.38 });
        this._burst(t, 0.07, { type: 'highpass', f0: 2600, gain: 0.1 });
        break;
      case 'crit':
        this._tone(t, 0.1, { type: 'square', f0: 2400, f1: 1900, gain: 0.12 });
        this._tone(t, 0.12, { type: 'square', f0: 4150, f1: 3600, gain: 0.06, verb: 0.4 });
        this._tone(t, 0.2, { type: 'sine', f0: 210, f1: 52, gain: 0.5 });
        this._burst(t, 0.16, { type: 'highpass', f0: 2200, gain: 0.16, verb: 0.3 });
        break;
      case 'block':
        this._tone(t, 0.06, { type: 'square', f0: 2800, gain: 0.09 });
        this._tone(t, 0.12, { type: 'sine', f0: 4200, f1: 3900, gain: 0.07, verb: 0.35 });
        this._burst(t, 0.05, { type: 'highpass', f0: 4000, gain: 0.06 });
        this._tone(t, 0.09, { type: 'sine', f0: 150, f1: 90, gain: 0.16 });
        break;
      case 'enemy_hit':
        this._burst(t, 0.12, { type: 'lowpass', f0: 620, f1: 240, gain: 0.24 });
        this._tone(t, 0.12, { type: 'sine', f0: 185, f1: 78, gain: 0.26 });
        break;
      case 'enemy_die':
        this._burst(t, 0.2, { type: 'lowpass', f0: 500, f1: 150, gain: 0.24 });
        this._tone(t, 0.34, { type: 'square', f0: 330, f1: 82, gain: 0.1 });
        this._tone(t + 0.04, 0.3, { type: 'sine', f0: 110, f1: 48, gain: 0.3 });
        break;
      case 'hurt':
        this._tone(t, 0.24, { type: 'sine', f0: 135, f1: 52, gain: 0.5 });
        this._burst(t, 0.1, { type: 'lowpass', f0: 700, gain: 0.16 });
        this._tone(t + 0.22, 0.15, { type: 'sine', f0: 88, f1: 50, gain: 0.3 }); // heartbeat accent
        break;
      case 'heal':
        this._arp(t, 880, [0, 4, 7, 12], 0.07, { gain: 0.09, verb: 0.55 });
        break;
      case 'pickup':
        this._tone(t, 0.06, { type: 'triangle', f0: 660, gain: 0.09 });
        this._tone(t + 0.06, 0.14, { type: 'triangle', f0: 990, gain: 0.1, verb: 0.3 });
        break;
      case 'gem': {
        const up = Math.pow(2, Math.min(this._gemCombo, 10) / 12);
        this._tone(t, 0.05, { type: 'triangle', f0: 1318 * up, gain: 0.1 });
        this._tone(t + 0.05, 0.2, { type: 'triangle', f0: 1760 * up, gain: 0.12, verb: 0.45 });
        break;
      }
      case 'heart':
        this._tone(t, 0.08, { type: 'sine', f0: 660, gain: 0.11 });
        this._tone(t + 0.08, 0.2, { type: 'sine', f0: 880, gain: 0.12, verb: 0.35 });
        break;
      case 'key':
        this._tone(t, 0.1, { type: 'triangle', f0: 988, gain: 0.1, verb: 0.4 });
        this._tone(t + 0.09, 0.3, { type: 'triangle', f0: 1480, gain: 0.1, verb: 0.55 });
        break;
      case 'chest':
        this._burst(t, 0.38, { type: 'lowpass', f0: 130, f1: 640, q: 2, gain: 0.15, rate: 0.55 }); // creak
        this._arp(t + 0.34, 660, [0, 4, 7], 0.09, { type: 'triangle', gain: 0.1, verb: 0.4 });
        break;
      case 'chest_big': // original "da-da-da-daaa!" fanfare on the leitmotif
        this._fanfare(t, 440, [[0, 0, 0.14], [0.16, 4, 0.14], [0.32, 7, 0.14], [0.48, 12, 0.95]]);
        break;
      case 'secret':
        this._fanfare(t, 523.25, [[0, 0, 0.12], [0.13, 5, 0.12], [0.26, 7, 0.12], [0.39, 12, 0.85]]);
        break;
      case 'step': this._stepSfx(t, o); break;
      case 'jump':
        this._burst(t, 0.17, { type: 'bandpass', f0: 480, f1: 1150, q: 1, gain: 0.08, attack: 0.02 });
        break;
      case 'land': {
        const m = o.hard ? 1.7 : 1;
        this._burst(t, 0.1, { type: 'lowpass', f0: 340, gain: 0.15 * m });
        this._tone(t, 0.11, { type: 'sine', f0: 130, f1: 58, gain: 0.2 * m });
        break;
      }
      case 'roll':
        this._burst(t, 0.26, { type: 'bandpass', f0: 820, f1: 340, q: 0.9, gain: 0.09, attack: 0.03 });
        break;
      case 'splash':
        this._burst(t, 0.42, { type: 'bandpass', f0: 1150, f1: 320, q: 0.8, gain: 0.26, attack: 0.01, verb: 0.3 });
        this._tone(t + 0.1, 0.09, { type: 'sine', f0: 900, f1: 1500, gain: 0.05 });
        this._tone(t + 0.22, 0.08, { type: 'sine', f0: 700, f1: 1250, gain: 0.04 });
        break;
      case 'bolt':
        this._tone(t, 0.2, { type: 'sawtooth', f0: 880, f1: 150, gain: 0.1 });
        this._burst(t, 0.14, { type: 'highpass', f0: 2100, gain: 0.07 });
        break;
      case 'explosion':
        this._burst(t, 0.75, { type: 'lowpass', f0: 2400, f1: 90, gain: 0.55, attack: 0.005, verb: 0.4 });
        this._tone(t, 0.65, { type: 'sine', f0: 105, f1: 28, gain: 0.65 });
        break;
      case 'boss_roar':
        this._tone(t, 1.1, { type: 'sawtooth', f0: 68, f1: 44, gain: 0.3, lp: 480, verb: 0.5 });
        this._tone(t, 1.05, { type: 'sawtooth', f0: 93, f1: 58, gain: 0.24, lp: 480, detune: 9 });
        this._burst(t, 1.0, { type: 'bandpass', f0: 260, f1: 130, q: 0.5, gain: 0.3, attack: 0.05, verb: 0.4 });
        break;
      case 'boss_hit':
        this._tone(t, 0.12, { type: 'square', f0: 1500, f1: 1100, gain: 0.11 });
        this._tone(t, 0.28, { type: 'sine', f0: 150, f1: 40, gain: 0.55 });
        this._burst(t, 0.2, { type: 'lowpass', f0: 900, f1: 200, gain: 0.25 });
        break;
      case 'brazier':
        this._burst(t, 0.45, { type: 'bandpass', f0: 380, f1: 1700, q: 1, gain: 0.2, attack: 0.04, verb: 0.3 });
        this._tone(t + 0.1, 0.5, { type: 'sine', f0: 880, f1: 660, gain: 0.06, verb: 0.5 });
        this._burst(t + 0.3, 0.12, { type: 'highpass', f0: 3000, gain: 0.05 });
        break;
      case 'door':
        this._burst(t, 0.5, { type: 'lowpass', f0: 150, gain: 0.28, rate: 0.45 });
        this._tone(t + 0.42, 0.16, { type: 'sine', f0: 82, f1: 44, gain: 0.32 });
        break;
      case 'portal':
        this._tone(t, 0.85, { type: 'sine', f0: 320, f1: 1280, gain: 0.1, verb: 0.7 });
        this._tone(t + 0.05, 0.8, { type: 'sine', f0: 480, f1: 1920, gain: 0.06, verb: 0.7 });
        this._burst(t, 0.7, { type: 'bandpass', f0: 900, f1: 2600, q: 2, gain: 0.06, attack: 0.1, verb: 0.5 });
        break;
      case 'ui_move':
        this._tone(t, 0.045, { type: 'square', f0: 640, gain: 0.045 });
        break;
      case 'ui_select':
        this._tone(t, 0.05, { type: 'square', f0: 780, gain: 0.05 });
        this._tone(t + 0.05, 0.1, { type: 'square', f0: 1170, gain: 0.05 });
        break;
      case 'ui_open':
        this._tone(t, 0.12, { type: 'triangle', f0: 520, f1: 940, gain: 0.06 });
        break;
      case 'ui_close':
        this._tone(t, 0.12, { type: 'triangle', f0: 940, f1: 520, gain: 0.05 });
        break;
      case 'dialogue_blip':
        this._tone(t, 0.035, { type: 'square', f0: 900 + Math.random() * 220, gain: 0.035 });
        break;
      case 'quest':
        this._arp(t, 587.33, [0, 7, 12], 0.09, { type: 'triangle', gain: 0.09, verb: 0.5, lastDur: 0.45 });
        break;
      case 'save':
        this._tone(t, 0.12, { type: 'sine', f0: 784, gain: 0.07, verb: 0.35 });
        this._tone(t + 0.12, 0.3, { type: 'sine', f0: 1046.5, gain: 0.08, verb: 0.45 });
        break;
      case 'pop':
        this._burst(t, 0.07, { type: 'bandpass', f0: 950, q: 1.2, gain: 0.09 });
        this._tone(t, 0.07, { type: 'sine', f0: 520, f1: 240, gain: 0.08 });
        break;
      default:
        break;
    }
  }

  /** Short brass-ish fanfare: [[time, semi, dur], ...] relative to base. */
  _fanfare(t, base, notes) {
    for (let i = 0; i < notes.length; i++) {
      const [dt, semi, dur] = notes[i];
      const f = semiF(base, semi);
      this._tone(t + dt, dur, { type: 'sawtooth', f0: f, lp: 2200, gain: 0.13, attack: 0.01, release: 0.1, verb: 0.45 });
      this._tone(t + dt, dur, { type: 'triangle', f0: f * 2, gain: 0.05, attack: 0.01, verb: 0.4 });
    }
    const last = notes[notes.length - 1];
    this._tone(t + last[0], last[2], { type: 'sine', f0: semiF(base, last[1]) * 0.5, gain: 0.12, attack: 0.01, release: 0.15 });
    this._burst(t + last[0], 0.5, { type: 'highpass', f0: 5000, gain: 0.05, attack: 0.02, verb: 0.5 });
  }

  _step(t, o) {
    const biome = o.biome || 'meadow';
    const m = o.sprint ? 1.35 : 1;
    // Shallow-water check: footing at/below the waterline splashes.
    let wet = biome === 'lakebed';
    if (!wet && (biome === 'beach' || biome === 'meadow')) {
      const g = this.game;
      const gp = g.player.groundProvider;
      if (gp && gp.waterLevel !== undefined && g.player.position.y < gp.waterLevel + 0.12) wet = true;
    }
    if (wet) {
      this._burst(t, 0.16, { type: 'bandpass', f0: 750, f1: 350, q: 0.9, gain: 0.11 * m });
      this._tone(t + 0.02, 0.06, { type: 'sine', f0: 800, f1: 1300, gain: 0.02 });
    } else if (biome === 'beach' || biome === 'badland') {
      this._burst(t, 0.09, { type: 'lowpass', f0: 950, gain: 0.05 * m, rate: 0.8 }); // sandy shuff
    } else if (biome === 'peak' || biome === 'stone' || biome === 'dungeon') {
      this._burst(t, 0.045, { type: 'bandpass', f0: 1650, q: 1.6, gain: 0.065 * m }); // clicky
    } else {
      this._burst(t, 0.06, { type: 'lowpass', f0: 500, gain: 0.05 * m }); // soft grass
    }
  }

  // -- ambience --------------------------------------------------------------
  _updateAmbience(rawDt) {
    const g = this.game;
    const p = g.player.position;
    const k = Math.min(1, rawDt * 2.2);
    const inD = g.inDungeon;
    const night = !!(g.sky && g.sky.isNight);

    this._biomePoll -= rawDt;
    if (this._biomePoll <= 0) {
      this._biomePoll = 0.5;
      if (g.terrain && g.terrain.biomeAt && !inD) {
        this._biomeId = g.terrain.biomeAt(p.x, p.z).id;
      }
    }

    // Wind — stronger on high ground.
    const alt = Math.min(1, Math.max(0, (p.y - 12) / 45));
    const windT = inD ? 0 : 0.05 + alt * 0.17;
    this._wind.gain.value += (windT - this._wind.gain.value) * k;

    // Lake lapping — near Mirrowmere's shoreline (or out on the water).
    const dx = p.x - LAKE.x, dz = p.z - LAKE.z;
    const edge = Math.abs(Math.sqrt(dx * dx + dz * dz) - LAKE.r);
    const lakeT = inD ? 0 : 0.22 * Math.min(1, Math.max(0, 1 - edge / 70));
    this._lake.gain.value += (lakeT - this._lake.gain.value) * k;

    // Crickets — grassy night air.
    const grassy = this._biomeId === 'meadow' || this._biomeId === 'forest';
    const cricketT = (!inD && night && grassy) ? 0.045 : 0;
    this._crickets.gain.value += (cricketT - this._crickets.gain.value) * k;

    // Dungeon rumble.
    const rumbleT = inD ? 0.4 : 0;
    this._rumble.gain.value += (rumbleT - this._rumble.gain.value) * k;

    // Bird chirps — daytime meadow/forest/beach only.
    if (!inD && !night && (grassy || this._biomeId === 'beach')) {
      this._birdTimer -= rawDt;
      if (this._birdTimer <= 0) {
        this._birdTimer = 2 + Math.random() * 6;
        this._chirp();
      }
    }
  }

  _chirp() {
    const t0 = this.ctx.currentTime + 0.02;
    const base = 2200 + Math.random() * 1500;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      const f = base * (1 + Math.random() * 0.18);
      this._tone(t, 0.07, {
        type: 'sine', f0: f * 0.78, f1: f, fTime: 0.035, slide: 'lin',
        gain: 0.02 + Math.random() * 0.012, attack: 0.012, dest: this.ambBus, verb: 0.25,
      });
    }
  }

  // -- event wiring ----------------------------------------------------------
  _wireEvents() {
    const ev = this.game.events;

    ev.on('player:attack', (p) => {
      if (p.index === 'spin') this.sfx('spin');
      else this.sfx(['sword1', 'sword2', 'sword3'][p.index] || 'sword1');
    });
    ev.on('combat:hit', (p) => {
      this.sfx(p.crit ? 'crit' : 'hit');
      this.sfx('enemy_hit');
      this._combatTimer = Math.max(this._combatTimer, 5);
    });
    ev.on('player:block', () => this.sfx('block'));
    ev.on('enemy:death', (p) => {
      this.sfx('enemy_die');
      if (p.enemy) this._aggroed.delete(p.enemy);
    });
    ev.on('enemy:aggro', (p) => {
      if (p.enemy) this._aggroed.add(p.enemy);
      this._combatTimer = Math.max(this._combatTimer, 3);
    });
    ev.on('player:damage', (p) => {
      if (!p.blocked) this.sfx('hurt');
      if (!p.drown) this._combatTimer = Math.max(this._combatTimer, 5);
    });
    ev.on('player:heal', (p) => this.sfx(p.container ? 'secret' : 'heal'));
    ev.on('player:step', (p) => this.sfx('step', { biome: p.biome, sprint: p.sprint }));
    ev.on('player:jump', () => this.sfx('jump'));
    ev.on('player:land', (p) => this.sfx('land', { hard: p.hard }));
    ev.on('player:roll', () => this.sfx('roll'));

    ev.on('pickup', (p) => {
      const type = p.type || '';
      if (type.indexOf('gem') === 0) {
        this.sfx('gem');
        this._gemCombo++;
        this._gemComboT = 2;
      } else if (type === 'heart') this.sfx('heart');
      else if (type === 'key') this.sfx('key');
      else this.sfx('pickup');
    });
    ev.on('chest:open', (p) => this.sfx(p.big ? 'chest_big' : 'chest'));
    ev.on('chest:locked', () => this.sfx('door'));
    ev.on('projectile:pop', () => this.sfx('pop'));

    ev.on('quest:started', () => this.sfx('quest'));
    ev.on('quest:completed', () => this.sfx('quest'));
    ev.on('game:save', () => this.sfx('save'));
    ev.on('ui:sfx', (p) => { if (p && p.name) this.sfx(p.name, p); });
    ev.on('modal', (p) => this.sfx(p.open ? 'ui_open' : 'ui_close'));
    ev.on('sign:read', () => this.sfx('ui_open'));

    ev.on('dungeon:enter', () => this.sfx('portal'));
    ev.on('dungeon:exit', () => {
      this.sfx('portal');
      this._bossActive = false;
    });
    ev.on('boss:start', () => {
      this._bossActive = true;
      this.sfx('boss_roar');
    });
    ev.on('boss:end', (p) => {
      this._bossActive = false;
      if (p && p.victory) {
        this._victoryTimer = 14;
        this.sfx('secret');
      }
    });
    ev.on('game:start', () => {
      this._bossActive = false;
      this._victoryTimer = 0;
      this._combatTimer = 0;
      this.sfx('ui_select');
    });
    ev.on('player:respawn', () => { this._combatTimer = 0; });
  }
}
