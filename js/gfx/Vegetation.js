// Vegetation & props — the living carpet of Aurelia.
//
// BOTW-style rolling grass: >=40k instanced blades (high) driven by a custom
// shader. Blades live in a repeating tile that toroidally wraps around the
// player, so density stays lush near the camera while total instance count is
// fixed. Ground height + biome tint + density come from a baked "grass map"
// DataTexture (16-bit packed height, tint axis meadow-green<->dry-gold<->
// forest-shade, density with site/water/rim masking). Wind gusts + flutter,
// blades bend away from the player, and everything scales out past ~120u so
// the horizon stays clean.
//
// Trees (oak / birch / dead snag), rocks (gray + mossy), bushes, lakeside
// reeds and flowers are InstancedMeshes built from merged low-poly parts with
// vertex colors — exactly one draw call each:
//   grass, flowers, oak, birch, snag, rockGray, rockMoss, bush, reed = 9 draws.
//
// All placement is deterministic (RNG seeded from WORLD.seed + fixed noise).
// update(dt, playerPos) only ticks uniforms — zero allocations, zero scene
// mutation per frame.

import * as THREE from 'three';
import { toonMaterial, PALETTE, windUniforms } from './Toon.js';
import { RNG } from '../util/rng.js';
import { fbm2 } from '../util/noise.js';
import { clamp, clamp01, smoothstep } from '../util/math.js';
import { WORLD, SITES, LAKE, BADLANDS, FOREST_BAND } from '../world/layout.js';

const SITE_LIST = Object.values(SITES);

// --------------------------------------------------------------------------
// Per-quality budgets.
// --------------------------------------------------------------------------
const CFG = {
  high: {
    blades: 46000, tile: 250, fadeStart: 96, fadeEnd: 122,
    treeStep: 9, rockStep: 14, bushStep: 11,
    reedTries: 900, flowerClusters: 150, glowClusters: 85,
    maxTrees: 2600, maxRocks: 950, maxBushes: 750, maxReeds: 750, maxFlowers: 1200,
    shadows: true,
  },
  low: {
    blades: 14336, tile: 150, fadeStart: 56, fadeEnd: 74,
    treeStep: 12.5, rockStep: 19, bushStep: 15,
    reedTries: 450, flowerClusters: 70, glowClusters: 40,
    maxTrees: 1300, maxRocks: 480, maxBushes: 380, maxReeds: 380, maxFlowers: 550,
    shadows: false,
  },
};

// --------------------------------------------------------------------------
// Grass shader.
// --------------------------------------------------------------------------
const GRASS_VERT = /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime;
uniform vec3 uPlayer;
uniform sampler2D uMap;
uniform float uHeightMin;
uniform float uHeightSpan;
uniform float uInvExtent;
uniform float uTile;
uniform float uFadeStart;
uniform float uFadeEnd;
uniform vec3 uRoot;
uniform vec3 uTipGreen;
uniform vec3 uTipDry;
uniform vec3 uTipForest;
uniform vec3 uLight;

attribute vec4 aPos;    // tileX, tileZ, yaw, phase
attribute vec4 aShape;  // height, width, threshold, tintJitter

