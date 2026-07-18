// Deterministic seeded RNG (mulberry32). Every procedural system derives its
// randomness from one of these so world generation is reproducible.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = 1337) {
    this.s = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
  }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); } // inclusive
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  angle() { return this.next() * Math.PI * 2; }
  // Gaussian-ish (sum of 3) for natural-looking scatter.
  gauss() { return (this.next() + this.next() + this.next()) / 3 * 2 - 1; }
  fork(label) { return new RNG((this.s ^ hashString(String(label))) >>> 0); }
}
