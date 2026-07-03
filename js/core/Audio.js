// Fully procedural audio: ambient music and all sound effects are synthesized
// with WebAudio at runtime — no audio files. The context unlocks on the first
// user gesture (required on mobile browsers).
const MOODS = {
  day:     { step: 0.28, rest: 0.38, scale: [60, 62, 64, 67, 69, 72, 74, 76], chords: [[48, 55], [45, 52], [50, 57], [43, 50]], pad: 0.05 },
  night:   { step: 0.5,  rest: 0.55, scale: [57, 60, 62, 64, 67, 69],         chords: [[45, 52], [41, 48], [43, 50], [40, 47]], pad: 0.045 },
  dungeon: { step: 0.44, rest: 0.5,  scale: [50, 53, 56, 57, 62, 65],         chords: [[38, 45], [37, 44], [36, 43], [41, 48]], pad: 0.06 },
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.mood = 'day';
    this._noiseBuf = null;
  }

  // Create/resume the context. Safe to call repeatedly; wired to user gestures.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musBus = c.createGain();
    this.musBus.gain.value = 0.4;
    this.musBus.connect(this.master);

    // A soft feedback echo gives the tiny synth voices a sense of space.
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.31;
    const fb = c.createGain(); fb.gain.value = 0.32;
    this.delay.connect(fb); fb.connect(this.delay);
    const echoOut = c.createGain(); echoOut.gain.value = 0.22;
    this.delay.connect(echoOut); echoOut.connect(this.master);

    // Mute when the tab is hidden (rAF pauses but timers keep firing).
    document.addEventListener('visibilitychange', () => {
      if (this.master) this.master.gain.setTargetAtTime(document.hidden ? 0 : 0.5, c.currentTime, 0.1);
    });

    this._startMusic();
  }

  setMood(m) { if (MOODS[m]) this.mood = m; }

  // ---------- music ----------
  _startMusic() {
    const c = this.ctx;
    // Sustained pad: two detuned saws through a gentle lowpass.
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 320;
    this.padGain = c.createGain();
    this.padGain.gain.value = MOODS[this.mood].pad;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.musBus);
    this.padOsc = [c.createOscillator(), c.createOscillator()];
    for (const o of this.padOsc) { o.type = 'sawtooth'; o.connect(this.padFilter); o.start(); }

    this._nextNote = c.currentTime + 0.2;
    this._nextChord = c.currentTime + 0.1;
    this._chordIdx = 0;
    this._melodyIdx = 3;
    this._timer = setInterval(() => this._tick(), 120);
  }

  _tick() {
    const c = this.ctx;
    if (!c || document.hidden) return;
    const m = MOODS[this.mood];
    const horizon = c.currentTime + 0.45;

    while (this._nextChord < horizon) {
      const chord = m.chords[this._chordIdx % m.chords.length];
      this._chordIdx++;
      this.padOsc[0].frequency.setTargetAtTime(hz(chord[0] - 12), this._nextChord, 0.5);
      this.padOsc[1].frequency.setTargetAtTime(hz(chord[1] - 12) * 1.003, this._nextChord, 0.5);
      this.padGain.gain.setTargetAtTime(m.pad, this._nextChord, 1.2);
      this._nextChord += 7.2;
    }

    while (this._nextNote < horizon) {
      if (Math.random() > m.rest) {
        // Random-walk over the mood's scale for a wandering, folk-like melody.
        this._melodyIdx += (Math.random() * 3 | 0) - 1;
        this._melodyIdx = Math.max(0, Math.min(m.scale.length - 1, this._melodyIdx));
        this._pluck(this._nextNote, m.scale[this._melodyIdx], 0.12);
      }
      this._nextNote += m.step * (Math.random() < 0.2 ? 2 : 1);
    }
  }

  _pluck(t, midi, vel) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(midi) * (1 + (Math.random() - 0.5) * 0.002);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
    o.connect(g);
    g.connect(this.musBus);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 0.6);
  }

  // ---------- sfx ----------
  _tone(type, f0, f1, dur, vol, at = 0) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, freq, at = 0) {
    const c = this.ctx, t = c.currentTime + at;
    if (!this._noiseBuf) {
      const buf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _arp(notes, gap, type, vol) {
    notes.forEach((n, i) => this._tone(type, hz(n), hz(n), 0.22, vol, i * gap));
  }

  sfx(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      switch (name) {
        case 'swing':  this._noise(0.16, 0.22, 1400); this._tone('sine', 320, 120, 0.14, 0.08); break;
        case 'hit':    this._tone('square', 220, 70, 0.1, 0.28); this._noise(0.07, 0.24, 2400); break;
        case 'hurt':   this._tone('sawtooth', 190, 65, 0.3, 0.3); break;
        case 'block':  this._tone('square', 540, 330, 0.07, 0.22); this._noise(0.05, 0.16, 4200); break;
        case 'rupee':  this._tone('sine', 988, 988, 0.07, 0.18); this._tone('sine', 1319, 1319, 0.12, 0.16, 0.07); break;
        case 'heart':  this._tone('sine', 660, 990, 0.2, 0.2); break;
        case 'key':    this._arp([79, 84], 0.09, 'sine', 0.2); break;
        case 'chest':  this._arp([60, 64, 67, 72], 0.1, 'triangle', 0.2); break;
        case 'fanfare':this._arp([60, 64, 67, 72, 76], 0.11, 'square', 0.13); this._tone('triangle', hz(84), hz(84), 0.7, 0.18, 0.55); break;
        case 'roll':   this._noise(0.2, 0.24, 600); break;
        case 'lock':   this._tone('square', 1180, 1180, 0.05, 0.16); break;
        case 'unlock': this._tone('sine', 110, 62, 0.4, 0.34); this._tone('sine', 1568, 1568, 0.2, 0.12, 0.15); break;
        case 'portal': this._tone('sine', 180, 760, 0.5, 0.2); this._noise(0.4, 0.12, 900); break;
        case 'click':  this._tone('square', 720, 720, 0.04, 0.12); break;
        case 'talk':   this._tone('sine', 440, 540, 0.06, 0.12); break;
        case 'quest':  this._arp([76, 81], 0.1, 'sine', 0.18); break;
        case 'die':    this._arp([67, 63, 60, 55], 0.22, 'sawtooth', 0.16); break;
      }
    } catch { /* never let audio kill the game loop */ }
  }
}