varying vec3 vColor;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // Wrap this blade's tile position to the copy nearest the player.
  vec2 base = aPos.xy + uTile * floor((uPlayer.xz - aPos.xy) / uTile + 0.5);

  // Baked map: 16-bit ground height, tint axis, density.
  vec2 muv = base * uInvExtent + 0.5;
  vec4 m = texture2D(uMap, muv);
  float ground = dot(m.rg, vec2(65280.0, 255.0)) / 65535.0 * uHeightSpan + uHeightMin;

  // Clump noise carves the map density into BOTW-ish tufts and patches.
  float cl = vnoise(base * 0.31) * 0.62 + vnoise(base * 0.083) * 0.38;
  float cover = m.a * (0.3 + 0.7 * smoothstep(0.35, 0.75, cl));

  float d = distance(base, uPlayer.xz);
  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, d);
  float grow = smoothstep(aShape.z, aShape.z + 0.2, cover) * fade;

  float tc = clamp(position.y, 0.0, 1.0);
  float hgt = aShape.x * (0.6 + 0.55 * cover) * grow;

  float cy = cos(aPos.z), sy = sin(aPos.z);
  vec2 side = vec2(cy, -sy) * (position.x * aShape.y);
  vec3 wpos = vec3(base.x + side.x, ground - 0.05 + position.y * hgt, base.y + side.y);

  // Wind: rolling gusts sweep the field, tiny flutter per blade.
  float gust = sin(uTime * 1.35 + base.x * 0.052 + base.y * 0.047);
  float gust2 = sin(uTime * 0.53 + base.x * 0.021 - base.y * 0.033);
  float flutter = sin(uTime * 5.2 + aPos.w * 6.2831 + base.x * 0.35);
  vec2 windDir = vec2(0.8305, 0.5570);
  float wamp = (gust * 0.5 + 0.5) * (gust2 * 0.35 + 0.65);
  vec2 sway = windDir * (wamp * 0.34 + gust2 * 0.10)
            + vec2(-windDir.y, windDir.x) * flutter * 0.06;
  float bendW = tc * tc * hgt;
  wpos.xz += sway * bendW;

  // Bend away from the player (only when they are near this blade's ground).
  vec2 dp = wpos.xz - uPlayer.xz;
  float pd = max(length(dp), 1e-4);
  float push = (1.0 - smoothstep(0.15, 1.6, pd))
             * (1.0 - smoothstep(1.2, 2.8, abs(uPlayer.y - ground)));
  wpos.xz += (dp / pd) * push * bendW * 1.1;
  wpos.y -= push * tc * hgt * 0.35;

  // Biome tint: green meadow -> dry gold, or darker under forest canopy.
  float tint = m.b * 2.0 - 1.0;
  vec3 tip = mix(uTipGreen, uTipDry, clamp(tint, 0.0, 1.0));
  tip = mix(tip, uTipForest, clamp(-tint, 0.0, 1.0));
  tip *= 1.0 + aShape.w;
  vec3 col = mix(uRoot, tip, tc);
  col += tip * (wamp * wamp * 0.16) * tc;   // gust light rolling across tips
  vColor = col * uLight;

  vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GRASS_FRAG = /* glsl */ `
#include <fog_pars_fragment>
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// --------------------------------------------------------------------------
// Wind patch for instanced toon materials. Mirrors Toon.js enableWind() but
// derives the phase from the *instance* world position so a whole forest
// never rocks in perfect sync (enableWind reads modelMatrix only, which is
// identity-ish for InstancedMesh).
// --------------------------------------------------------------------------
function windChunk(strength, freq) {
  return `
      {
        #ifdef USE_INSTANCING
        vec4 vegWp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
        #else
        vec4 vegWp = modelMatrix * vec4( transformed, 1.0 );
        #endif
        float vegSway = sin( uWindTime * ${(1.6 * freq).toFixed(3)} + vegWp.x * 0.11 + vegWp.z * 0.13 )
                      + 0.5 * sin( uWindTime * ${(2.7 * freq).toFixed(3)} + vegWp.z * 0.23 );
        float vegAmt = ${strength.toFixed(4)} * max( transformed.y, 0.0 );
        transformed.x += vegSway * vegAmt;
        transformed.z += vegSway * vegAmt * 0.6;
      }`;
}

function patchInstancedWind(mat, strength, freq) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.time;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>' + windChunk(strength, freq)
    );
  };
  mat.customProgramCacheKey = () => `vegWind|${strength}|${freq}`;
  return mat;
}

// Flower material: wind + per-vertex part colors (stem/center) with petals
// tinted per-instance (aPetal) and an emissive glow channel (aGlow) for the
// blue forest-shade flowers.
function patchFlowerMaterial(mat, strength, freq) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.time;
    shader.uniforms.uGlowColor = { value: new THREE.Color(0x5fb4ff) };
    shader.vertexShader = `
