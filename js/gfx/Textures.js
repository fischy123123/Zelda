import * as THREE from 'three';

// Procedurally generated, tileable PBR-style textures (albedo + normal maps).
// Everything is drawn to a canvas at load time, so there are no external asset
// downloads and nothing can 404. Results are cached and shared.

// ---- Tileable periodic value noise ----
function hash(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 2246822519;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }

// Value noise that wraps every `grid` cells, so sampling u,v in [0,1)*grid tiles.
function vnoise(x, y, grid, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const wx0 = ((x0 % grid) + grid) % grid, wy0 = ((y0 % grid) + grid) % grid;
  const wx1 = (wx0 + 1) % grid, wy1 = (wy0 + 1) % grid;
  const tl = hash(wx0, wy0, seed), tr = hash(wx1, wy0, seed);
  const bl = hash(wx0, wy1, seed), br = hash(wx1, wy1, seed);
  const u = smooth(xf), v = smooth(yf);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(tl, tr, u), THREE.MathUtils.lerp(bl, br, u), v);
}

// Build a tileable height field (Float array in [0,1]) via fractal noise.
function heightField(size, { baseGrid = 8, octaves = 5, seed = 1 } = {}) {
  const h = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 1, sum = 0, norm = 0, grid = baseGrid;
      for (let o = 0; o < octaves; o++) {
        const u = (x / size) * grid, v = (y / size) * grid;
        sum += amp * vnoise(u, v, grid, seed + o * 17);
        norm += amp; amp *= 0.5; grid *= 2;
      }
      const val = sum / norm;
      h[y * size + x] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  // Normalize to full 0..1.
  const inv = 1 / (max - min || 1);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - min) * inv;
  return h;
}

// Convert a height field to a tangent-space normal map texture.
function normalMapFromHeight(h, size, strength = 2.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Paint an albedo canvas from a height field using a colour ramp + speckle.
function albedoFromHeight(h, size, ramp) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const col = new THREE.Color();
  for (let i = 0; i < h.length; i++) {
    ramp(h[i], col);
    const j = i * 4;
    img.data[j] = col.r * 255;
    img.data[j + 1] = col.g * 255;
    img.data[j + 2] = col.b * 255;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const cache = {};

// Neutral grey surface detail + normal for the terrain (multiplied by the
// per-vertex biome colours, so one texture works across grass/sand/rock).
export function terrainDetail() {
  if (cache.terrain) return cache.terrain;
  const size = 256;
  const h = heightField(size, { baseGrid: 10, octaves: 6, seed: 11 });
  const map = albedoFromHeight(h, size, (v, col) => {
    const g = 0.62 + v * 0.38; // keep it near-white so it tints, not recolours
    col.setRGB(g, g, g);
  });
  const normal = normalMapFromHeight(h, size, 2.2);
  cache.terrain = { map, normal };
  return cache.terrain;
}

export function rockTexture() {
  if (cache.rock) return cache.rock;
  const size = 256;
  const h = heightField(size, { baseGrid: 6, octaves: 6, seed: 23 });
  const map = albedoFromHeight(h, size, (v, col) => {
    col.setHSL(0.07, 0.06, 0.42 + v * 0.22);
  });
  const normal = normalMapFromHeight(h, size, 3.0);
  cache.rock = { map, normal };
  return cache.rock;
}

export function barkTexture() {
  if (cache.bark) return cache.bark;
  const size = 128;
  // Stretch noise vertically for a bark-like grain.
  const h = heightField(size, { baseGrid: 4, octaves: 5, seed: 31 });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 10 + h[y * size + x] * 3);
      h[y * size + x] = h[y * size + x] * 0.5 + stripe * 0.5;
    }
  }
  const map = albedoFromHeight(h, size, (v, col) => {
    col.setHSL(0.08, 0.45, 0.18 + v * 0.18);
  });
  const normal = normalMapFromHeight(h, size, 2.4);
  cache.bark = { map, normal };
  return cache.bark;
}

// Animated ripple normal map for water.
export function waterNormal() {
  if (cache.water) return cache.water;
  const size = 256;
  const h = heightField(size, { baseGrid: 8, octaves: 4, seed: 5 });
  cache.water = normalMapFromHeight(h, size, 1.6);
  return cache.water;
}
