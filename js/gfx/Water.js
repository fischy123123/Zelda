// Lake Mirrowmere — the stylized toon water surface for the whole valley.
//
// One large plane at terrain.waterLevel driven by a custom ShaderMaterial:
//   - Gerstner-ish layered vertex waves (amplitude fades to calm at the shore)
//   - depth-aware banded color read from terrain.heightTexture
//     (sandy clear teal in the shallows -> rich stepped blue in the deep)
//   - animated shoreline foam where ground height ~ water level, with moving
//     noise breakup, travelling lap bands and subtle wave-crest caps
//   - fresnel blend toward the horizon/fog color, anisotropic sun glint
//     streak by day, broad cool moon glow by night (reads game.sky, never
//     modifies it)
//
// Exactly one draw call; all animation is uniform updates in update(dt).

import * as THREE from 'three';
import { PALETTE } from './Toon.js';
import { TAU, clamp01, smoothstep } from '../util/math.js';

// --------------------------------------------------------------------------
// Time-of-day palette endpoints (CPU-blended into uniforms each frame).
// --------------------------------------------------------------------------
const COL = {
  deepDay: new THREE.Color(0x175d80),
  deepNight: new THREE.Color(0x071a30),
  shallowDay: new THREE.Color(0x3fb2a4),
  shallowNight: new THREE.Color(0x11374d),
  sandDay: new THREE.Color(PALETTE.sand),
  sandNight: new THREE.Color(0x2e3f58),
  horizonDay: new THREE.Color(0xa9d7f7),
  horizonDusk: new THREE.Color(0xffb27a),
  horizonNight: new THREE.Color(0x161c40),
  glintSun: new THREE.Color(0xfff2d0),
  glintDusk: new THREE.Color(0xff9a5c),
  glintMoon: new THREE.Color(0xd9e8fa),
  foamDay: new THREE.Color(PALETTE.foam),
  foamNight: new THREE.Color(0x93a9c6),
};
const WHITE = new THREE.Color(0xffffff);

const _sunDir = new THREE.Vector3();

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeightMap;
uniform float uHeightMin;
uniform float uHeightSpan;
uniform float uInvWorldSize;
uniform float uWaterLevel;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;

#include <fog_pars_vertex>

// One directional Gerstner-ish wave: height + slope + horizontal pinch.
void addWave(vec2 p, vec2 dir, float wl, float amp, float speed,
             inout float h, inout vec2 grad, inout vec2 push) {
  float k = 6.2831853 / wl;
  float ph = dot(dir, p) * k + uTime * speed;
  float s = sin(ph);
  float c = cos(ph);
  h += amp * s;
  grad += dir * (amp * k * c);
  push += dir * (amp * 0.55 * c);
}

void main() {
  vec3 pos = position;
  vec2 wxz = pos.xz;

  // Water depth from the shared terrain height texture: calm at the beach so
  // waves never cut through sand, full swell out on open water.
  vec2 huv = wxz * uInvWorldSize + 0.5;
  float ground = texture2D(uHeightMap, huv).r * uHeightSpan + uHeightMin;
  float depth = uWaterLevel - ground;
  float atten = smoothstep(0.25, 2.6, depth);

  float h = 0.0;
  vec2 grad = vec2(0.0);
  vec2 push = vec2(0.0);
  addWave(wxz, vec2(0.834, 0.552), 52.0, 0.18, 0.90, h, grad, push);
  addWave(wxz, vec2(-0.700, 0.714), 31.0, 0.12, 1.25, h, grad, push);
  addWave(wxz, vec2(0.310, -0.951), 18.0, 0.07, 1.70, h, grad, push);
  addWave(wxz, vec2(-0.971, -0.239), 11.0, 0.05, 2.30, h, grad, push);

  pos.x += push.x * atten;
  pos.z += push.y * atten;
  pos.y += h * atten;

  vNormal = normalize(vec3(-grad.x * atten, 1.0, -grad.y * atten));
  vCrest = clamp((h * atten) / 0.42 * 0.5 + 0.5, 0.0, 1.0);

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeightMap;
uniform float uHeightMin;
uniform float uHeightSpan;
uniform float uInvWorldSize;
uniform float uWaterLevel;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSandColor;
uniform vec3 uHorizonColor;
uniform vec3 uFoamColor;
uniform vec3 uGlintColor;
uniform vec3 uGlintDir;       // surface -> light (sun by day, moon by night)
uniform float uGlintStrength;
uniform float uNight;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;

#include <fog_pars_fragment>

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * vnoise(p);
    p = p * 2.07 + 19.19;
    a *= 0.5;
  }
  return v;
}