uniform float uWindTime;
attribute vec3 aVCol;
attribute float aMask;
attribute vec3 aPetal;
attribute float aGlow;
varying vec3 vVegCol;
varying float vVegGlow;
` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vVegCol = mix( aVCol, aVCol * aPetal, aMask );
      vVegGlow = aGlow * aMask;` + windChunk(strength, freq)
    );
    shader.fragmentShader = `
uniform float uWindTime;
uniform vec3 uGlowColor;
varying vec3 vVegCol;
varying float vVegGlow;
` + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= vVegCol;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += uGlowColor * vVegGlow * ( 0.65 + 0.3 * sin( uWindTime * 2.2 ) );`);
  };
  mat.customProgramCacheKey = () => `vegFlower|${strength}|${freq}`;
  return mat;
}

// --------------------------------------------------------------------------
// Geometry helpers.
// --------------------------------------------------------------------------

// Continuous noise-driven vertex jitter — coincident verts move identically,
// so flat-shaded blobs stay watertight while turning organic and chunky.
function blobby(geo, amt, salt, flattenY = 0) {
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const f = 1 + amt * fbm2(x * 1.35 + salt, (y + z) * 1.35 - salt, 2);
    pa.setXYZ(i, x * f, y * f * (1 - flattenY), z * f);
  }
  pa.needsUpdate = true;
  return geo;
}

/**
 * Merge simple parts into one non-indexed BufferGeometry with vertex colors
 * and an optional stem/petal mask channel.
 * part: {geo, matrix?, color?|colorFn?(x,y,z,outColor), flat?, mask?}
 */
function mergeParts(parts, withMask = false) {
  const prepped = [];
  let total = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    if (p.flat) g.computeVertexNormals();
    prepped.push({ g, p });
    total += g.attributes.position.count;
    p.geo.dispose();
  }
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const mask = withMask ? new Float32Array(total) : null;
  const c = new THREE.Color();
  let o = 0;
  for (const { g, p } of prepped) {
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++, o++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
      nor[o * 3] = na.getX(i); nor[o * 3 + 1] = na.getY(i); nor[o * 3 + 2] = na.getZ(i);
      if (p.colorFn) p.colorFn(x, y, z, c); else c.set(p.color ?? 0xffffff);
      col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
      if (mask) mask[o] = p.mask || 0;
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (withMask) {
    geo.setAttribute('aVCol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
  } else {
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

// Scratch objects for instance matrix building (startup only, but tidy).
const _m4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function buildInstances(geo, mat, items, name, shadow) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    _quat.setFromEuler(_euler.set(it.tx || 0, it.rot || 0, it.tz || 0));
    _p.set(it.x, it.y, it.z);
    _s.set(it.s, it.sy ?? it.s, it.s);
    _m4.compose(_p, _quat, _s);
    mesh.setMatrixAt(i, _m4);
    if (it.tint) mesh.setColorAt(i, it.tint);
  }
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;   // instances span the whole valley
  mesh.matrixAutoUpdate = false;
  mesh.name = name;
  return mesh;
}

function distTo(x, z, p) { const dx = x - p.x, dz = z - p.z; return Math.sqrt(dx * dx + dz * dz); }

// Update-time scratch (hot path — never allocate in update()).
const _sunDir = new THREE.Vector3();
const _lightCol = new THREE.Color();
const LIGHT_DAY = new THREE.Color(1.0, 1.0, 0.96);
const LIGHT_DUSK = new THREE.Color(1.06, 0.80, 0.60);
const LIGHT_NIGHT = new THREE.Color(0.20, 0.25, 0.42);

// ==========================================================================
export class Vegetation {
  constructor(game) {
    this.game = game;
    this.cfg = CFG[game.quality] || CFG.high;
    this.rng = new RNG(WORLD.seed).fork('vegetation');

    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;

    this._bakeGrassMap();
    this._buildGrass();
    this._plantTrees();
    this._plantRocks();
    this._plantBushes();
    this._plantReeds();
    this._plantFlowers();

    game.scene.add(this.group);
  }

  // ------------------------------------------------------------------------
  // update — uniforms only. Wind time, player bend, day/night light tint.
  // ------------------------------------------------------------------------
  update(dt, playerPos) {
    const u = this.grassUniforms;
    u.uTime.value += dt;
    u.uPlayer.value.copy(playerPos);

    // Read (never write) the sky for a day/night light multiplier so grass
    // doesn't glow at midnight. Defensive: works before Sky is feature-complete.
    const sky = this.game.sky;
    let elev;
    if (sky && typeof sky.getSunDirection === 'function') {
      sky.getSunDirection(_sunDir);
      if (_sunDir.lengthSq() < 1e-8) _sunDir.set(-0.4, -0.8, -0.3);
      elev = -_sunDir.y / _sunDir.length();   // sunDir points FROM sun TO world
    } else {
      const t = sky && typeof sky.timeOfDay === 'number' ? sky.timeOfDay : 0.4;
      elev = Math.sin((t - 0.25) * Math.PI * 2);
    }
    const night = 1 - smoothstep(-0.16, 0.06, elev);
    const warm = clamp01(1 - Math.abs(elev) * 2.6) * (1 - night);
    _lightCol.copy(LIGHT_DAY).lerp(LIGHT_DUSK, warm).lerp(LIGHT_NIGHT, night);
    u.uLight.value.copy(_lightCol);
  }

  // ------------------------------------------------------------------------
  // Grass map bake: RG = packed 16-bit ground height, B = tint axis
  // (0 forest-shade .. 0.5 meadow .. 1 dry-gold), A = blade density with
  // site (r+6), waterline and rim masking baked in. The tile-wrapped grass
  // shader samples this to stand blades on the ground anywhere in the valley.
  // ------------------------------------------------------------------------
  _bakeGrassMap() {
    const res = 256;
    const extent = 1460;               // covers ±730 — past the play radius
    const hMin = -14, hSpan = 150;
    const terrain = this.game.terrain;
    const data = new Uint8Array(res * res * 4);
    for (let iy = 0; iy < res; iy++) {
      const z = ((iy + 0.5) / res - 0.5) * extent;   // texel centers — matches
      for (let ix = 0; ix < res; ix++) {             // the shader's uv sampling
        const x = ((ix + 0.5) / res - 0.5) * extent;
        const o = (iy * res + ix) * 4;
        const radial = Math.sqrt(x * x + z * z);
        let h, density = 0, tintAxis = 0;
        const inPlay = radial < WORLD.playRadius + 55 &&
          ix > 0 && iy > 0 && ix < res - 1 && iy < res - 1;
        if (inPlay) {
          const b = terrain.biomeAt(x, z);
          h = b.height;
          density = b.grass
            * smoothstep(0.35, 0.9, h)                       // stay above waterline
            * this._siteClearSoft(x, z, 6, 8)                // out of all SITES r+6
            * (1 - smoothstep(WORLD.playRadius - 20, WORLD.playRadius + 40, radial));
          const dry = clamp01(fbm2(x * 0.008 + 300, z * 0.008, 2) * 0.9) * 0.8
            + (b.id === 'badland' ? 0.65 : 0);
          tintAxis = clamp(dry, 0, 1) - clamp01(b.forest * 1.15);
        } else {
          h = terrain.heightAt(x, z);
        }
        const n = Math.max(0, Math.min(65535, Math.round((h - hMin) / hSpan * 65535)));
        data[o] = n >> 8;
        data[o + 1] = n & 255;
        data[o + 2] = Math.round(clamp01(tintAxis * 0.5 + 0.5) * 255);
        data[o + 3] = Math.round(clamp01(density) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.grassMap = tex;
    this._mapInfo = { hMin, hSpan, extent };
  }

  /** Soft feathered keep-out around every authored site. */
  _siteClearSoft(x, z, margin, feather) {
    let f = 1;
    for (const s of SITE_LIST) {
      // Grass may creep into the village outskirts — only the built core
      // (~55% of the site radius) stays clear; other sites keep full clearance.
      const r = s === SITES.village ? s.r * 0.55 : s.r;
      f *= smoothstep(r + margin, r + margin + feather, distTo(x, z, s));
      if (f <= 0) return 0;
    }
    return f;
  }

  /** Hard keep-out test for props (trees/rocks/bushes/flowers/reeds). */
  _siteClear(x, z, margin = 6) {
    for (const s of SITE_LIST) if (distTo(x, z, s) < s.r + margin) return false;
    return true;
  }

  // ------------------------------------------------------------------------
  // Grass field: one InstancedBufferGeometry, one draw call.
  // ------------------------------------------------------------------------
  _buildGrass() {
    const { blades, tile, fadeStart, fadeEnd } = this.cfg;
    const rng = this.rng.fork('grass');
    const low = this.game.quality === 'low';

    // Tapered blade: deep buried root row (covers baked-height error on
    // slopes), base, mid, tip — 7 verts, 5 tris.
    const bladePos = new Float32Array([
      -0.60, -0.50, 0, 0.60, -0.50, 0,
      -0.50, 0.00, 0, 0.50, 0.00, 0,
      -0.32, 0.50, 0, 0.32, 0.50, 0,
      0.00, 1.00, 0,
    ]);
    const bladeIdx = [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6];

    const aPos = new Float32Array(blades * 4);
    const aShape = new Float32Array(blades * 4);
    for (let i = 0; i < blades; i++) {
      aPos[i * 4] = rng.next() * tile;             // tile-space x
      aPos[i * 4 + 1] = rng.next() * tile;         // tile-space z
      aPos[i * 4 + 2] = rng.angle();               // yaw
      aPos[i * 4 + 3] = rng.next();                // flutter phase
      aShape[i * 4] = rng.range(0.55, 1.05);       // height
      aShape[i * 4 + 1] = rng.range(low ? 0.10 : 0.08, low ? 0.16 : 0.13); // width
      aShape[i * 4 + 2] = rng.next() * 0.85;       // density threshold
      aShape[i * 4 + 3] = rng.range(-0.13, 0.13);  // tint jitter
    }

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(bladeIdx);
    geo.setAttribute('position', new THREE.BufferAttribute(bladePos, 3));
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    geo.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
    geo.instanceCount = blades;

    const mi = this._mapInfo;
    this.grassUniforms = {
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3(0, 20, 0) },
      uMap: { value: this.grassMap },
      uHeightMin: { value: mi.hMin },
      uHeightSpan: { value: mi.hSpan },
      uInvExtent: { value: 1 / mi.extent },
      uTile: { value: tile },
      uFadeStart: { value: fadeStart },
      uFadeEnd: { value: fadeEnd },
      uRoot: { value: new THREE.Color(0x3e7031) },
      uTipGreen: { value: new THREE.Color(PALETTE.grassHigh).lerp(new THREE.Color(0xd4f26a), 0.25) },
      uTipDry: { value: new THREE.Color(PALETTE.meadowDry).lerp(new THREE.Color(0xe8c86a), 0.5) },
      uTipForest: { value: new THREE.Color(PALETTE.forestFloor).lerp(new THREE.Color(0x2f6b3a), 0.4) },
      uLight: { value: new THREE.Color(1, 1, 1) },
      fogColor: { value: new THREE.Color(0xffffff) },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
      fogDensity: { value: 0.00025 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.grassUniforms,
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
      fog: true,
    });

    this.grassMesh = new THREE.Mesh(geo, mat);
    this.grassMesh.name = 'grass';
    this.grassMesh.frustumCulled = false;
    this.grassMesh.matrixAutoUpdate = false;
    this.group.add(this.grassMesh);
  }

  // ------------------------------------------------------------------------
  // Trees — three species, one merged trunk+canopy geometry each.
  // ------------------------------------------------------------------------
  _makeOakGeo() {
    const wood = new THREE.Color(PALETTE.wood), woodD = new THREE.Color(PALETTE.woodDark);
    const leaf = new THREE.Color(PALETTE.leaf), leafD = new THREE.Color(PALETTE.leafDark);
    const trunkCol = (x, y, z, c) => c.copy(woodD).lerp(wood, clamp01(y / 2.6));
    const leafCol = (x, y, z, c) => c.copy(leafD).lerp(leaf, clamp01((y - 1.6) / 3.2));
    return mergeParts([
      { geo: new THREE.CylinderGeometry(0.30, 0.58, 2.7, 6, 2, true), matrix: new THREE.Matrix4().makeTranslation(0, 1.35, 0), colorFn: trunkCol },
      { geo: blobby(new THREE.IcosahedronGeometry(1.6, 1), 0.16, 3.1), matrix: new THREE.Matrix4().makeTranslation(0, 3.45, 0), colorFn: leafCol, flat: true },
      { geo: blobby(new THREE.IcosahedronGeometry(1.15, 1), 0.18, 7.7), matrix: new THREE.Matrix4().makeTranslation(1.0, 2.75, 0.55), colorFn: leafCol, flat: true },
      { geo: blobby(new THREE.IcosahedronGeometry(1.05, 1), 0.18, 5.2), matrix: new THREE.Matrix4().makeTranslation(-0.9, 2.95, -0.45), colorFn: leafCol, flat: true },
    ]);
  }

  _makeBirchGeo() {
    const bark = new THREE.Color(0xe9e4d4), barkD = new THREE.Color(0x3a3630);
    const leaf = new THREE.Color(PALETTE.leaf).lerp(new THREE.Color(PALETTE.meadowDry), 0.35);
    const leafD = new THREE.Color(PALETTE.leafDark).lerp(new THREE.Color(PALETTE.leaf), 0.3);
    const trunkCol = (x, y, z, c) => {
      // Speckled dark bands on the pale trunk.
      const band = Math.sin(y * 9.2 + Math.atan2(z, x) * 2.0) > 0.88 ? 1 : 0;
      c.copy(bark).lerp(barkD, band * 0.85);
    };
    const leafCol = (x, y, z, c) => c.copy(leafD).lerp(leaf, clamp01((y - 2.6) / 2.4));
    return mergeParts([
      { geo: new THREE.CylinderGeometry(0.13, 0.21, 3.7, 5, 6, true), matrix: new THREE.Matrix4().makeTranslation(0, 1.85, 0), colorFn: trunkCol },
      { geo: blobby(new THREE.IcosahedronGeometry(1.0, 1), 0.15, 11.4), matrix: new THREE.Matrix4().makeTranslation(0, 4.0, 0), colorFn: leafCol, flat: true },
      { geo: blobby(new THREE.IcosahedronGeometry(0.72, 1), 0.17, 9.8), matrix: new THREE.Matrix4().makeTranslation(0.42, 3.25, -0.3), colorFn: leafCol, flat: true },
    ]);
  }

  _makeSnagGeo() {
    const dead = new THREE.Color(0x6e5a44), deadD = new THREE.Color(0x4a3c2e);
    const col = (x, y, z, c) => c.copy(deadD).lerp(dead, clamp01(y / 3.2));
    const trunk = new THREE.CylinderGeometry(0.14, 0.44, 3.4, 5, 3, true);
    { // lean the top for a wind-scoured silhouette
      const pa = trunk.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const y = pa.getY(i);
        pa.setX(i, pa.getX(i) + Math.max(y, 0) * 0.14);
      }
    }
    const b1 = new THREE.CylinderGeometry(0.045, 0.10, 1.5, 4, 1, true);
    const b2 = new THREE.CylinderGeometry(0.04, 0.085, 1.1, 4, 1, true);
    return mergeParts([
      { geo: trunk, matrix: new THREE.Matrix4().makeTranslation(0, 1.7, 0), colorFn: col },
      { geo: b1, matrix: new THREE.Matrix4().makeRotationZ(1.05).setPosition(0.55, 2.5, 0.1), colorFn: col },
      { geo: b2, matrix: new THREE.Matrix4().makeRotationZ(-0.95).multiply(new THREE.Matrix4().makeRotationX(0.4)).setPosition(-0.35, 2.0, -0.15), colorFn: col },
    ]);
  }

  _plantTrees() {
    const { treeStep, maxTrees, shadows } = this.cfg;
    const terrain = this.game.terrain;
    const rng = this.rng.fork('trees');
    const oaks = [], birches = [], snags = [];
    const lim = WORLD.playRadius + 20;

    for (let z = -lim; z <= lim; z += treeStep) {
      for (let x = -lim; x <= lim; x += treeStep) {
        const px = x + rng.gauss() * treeStep * 0.45;
        const pz = z + rng.gauss() * treeStep * 0.45;
        if (px * px + pz * pz > lim * lim) continue;
        if (!this._siteClear(px, pz)) continue;
        if (distTo(px, pz, LAKE) < LAKE.r * 0.8) continue;   // no trees in the lake
        const b = terrain.biomeAt(px, pz);
        if (b.height < 1.1 || b.height > 46 || b.slope > 0.55) continue;

        let list = null, item = null;
        if (b.id === 'badland') {
          if (rng.chance(0.04)) {
            list = snags;
            item = { s: rng.range(0.8, 1.5), cr: 0.34 };
          }
        } else if (b.forest > 0.05 && rng.chance(b.forest * 0.5)) {
          // Forest proper: oaks in the heart, birches toward the edges.
          const birch = rng.chance(0.28 + (1 - b.forest) * 0.35);
          list = birch ? birches : oaks;
          item = birch
            ? { s: rng.range(0.85, 1.45), cr: 0.30 }
            : { s: rng.range(0.8, 1.55), cr: 0.50 };
        } else if (b.id === 'meadow' && b.grass > 0.45 && rng.chance(0.006)) {
          // Rare lone meadow trees — big, landmark-y.
          const birch = rng.chance(0.25);
          list = birch ? birches : oaks;
          item = birch
            ? { s: rng.range(1.1, 1.6), cr: 0.30 }
            : { s: rng.range(1.2, 1.9), cr: 0.50 };
        }
        if (!list || oaks.length + birches.length + snags.length >= maxTrees) continue;

        item.x = px; item.z = pz;
        item.y = b.height - 0.35 * item.s;
        item.rot = rng.angle();
        item.sy = item.s * rng.range(0.9, 1.12);
        item.tint = new THREE.Color().setHSL(
          list === snags ? 0.08 : rng.range(0.18, 0.32),
          list === snags ? 0.12 : 0.32,
          rng.range(0.82, 1.0)
        );
        list.push(item);
        this.game.colliders.add({ x: px, z: pz, r: item.cr * item.s });
      }
    }

    const windy = (color) => patchInstancedWind(
      toonMaterial({ color, vertexColors: true, cache: false }), 0.05, 0.9);
    if (oaks.length) {
      this.oakMesh = buildInstances(this._makeOakGeo(), windy(0xffffff), oaks, 'oaks', shadows);
      this.group.add(this.oakMesh);
    }
    if (birches.length) {
      this.birchMesh = buildInstances(this._makeBirchGeo(), windy(0xffffff), birches, 'birches', shadows);
      this.group.add(this.birchMesh);
    }
    if (snags.length) {
      const snagMat = toonMaterial({ color: 0xffffff, vertexColors: true, cache: false });
      this.snagMesh = buildInstances(this._makeSnagGeo(), snagMat, snags, 'snags', shadows);
      this.group.add(this.snagMesh);
    }
  }

  // ------------------------------------------------------------------------
  // Rocks — gray + mossy dodecahedra on slopes, badlands and stray erratics.
  // ------------------------------------------------------------------------
  _plantRocks() {
    const { rockStep, maxRocks, shadows } = this.cfg;
    const terrain = this.game.terrain;
    const rng = this.rng.fork('rocks');
    const gray = [], moss = [];
    const lim = WORLD.playRadius + 30;

    const baseGeo = blobby(new THREE.DodecahedronGeometry(1, 0), 0.22, 17.3, 0.18);
    baseGeo.computeVertexNormals();
    const rock = new THREE.Color(PALETTE.rock), rockD = new THREE.Color(PALETTE.rockDark);
    const mossC = new THREE.Color(PALETTE.leafDark).lerp(new THREE.Color(PALETTE.forestFloor), 0.5);
    const grayGeo = mergeParts([{ geo: baseGeo.clone(), colorFn: (x, y, z, c) => c.copy(rockD).lerp(rock, clamp01(y * 0.5 + 0.6)) }]);
    const mossGeo = mergeParts([{
      geo: baseGeo, colorFn: (x, y, z, c) => {
        c.copy(rockD).lerp(rock, clamp01(y * 0.5 + 0.6));
        c.lerp(mossC, smoothstep(0.1, 0.75, y));   // moss caps the top
      },
    }]);

    for (let z = -lim; z <= lim; z += rockStep) {
      for (let x = -lim; x <= lim; x += rockStep) {
        if (gray.length + moss.length >= maxRocks) break;
        const px = x + rng.gauss() * rockStep * 0.45;
        const pz = z + rng.gauss() * rockStep * 0.45;
        if (px * px + pz * pz > lim * lim) continue;
        if (!this._siteClear(px, pz)) continue;
        const h = terrain.heightAt(px, pz);
        if (h < -1.2) continue;
        const slope = terrain.slopeAt(px, pz);
        let p = smoothstep(0.32, 0.7, slope) * 0.24;              // scree on slopes
        if (distTo(px, pz, BADLANDS) < BADLANDS.r) p += 0.08;     // badland rubble
        if (h > 42) p += 0.08;                                    // high crags
        if (slope < 0.2 && h > 2 && h < 30) p += 0.006;           // meadow erratics
        if (!rng.chance(clamp01(p))) continue;

        const b = terrain.biomeAt(px, pz);
        const s = 0.45 + Math.abs(rng.gauss()) * 1.5 + rng.next() * 0.4;
        const mossy = (b.forest > 0.25 || (b.grass > 0.55 && rng.chance(0.55))) && b.id !== 'badland';
        const item = {
          x: px, z: pz, y: h - s * 0.3, s, sy: s * rng.range(0.7, 1.05),
          rot: rng.angle(), tx: rng.range(-0.14, 0.14), tz: rng.range(-0.14, 0.14),
          tint: new THREE.Color().setHSL(b.id === 'badland' ? 0.07 : 0.1, b.id === 'badland' ? 0.28 : 0.06, rng.range(0.75, 1.0)),
        };
        (mossy ? moss : gray).push(item);
        if (s >= 0.95) this.game.colliders.add({ x: px, z: pz, r: s * 0.72 });
      }
    }

    const rockMat = toonMaterial({ color: 0xffffff, vertexColors: true, cache: false });
    if (gray.length) {
      this.rockMesh = buildInstances(grayGeo, rockMat, gray, 'rocks', shadows);
      this.group.add(this.rockMesh);
    }
    if (moss.length) {
      this.mossRockMesh = buildInstances(mossGeo, rockMat, moss, 'mossRocks', shadows);
      this.group.add(this.mossRockMesh);
    }
  }

  // ------------------------------------------------------------------------
  // Bushes — chunky leaf blobs at forest edges, in meadows and by the shore.
  // ------------------------------------------------------------------------
  _plantBushes() {
    const { bushStep, maxBushes } = this.cfg;
    const terrain = this.game.terrain;
    const rng = this.rng.fork('bushes');
    const items = [];
    const lim = WORLD.playRadius + 10;

    const leaf = new THREE.Color(PALETTE.leaf), leafD = new THREE.Color(PALETTE.leafDark);
    const geo = mergeParts([
      { geo: blobby(new THREE.IcosahedronGeometry(0.62, 1), 0.2, 23.7, 0.28), matrix: new THREE.Matrix4().makeTranslation(0, 0.42, 0), colorFn: (x, y, z, c) => c.copy(leafD).lerp(leaf, clamp01(y * 1.4 + 0.2)), flat: true },
      { geo: blobby(new THREE.IcosahedronGeometry(0.44, 1), 0.2, 31.2, 0.25), matrix: new THREE.Matrix4().makeTranslation(0.45, 0.34, 0.2), colorFn: (x, y, z, c) => c.copy(leafD).lerp(leaf, clamp01(y * 1.4 + 0.3)), flat: true },
    ]);

    for (let z = -lim; z <= lim; z += bushStep) {
      for (let x = -lim; x <= lim; x += bushStep) {
        if (items.length >= maxBushes) break;
        const px = x + rng.gauss() * bushStep * 0.45;
        const pz = z + rng.gauss() * bushStep * 0.45;
        if (px * px + pz * pz > lim * lim) continue;
        if (!this._siteClear(px, pz)) continue;
        const b = terrain.biomeAt(px, pz);
        if (b.id === 'badland' || b.height < 0.7 || b.height > 40 || b.slope > 0.5) continue;
        let p = 0.02 * b.grass;                                        // meadow scatter
        if (b.forest > 0.08 && b.forest < 0.55) p += 0.10 * b.forest;  // forest fringe
        const lakeShore = distTo(px, pz, LAKE) < LAKE.r && b.height < 4;
        if (lakeShore) p += 0.12;                                      // lakeside ring
        if (!rng.chance(clamp01(p))) continue;
        items.push({
          x: px, z: pz, y: b.height - 0.12, s: rng.range(0.7, 1.5),
          sy: rng.range(0.65, 1.2), rot: rng.angle(),
          tint: new THREE.Color().setHSL(rng.range(0.2, 0.33), 0.35, rng.range(0.8, 1.0)),
        });
      }
    }

    if (items.length) {
      const mat = patchInstancedWind(toonMaterial({ color: 0xffffff, vertexColors: true, cache: false }), 0.12, 1.7);
      this.bushMesh = buildInstances(geo, mat, items, 'bushes', false);
      this.group.add(this.bushMesh);
    }
  }

  // ------------------------------------------------------------------------
  // Reeds — crossed tapering stalks with cattail heads ringing Mirrowmere,
  // allowed to stand in the shallows.
  // ------------------------------------------------------------------------
  _plantReeds() {
    const { reedTries, maxReeds } = this.cfg;
    const terrain = this.game.terrain;
    const rng = this.rng.fork('reeds');
    const items = [];

    const stemD = new THREE.Color(0x3f6b35), stemL = new THREE.Color(0x9dba58);
    const head = new THREE.Color(0x6b4a2f);
    const stalk = new THREE.PlaneGeometry(0.1, 1.5, 1, 2);
    stalk.translate(0, 0.75, 0);
    { // taper toward the tip
      const pa = stalk.attributes.position;
      for (let i = 0; i < pa.count; i++) pa.setX(i, pa.getX(i) * (1 - pa.getY(i) / 1.9));
    }
    const stemCol = (x, y, z, c) => c.copy(stemD).lerp(stemL, clamp01(y / 1.5));
    const parts = [{ geo: stalk, colorFn: stemCol }];
    for (const a of [1.05, 2.09]) {
      parts.push({ geo: stalk.clone(), matrix: new THREE.Matrix4().makeRotationY(a), colorFn: stemCol });
    }
    parts.push({ geo: new THREE.CylinderGeometry(0.045, 0.055, 0.26, 5), matrix: new THREE.Matrix4().makeTranslation(0, 1.32, 0), color: head });
    const geo = mergeParts(parts);

    // For each angle around Mirrowmere, march outward from the basin to find
    // the true waterline, then stand a small clump of reeds on it.
    for (let i = 0; i < reedTries && items.length < maxReeds; i++) {
      const a = ((i + rng.next() * 0.8) / reedTries) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      let shoreR = -1;
      for (let rr = LAKE.r * 0.5; rr < LAKE.r * 0.95; rr += 3) {
        if (terrain.heightAt(LAKE.x + ca * rr, LAKE.z + sa * rr) > -0.55) { shoreR = rr; break; }
      }
      if (shoreR < 0) continue;
      if (fbm2(ca * 3.1 + 50, sa * 3.1, 2) < -0.25) continue;   // gappy stands
      const n = rng.int(1, 3);
      for (let k = 0; k < n && items.length < maxReeds; k++) {
        const px = LAKE.x + ca * shoreR + rng.gauss() * 3.5;
        const pz = LAKE.z + sa * shoreR + rng.gauss() * 3.5;
        const h = terrain.heightAt(px, pz);
        if (h < -0.75 || h > 0.7) continue;                     // shallows to bank
        if (!this._siteClear(px, pz)) continue;
        items.push({
          x: px, z: pz, y: h - 0.1, s: rng.range(0.75, 1.3), sy: rng.range(0.8, 1.35),
          rot: rng.angle(), tx: rng.range(-0.08, 0.08), tz: rng.range(-0.08, 0.08),
          tint: new THREE.Color().setHSL(rng.range(0.2, 0.3), 0.3, rng.range(0.85, 1.0)),
        });
      }
    }

    if (items.length) {
      const mat = patchInstancedWind(
        toonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, cache: false }), 0.22, 1.4);
      this.reedMesh = buildInstances(geo, mat, items, 'reeds', false);
      this.group.add(this.reedMesh);
    }
  }

  // ------------------------------------------------------------------------
  // Flowers — meadow clusters in 4 colors; blue glowing blooms in the
  // Elderwood's shade. Stem/center colors are per-vertex, petal color and
  // glow are per-instance attributes on one draw call.
  // ------------------------------------------------------------------------
  _plantFlowers() {
    const { flowerClusters, glowClusters, maxFlowers } = this.cfg;
    const terrain = this.game.terrain;
    const rng = this.rng.fork('flowers');
    const items = [];

    const stem = new THREE.Color(0x4a7d3a), center = new THREE.Color(PALETTE.gold);
    const geo = mergeParts([
      { geo: new THREE.CylinderGeometry(0.018, 0.028, 0.34, 5, 1, true), matrix: new THREE.Matrix4().makeTranslation(0, 0.17, 0), color: stem, mask: 0 },
      { geo: new THREE.IcosahedronGeometry(0.075, 0), matrix: new THREE.Matrix4().makeScale(1, 0.6, 1).setPosition(0, 0.37, 0), color: 0xffffff, mask: 1, flat: true },
      { geo: new THREE.IcosahedronGeometry(0.03, 0), matrix: new THREE.Matrix4().makeTranslation(0, 0.41, 0), color: center, mask: 0, flat: true },
    ], true);

    const MEADOW_COLORS = [0xf6f1e3, 0xf2cf4f, 0xe98bb6, 0xe2653f];
    const GLOW_COLOR = 0x74c8ff;

    const addCluster = (cx, cz, count, spread, colorPick, glow) => {
      for (let i = 0; i < count && items.length < maxFlowers; i++) {
        const fx = cx + rng.gauss() * spread;
        const fz = cz + rng.gauss() * spread;
        const h = terrain.heightAt(fx, fz);
        if (h < 0.6) continue;
        items.push({
          x: fx, z: fz, y: h - 0.03, s: rng.range(0.8, 1.35), rot: rng.angle(),
          petal: colorPick(), glow,
        });
      }
    };

    // Meadow clusters.
    for (let i = 0; i < flowerClusters; i++) {
      const cx = rng.range(-640, 640), cz = rng.range(-640, 640);
      if (cx * cx + cz * cz > 640 * 640) continue;
      if (!this._siteClear(cx, cz)) continue;
      const b = terrain.biomeAt(cx, cz);
      if (b.id !== 'meadow' || b.grass < 0.5 || b.slope > 0.3) continue;
      const petal = new THREE.Color(rng.pick(MEADOW_COLORS));
      addCluster(cx, cz, rng.int(4, 9), 2.6, () => petal.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.06, 0.06)), 0);
    }

    // Glowing blue flowers in forest shade.
    for (let i = 0; i < glowClusters; i++) {
      const cx = rng.range(-600, 600);
      const cz = rng.range(FOREST_BAND.z - FOREST_BAND.depth, FOREST_BAND.z);
      if (!this._siteClear(cx, cz)) continue;
      const b = terrain.biomeAt(cx, cz);
      if (b.forest < 0.45 || b.slope > 0.45) continue;
      addCluster(cx, cz, rng.int(3, 6), 2.0,
        () => new THREE.Color(GLOW_COLOR).offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.05, 0.08)), 1);
    }

    if (!items.length) return;

    const petals = new Float32Array(items.length * 3);
    const glows = new Float32Array(items.length);
    for (let i = 0; i < items.length; i++) {
      petals[i * 3] = items[i].petal.r;
      petals[i * 3 + 1] = items[i].petal.g;
      petals[i * 3 + 2] = items[i].petal.b;
      glows[i] = items[i].glow;
    }
    geo.setAttribute('aPetal', new THREE.InstancedBufferAttribute(petals, 3));
    geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glows, 1));

    const mat = patchFlowerMaterial(toonMaterial({ color: 0xffffff, cache: false }), 0.3, 1.9);
    this.flowerMesh = buildInstances(geo, mat, items, 'flowers', false);
    this.group.add(this.flowerMesh);
  }
}
