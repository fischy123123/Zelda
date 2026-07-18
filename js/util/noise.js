// Deterministic 2D value noise + fractal helpers. Pure functions of (x, y) —
// the permutation table is fixed, so terrain and scatter are identical on
// every machine and every load.

const PERM = new Uint8Array(512);
{
  // Fixed shuffle driven by a hardcoded LCG so results never change.
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x9e3779b9;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function hash2(ix, iy) {
  return PERM[(PERM[ix & 255] + iy) & 255];
}

// Value noise in [-1, 1].
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const a = hash2(ix, iy) / 127.5 - 1;
  const b = hash2(ix + 1, iy) / 127.5 - 1;
  const c = hash2(ix, iy + 1) / 127.5 - 1;
  const d = hash2(ix + 1, iy + 1) / 127.5 - 1;
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

// Fractal brownian motion in [-1, 1].
export function fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq + i * 17.13, y * freq - i * 9.71) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal in [0, 1] — sharp mountain crests.
export function ridged2(x, y, octaves = 4, lacunarity = 2.1, gain = 0.55) {
  let sum = 0, amp = 0.6, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq + i * 31.7, y * freq + i * 3.3));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Cheap domain warp: returns fbm sampled at a warped position. Breaks up the
// "gridded" look of plain value noise.
export function warped2(x, y, octaves = 4, warp = 1.0) {
  const wx = fbm2(x + 5.2, y + 1.3, 2) * warp;
  const wy = fbm2(x - 3.7, y + 8.1, 2) * warp;
  return fbm2(x + wx, y + wy, octaves);
}

// Hash of an integer lattice point to [0,1] — for per-cell scatter decisions.
export function cellHash(ix, iy, salt = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
