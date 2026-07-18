// Shared stylized-shading helpers: toon materials with a common gradient ramp,
// character outlines (inverted hull), and the game's core color palette.
//
// Every visual module uses these so the whole world reads as one art style:
// chunky rounded silhouettes, cel-banded light, saturated-but-soft colors.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette — the single source of truth for the game's colors.
// ---------------------------------------------------------------------------
export const PALETTE = {
  grassLow:   0x6fae4e,
  grassHigh:  0x9ccb60,
  meadowDry:  0xb5c05e,
  forestFloor:0x4d8544,
  dirt:       0x9c7a52,
  sand:       0xe2cf9b,
  rock:       0x8d8779,
  rockDark:   0x6b675e,
  cliff:      0x7a7468,
  snow:       0xf2f4f0,
  badland:    0xc78d5a,
  badlandDark:0xa5683f,
  water:      0x2e7f9e,
  waterDeep:  0x155a78,
  foam:       0xeafaf6,
  wood:       0x7a5a3a,
  woodDark:   0x5c422a,
  leaf:       0x5d9e46,
  leafDark:   0x3f7d38,
  leafAutumn: 0xcc8a3d,
  thatch:     0xc9a15c,
  plaster:    0xe8dcc2,
  stone:      0x9a958b,
  stoneDark:  0x5d594f,
  metal:      0xb8bcc4,
  gold:       0xe8b64c,
  heroTunic:  0x2e8b6c,
  heroSkin:   0xf0c8a0,
  heroHair:   0xd9a441,
  blood:      0xd94f3a,
  magic:      0x7fd4ff,
  ember:      0xff8a3d,
  gemGreen:   0x4cd964,
  gemBlue:    0x4c9df0,
  gemRed:     0xf05a4c,
};

// ---------------------------------------------------------------------------
// Gradient ramps for MeshToonMaterial — a few cel bands with a soft toe.
// ---------------------------------------------------------------------------
const rampCache = new Map();

export function toonRamp(steps = 4) {
  if (rampCache.has(steps)) return rampCache.get(steps);
  // Hand-tuned band levels: dark toe lifts so shadows stay colorful, not black.
  const levels = {
    3: [0.35, 0.72, 1.0],
    4: [0.34, 0.58, 0.85, 1.0],
    5: [0.32, 0.5, 0.68, 0.88, 1.0],
  }[steps] || [0.34, 0.58, 0.85, 1.0];
  const data = new Uint8Array(levels.length * 4);
  for (let i = 0; i < levels.length; i++) {
    const v = Math.round(levels[i] * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(steps, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const matCache = new Map();

/**
 * Shared cel-shaded material. Options:
 *   color, emissive, emissiveIntensity, steps (ramp bands), vertexColors,
 *   transparent, opacity, side, cache (default true — same opts share one
 *   material instance, keep draw calls low).
 */
export function toonMaterial(opts = {}) {
  const {
    color = 0xffffff, emissive = 0x000000, emissiveIntensity = 1,
    steps = 4, vertexColors = false, transparent = false, opacity = 1,
    side = THREE.FrontSide, cache = true,
  } = opts;
  const key = cache
    ? `${color}|${emissive}|${emissiveIntensity}|${steps}|${vertexColors}|${transparent}|${opacity}|${side}`
    : null;
  if (key && matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshToonMaterial({
    color, emissive, emissiveIntensity,
    gradientMap: toonRamp(steps),
    vertexColors, transparent, opacity, side,
  });
  if (key) matCache.set(key, mat);
  return mat;
}

/** Unlit flat-color material (UI markers, glow cores, sky elements). */
export function flatMaterial(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

// ---------------------------------------------------------------------------
// Outlines — classic inverted-hull. Call on a character/prop group AFTER its
// meshes are final. Adds back-face shells slightly inflated along normals.
// ---------------------------------------------------------------------------
const outlineMat = new THREE.MeshBasicMaterial({
  color: 0x1c1a24, side: THREE.BackSide, toneMapped: false,
});

export function addOutline(root, thickness = 0.02, color = null) {
  const mat = color === null ? outlineMat : new THREE.MeshBasicMaterial({
    color, side: THREE.BackSide, toneMapped: false,
  });
  const shells = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.noOutline || obj.userData.isOutline) return;
    shells.push(obj);
  });
  for (const mesh of shells) {
    const shell = new THREE.Mesh(mesh.geometry, mat);
    shell.userData.isOutline = true;
    shell.scale.setScalar(1 + thickness);
    shell.raycast = () => {};
    mesh.add(shell);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Wind hook — vegetation-style vertex sway for any toon material.
// Shares one global time uniform; Game.js ticks windUniforms.time.value.
// ---------------------------------------------------------------------------
export const windUniforms = { time: { value: 0 } };

/**
 * Patch a material so vertices sway in the wind. `strength` scales with
 * vertex height (y in object space) so trunks stay planted while crowns sway.
 */
export function enableWind(material, strength = 0.14, freq = 1.0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.time;
    shader.vertexShader = `
      uniform float uWindTime;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        float sway = sin(uWindTime * ${(1.6 * freq).toFixed(3)} + wp.x * 0.11 + wp.z * 0.13)
                   + 0.5 * sin(uWindTime * ${(2.7 * freq).toFixed(3)} + wp.z * 0.23);
        float amt = ${strength.toFixed(4)} * max(transformed.y, 0.0);
        transformed.x += sway * amt;
        transformed.z += sway * amt * 0.6;
      }`
    );
  };
  material.customProgramCacheKey = () => `wind${strength}|${freq}`;
  return material;
}
