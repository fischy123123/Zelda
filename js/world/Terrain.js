import * as THREE from 'three';
import { terrainDetail } from '../gfx/Textures.js?v=7';

// Lightweight, dependency-free value noise so terrain is reproducible from a seed.
function makeNoise(seed = 1337) {
  // Deterministic hash -> [0,1)
  function hash(x, y) {
    let h = x * 374761393 + y * 668265263 + seed * 2147483647;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // 2D value noise with bilinear interpolation
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const tl = hash(xi, yi), tr = hash(xi + 1, yi);
    const bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    const top = tl + (tr - tl) * u;
    const bot = bl + (br - bl) * u;
    return top + (bot - top) * v;
  }
  // Fractal Brownian motion for natural rolling hills
  return function fbm(x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += amp * noise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.size   world extent in units (square, centered on origin)
   * @param {number} opts.segments  mesh resolution
   * @param {number} opts.maxHeight  peak elevation above sea level
   */
  constructor({ size = 400, segments = 200, maxHeight = 22, seed = 1337 } = {}) {
    this.size = size;
    this.segments = segments;
    this.maxHeight = maxHeight;
    this.seaLevel = 1.5;
    this.noise = makeNoise(seed);
    this.scale = 0.012; // how stretched the noise is across the world

    this.mesh = this._buildMesh();
  }

  // Sample world-space height at (x, z). Used to clamp player/enemies/props.
  getHeightAt(x, z) {
    const half = this.size / 2;
    // Flatten the very center so the spawn area is friendly.
    const distCenter = Math.sqrt(x * x + z * z);
    const n = this.noise((x + half) * this.scale, (z + half) * this.scale);
    let h = Math.pow(n, 1.6) * this.maxHeight;
    // Carve a gentle bowl at the middle for the starting meadow.
    if (distCenter < 30) {
      const t = distCenter / 30;
      h = h * (0.25 + 0.75 * t);
    }
    return h;
  }

  isUnderwater(x, z) {
    return this.getHeightAt(x, z) < this.seaLevel;
  }

  _colorForHeight(h) {
    // Smoothly blend between palette stops for soft, natural transitions
    // instead of hard banding.
    const sand = new THREE.Color(0xe4d7a4);
    const grass = new THREE.Color(0x5aa84a);
    const grassDark = new THREE.Color(0x3f7e3a);
    const rock = new THREE.Color(0x77756a);
    const snow = new THREE.Color(0xeef4f7);

    const max = this.maxHeight;
    const c = new THREE.Color();
    if (h < this.seaLevel + 1.2) {
      const t = THREE.MathUtils.smoothstep(h, this.seaLevel - 0.5, this.seaLevel + 1.2);
      c.copy(sand).lerp(grass, t);
    } else if (h < max * 0.4) {
      const t = THREE.MathUtils.smoothstep(h, this.seaLevel + 1.2, max * 0.4);
      c.copy(grass).lerp(grassDark, t * 0.6);
    } else if (h < max * 0.68) {
      const t = THREE.MathUtils.smoothstep(h, max * 0.4, max * 0.68);
      c.copy(grassDark).lerp(rock, t);
    } else {
      const t = THREE.MathUtils.smoothstep(h, max * 0.68, max * 0.92);
      c.copy(rock).lerp(snow, t);
    }
    // Tiny per-vertex tint variation breaks up flat patches.
    const j = (Math.random() - 0.5) * 0.05;
    c.offsetHSL(0, 0, j);
    return c;
  }

  _buildMesh() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2); // make it a floor (XZ plane)

    const pos = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.getHeightAt(x, z);
      pos.setY(i, h);
      const col = this._colorForHeight(h);
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Procedural surface detail + normal map multiplied by the per-vertex biome
    // colours, so the ground reads as textured earth rather than flat colour.
    const det = terrainDetail();
    det.map.repeat.set(64, 64);
    det.normal.repeat.set(64, 64);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: det.map,
      normalMap: det.normal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false, // smooth, rolling hills rather than blocky facets
      envMapIntensity: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}