// Soft-edged banding for the cel look.
float posterize(float v, float steps) {
  float f = v * steps;
  float i = floor(f);
  return clamp((i + smoothstep(0.38, 0.62, f - i)) / steps, 0.0, 1.0);
}

void main() {
  vec2 wxz = vWorldPos.xz;
  vec2 huv = wxz * uInvWorldSize + 0.5;
  float ground = texture2D(uHeightMap, huv).r * uHeightSpan + uHeightMin;
  float depth = max(uWaterLevel - ground, 0.0);

  // Per-pixel ripple detail layered onto the coarse vertex-wave normal.
  vec2 rp = wxz * 0.30;
  vec2 flow = vec2(uTime * 0.10, uTime * 0.075);
  float n0 = fbm(rp + flow);
  float nX = fbm(rp + flow + vec2(0.55, 0.0));
  float nZ = fbm(rp + flow + vec2(0.0, 0.55));
  vec3 N = normalize(vNormal + vec3(n0 - nX, 0.0, n0 - nZ) * 1.4);

  vec3 V = normalize(cameraPosition - vWorldPos);
  // Seen from underwater: flip so lighting stays sane.
  vec3 Nv = V.y < 0.0 ? vec3(N.x, -N.y, N.z) : N;

  // Depth-banded base color: clear teal shallows -> rich stepped blue deep.
  float depthFac = 1.0 - exp(-depth * 0.20);
  float bandFac = posterize(depthFac, 5.0);
  vec3 col = mix(uShallowColor, uDeepColor, bandFac);
  float sandMix = exp(-depth * 0.55);
  col = mix(col, uSandColor, sandMix * 0.5);

  // Cel-banded diffuse response to the sun/moon.
  float ndl = clamp(dot(Nv, uGlintDir), 0.0, 1.0);
  float lightBand = floor(ndl * 3.0 + 0.5) / 3.0;
  col *= 0.86 + 0.22 * lightBand;

  // Fresnel toward the sky/horizon color.
  float ndv = clamp(dot(Nv, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  col = mix(col, uHorizonColor, fres * 0.62);

  // Specular glint, stretched along the light azimuth into a streak.
  vec3 H = normalize(uGlintDir + V);
  vec2 az = uGlintDir.xz;
  float azl = max(length(az), 1e-4);
  az /= azl;
  float par = dot(Nv.xz, az);
  vec2 stretched = az * par + (Nv.xz - az * par) * 0.32;
  vec3 Ns = normalize(vec3(stretched.x, Nv.y, stretched.y));
  float spec = pow(max(dot(Ns, H), 0.0), mix(240.0, 90.0, uNight));
#ifndef LOW_Q
  float sparkle = fbm(wxz * 0.85 + vec2(uTime * 0.32, -uTime * 0.27));
  spec *= 0.55 + 0.9 * smoothstep(0.35, 0.75, sparkle);
#endif
  float glint = smoothstep(0.14, 0.42, spec) * uGlintStrength;

  // Shoreline foam: solid crisp edge where ground ~ water level, breakup by
  // drifting noise, plus travelling lap bands and subtle crest caps.
  float fn = fbm(wxz * 0.33 + vec2(uTime * 0.13, uTime * 0.10));
  float fn2 = fbm(wxz * 1.15 - vec2(uTime * 0.17, uTime * 0.06));
  float shoreEdge = 0.35 + fn * 0.55;
  float foam = 1.0 - smoothstep(shoreEdge, shoreEdge + 0.4, depth);
#ifndef LOW_Q
  float lap = 0.5 + 0.5 * sin(depth * 2.4 - uTime * 1.6 + fn * 6.0);
  float bandPos = 1.25 + fn2 * 0.9;
  float lapBand = (1.0 - smoothstep(0.0, 0.5, abs(depth - bandPos))) * lap;
  foam = max(foam, lapBand * 0.85);
#endif
  float crest = smoothstep(0.78, 0.94, vCrest) * smoothstep(0.42, 0.72, fn2);
  foam = max(foam, crest);
  foam = smoothstep(0.42, 0.58, foam);

  // Light dapple over sandy shallows.
  col += uFoamColor * (smoothstep(0.55, 0.78, fn2) * sandMix * 0.10);

  col = mix(col, uFoamColor, foam);
  col += uGlintColor * glint * (1.0 - foam * 0.85);

  // Slightly transparent near shore, opaque at depth; foam reads solid.
  float alpha = mix(0.55, 0.95, depthFac);
  alpha = clamp(alpha + fres * 0.25, 0.0, 1.0);
  alpha = max(alpha, foam * 0.96);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Water {
  constructor(game) {
    this.game = game;
    const terrain = game.terrain;
    const heightTex = terrain.heightTexture;
    const ud = heightTex.userData || {};
    const worldSize = ud.worldSize ?? terrain.size;
    const low = game.quality === 'low';

    this.uniforms = {
      uTime: { value: 0 },
      uHeightMap: { value: heightTex },
      uHeightMin: { value: ud.heightMin ?? -12 },
      uHeightSpan: { value: ud.heightSpan ?? 132 },
      uInvWorldSize: { value: 1 / worldSize },
      uWaterLevel: { value: terrain.waterLevel },
      uDeepColor: { value: COL.deepDay.clone() },
      uShallowColor: { value: COL.shallowDay.clone() },
      uSandColor: { value: COL.sandDay.clone() },
      uHorizonColor: { value: COL.horizonDay.clone() },
      uFoamColor: { value: COL.foamDay.clone() },
      uGlintColor: { value: COL.glintSun.clone() },
      uGlintDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uGlintStrength: { value: 1 },
      uNight: { value: 0 },
      // Fog uniforms (values refreshed by the renderer from scene.fog).
      fogColor: { value: new THREE.Color(0xffffff) },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
      fogDensity: { value: 0.00025 },
    };

    const defines = { OCTAVES: low ? 2 : 3 };
    if (low) defines.LOW_Q = 1;

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      defines,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      // Nudge water in front of any near-coplanar beach so it never z-fights.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const segs = low ? 96 : 192;
    const geometry = new THREE.PlaneGeometry(terrain.size, terrain.size, segs, segs);
    geometry.rotateX(-Math.PI / 2);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'water';
    // Tiny lift above the exact water level as extra z-fight insurance; depth
    // math still uses the true waterLevel.
    this.mesh.position.y = terrain.waterLevel + 0.02;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    // Vertex waves displace outside the flat bounding box — never cull, and
    // draw before other transparent objects (splashes, sparkles) blend on top.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    game.scene.add(this.mesh);
  }

  // `camera` is part of the contract signature; the shader reads the built-in
  // cameraPosition uniform, so no per-frame camera work is needed here.
  update(dt, camera) {
    const u = this.uniforms;
    u.uTime.value += dt;

    // Read (never write) the sky for time-of-day; be robust if it is absent.
    const sky = this.game.sky;
    let elev;
    if (sky && typeof sky.getSunDirection === 'function') {
      sky.getSunDirection(_sunDir);
      if (_sunDir.lengthSq() < 1e-8) _sunDir.set(-0.4, -0.8, -0.3);
      _sunDir.normalize();
      elev = -_sunDir.y; // sunDir points FROM sun TO world
    } else {
      const t = sky && typeof sky.timeOfDay === 'number' ? sky.timeOfDay : 0.4;
      const a = (t - 0.25) * TAU;
      elev = Math.sin(a);
      _sunDir.set(-Math.cos(a) * 0.6, -elev, -0.35).normalize();
    }

    const night = 1 - smoothstep(-0.18, 0.04, elev);
    const warm = clamp01(1 - Math.abs(elev) * 2.8) * (1 - night);
    const dayLift = smoothstep(-0.05, 0.3, elev);
    u.uNight.value = night;

    u.uDeepColor.value.copy(COL.deepDay).lerp(COL.deepNight, night);
    u.uShallowColor.value.copy(COL.shallowDay).lerp(COL.shallowNight, night);
    u.uSandColor.value.copy(COL.sandDay).lerp(COL.sandNight, night);
    u.uFoamColor.value.copy(COL.foamDay).lerp(COL.foamNight, night);

    // Horizon tint for the fresnel: track the sky's own fog color so the lake
    // melts into the horizon; fall back to a palette blend before fog exists.
    const fog = this.game.scene.fog;
    const hor = u.uHorizonColor.value;
    if (fog && fog.color) {
      hor.copy(fog.color).lerp(WHITE, 0.1 * dayLift);
    } else {
      hor.copy(COL.horizonDay).lerp(COL.horizonDusk, warm).lerp(COL.horizonNight, night);
    }

    // Glint light: warm sun streak by day, broad pale moon glow by night. The
    // moon sits opposite the sun; both fade to zero at the horizon so the
    // handover never pops.
    const sunVis = smoothstep(0.02, 0.18, elev);
    const moonVis = smoothstep(0.03, 0.24, -elev) * 0.8;
    if (sunVis >= moonVis) {
      u.uGlintDir.value.set(-_sunDir.x, -_sunDir.y, -_sunDir.z);
      u.uGlintStrength.value = sunVis;
      u.uGlintColor.value.copy(COL.glintSun).lerp(COL.glintDusk, warm);
    } else {
      u.uGlintDir.value.copy(_sunDir);
      u.uGlintStrength.value = moonVis;
      u.uGlintColor.value.copy(COL.glintMoon);
    }
  }
}
