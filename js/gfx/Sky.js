// Sky & atmosphere: a single-shader sky dome (day/night gradients, sun, moon,
// stars, drifting clouds), the sun DirectionalLight with shadows, hemisphere
// fill light, and scene fog — all keyframed across the day/night cycle.

import * as THREE from 'three';
import { clamp01, lerp, smoothstep } from '../util/math.js';
import { WORLD } from '../world/layout.js';

const _v = new THREE.Vector3();
const _sunWorld = new THREE.Vector3();

// --- time-of-day keyframes -------------------------------------------------
// t: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
const KEYS = [
  //  t     zenith    horizon   sunCol   sunI  hemiSky  hemiGnd  hemiI  fogCol   fogNear fogFar
  { t: 0.00, ze: 0x070a1c, ho: 0x101830, su: 0x8ea6d4, si: 0.14, hs: 0x1a2340, hg: 0x0c0f18, hi: 0.34, fo: 0x0d1326, fn: 60, ff: 520 },
  { t: 0.21, ze: 0x0a0f24, ho: 0x1c2340, su: 0x9db0d8, si: 0.12, hs: 0x202a4a, hg: 0x10131c, hi: 0.36, fo: 0x131a30, fn: 60, ff: 560 },
  { t: 0.25, ze: 0x35507e, ho: 0xffab66, su: 0xffb066, si: 0.85, hs: 0x6a7ba0, hg: 0x574a3c, hi: 0.5, fo: 0xe8b48c, fn: 70, ff: 700 },
  { t: 0.30, ze: 0x4a7cc0, ho: 0xffd9a0, su: 0xffd9a8, si: 1.1, hs: 0x8fa8cc, hg: 0x6b6a52, hi: 0.55, fo: 0xead8b8, fn: 90, ff: 850 },
  { t: 0.40, ze: 0x4f8fdc, ho: 0xcfe6f4, su: 0xfff2d0, si: 1.28, hs: 0xa8c4e0, hg: 0x77805c, hi: 0.6, fo: 0xd6e6ee, fn: 110, ff: 1000 },
  { t: 0.50, ze: 0x4487dd, ho: 0xc2e0f2, su: 0xfff6dc, si: 1.35, hs: 0xaccae4, hg: 0x7a8560, hi: 0.62, fo: 0xd2e4ee, fn: 120, ff: 1050 },
  { t: 0.60, ze: 0x4a86cf, ho: 0xc8ddec, su: 0xffedc2, si: 1.25, hs: 0xa4bedc, hg: 0x788058, hi: 0.6, fo: 0xd4e0e8, fn: 110, ff: 980 },
  { t: 0.70, ze: 0x3d5f9e, ho: 0xffc07a, su: 0xffc784, si: 1.0, hs: 0x8892b8, hg: 0x6a5f48, hi: 0.55, fo: 0xecc79a, fn: 90, ff: 820 },
  { t: 0.75, ze: 0x2c3a6a, ho: 0xff8f56, su: 0xff9558, si: 0.7, hs: 0x5d628e, hg: 0x4c4136, hi: 0.48, fo: 0xdd9a74, fn: 75, ff: 700 },
  { t: 0.80, ze: 0x121a3a, ho: 0x54406e, su: 0xc9a0b4, si: 0.24, hs: 0x2c3358, hg: 0x1c1a22, hi: 0.4, fo: 0x2c2c4c, fn: 65, ff: 580 },
  { t: 0.85, ze: 0x080c20, ho: 0x141c38, su: 0x93a8d2, si: 0.15, hs: 0x1c2544, hg: 0x0e111a, hi: 0.35, fo: 0x101728, fn: 60, ff: 530 },
  { t: 1.00, ze: 0x070a1c, ho: 0x101830, su: 0x8ea6d4, si: 0.14, hs: 0x1a2340, hg: 0x0c0f18, hi: 0.34, fo: 0x0d1326, fn: 60, ff: 520 },
];
// Pre-parse hex → Color once.
for (const k of KEYS) {
  k.zeC = new THREE.Color(k.ze); k.hoC = new THREE.Color(k.ho);
  k.suC = new THREE.Color(k.su); k.hsC = new THREE.Color(k.hs);
  k.hgC = new THREE.Color(k.hg); k.foC = new THREE.Color(k.fo);
}

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // pin to far plane
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith, uHorizon, uSunColor;
  uniform vec3 uSunDir;      // direction TOWARD the sun
  uniform float uTime, uStarAlpha, uCloudAmt, uCloudLight, uDuskGlow;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p = p * 2.13 + 17.1; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // Base gradient with a soft horizon band.
    float grad = smoothstep(-0.06, 0.55, h);
    vec3 col = mix(uHorizon, uZenith, grad);

    // Warm glow hugging the horizon around the sun's azimuth at dawn/dusk.
    float sunAmount = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * uDuskGlow * pow(sunAmount, 3.0) * (1.0 - grad) * 0.8;

    // Sun disc + halo.
    float disc = smoothstep(0.9994, 0.99975, sunAmount);
    float halo = pow(sunAmount, 180.0) * 0.5 + pow(sunAmount, 20.0) * 0.12;
    col += uSunColor * (disc * 1.6 + halo);

    // Moon: opposite the sun, crescent from an offset sphere mask.
    vec3 moonDir = -uSunDir;
    float mdot = max(dot(dir, moonDir), 0.0);
    float mdisc = smoothstep(0.99955, 0.99985, mdot);
    vec3 moonOff = normalize(moonDir + vec3(0.014, 0.008, 0.0));
    float bite = smoothstep(0.99958, 0.99988, max(dot(dir, moonOff), 0.0));
    float crescent = clamp(mdisc - bite * 0.85, 0.0, 1.0);
    col += vec3(0.92, 0.94, 1.0) * crescent * 1.15 * uStarAlpha;
    col += vec3(0.55, 0.62, 0.85) * pow(mdot, 160.0) * 0.25 * uStarAlpha;

    // Stars: hashed cells on the dome, twinkling.
    if (uStarAlpha > 0.001 && h > 0.02) {
      vec2 sp = dir.xz / (dir.y + 0.32);
      vec2 cell = floor(sp * 38.0);
      float star = hash21(cell);
      if (star > 0.93) {
        vec2 c = fract(sp * 38.0) - 0.5;
        float d = length(c - (vec2(hash21(cell + 7.0), hash21(cell + 13.0)) - 0.5) * 0.6);
        float tw = 0.7 + 0.3 * sin(uTime * (1.5 + star * 4.0) + star * 40.0);
        float s = smoothstep(0.09, 0.0, d) * tw;
        col += vec3(0.9, 0.93, 1.0) * s * uStarAlpha * smoothstep(0.02, 0.2, h);
      }
    }

    // Two drifting cloud layers, lit by the sun color.
    if (h > 0.015) {
      vec2 cuv = dir.xz / (h + 0.22);
      float c1 = fbm(cuv * 0.85 + vec2(uTime * 0.008, uTime * 0.0022));
      float c2 = fbm(cuv * 1.9 - vec2(uTime * 0.014, -uTime * 0.004) + 31.0);
      float clouds = smoothstep(0.52, 0.78, c1 * 0.65 + c2 * 0.45);
      clouds *= smoothstep(0.015, 0.14, h) * uCloudAmt;
      vec3 cloudCol = mix(uHorizon, vec3(1.0), 0.55) * uCloudLight;
      // Sun-kissed edges.
      cloudCol += uSunColor * pow(sunAmount, 6.0) * 0.35 * uCloudLight;
      col = mix(col, cloudCol, clouds * 0.82);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(game) {
    this.game = game;
    this.timeOfDay = 0.33;
    this.daySpeed = 1 / WORLD.dayLength;
    this.dayRolledOver = false;
    this.underground = false;
    this._clock = 0;

    // --- dome ---------------------------------------------------------------
    this._uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uStarAlpha: { value: 0 },
      uCloudAmt: { value: 0.9 },
      uCloudLight: { value: 1 },
      uDuskGlow: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1000, 32, 18),
      new THREE.ShaderMaterial({
        uniforms: this._uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    game.scene.add(this.dome);

    // --- lights -------------------------------------------------------------
    this.sunLight = new THREE.DirectionalLight(0xfff2d0, 1.2);
    this.sunLight.castShadow = true;
    const sm = game.quality === 'low' ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(sm, sm);
    const cam = this.sunLight.shadow.camera;
    cam.left = -48; cam.right = 48; cam.top = 48; cam.bottom = -48;
    cam.near = 1; cam.far = 320;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.5;
    game.scene.add(this.sunLight);
    game.scene.add(this.sunLight.target);

    this.hemi = new THREE.HemisphereLight(0xaccae4, 0x7a8560, 0.6);
    game.scene.add(this.hemi);

    game.scene.fog = new THREE.Fog(0xd2e4ee, 120, 1050);

    this._dirToSun = new THREE.Vector3(0, 1, 0);
    this._lightDir = new THREE.Vector3(0, 1, 0); // sun by day, moon by night
    this._savedFog = { color: new THREE.Color(), near: 0, far: 0 };
    this._apply();
  }

  // -------------------------------------------------------------------------
  get isNight() { return this.timeOfDay < 0.23 || this.timeOfDay > 0.77; }

  setTimeOfDay(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    this._apply();
  }

  /** Direction FROM the sun TOWARD the world (i.e. light travel direction). */
  getSunDirection(out = new THREE.Vector3()) {
    return out.copy(this._dirToSun).negate();
  }

  getSunScreenPos(camera) {
    _sunWorld.copy(camera.position).addScaledVector(this._dirToSun, 200);
    _v.copy(_sunWorld).project(camera);
    const visible = _v.z < 1 && _v.x > -1.3 && _v.x < 1.3 && _v.y > -1.3 && _v.y < 1.3 &&
      this._dirToSun.y > -0.05 && !this.underground;
    return { x: (_v.x + 1) / 2, y: (_v.y + 1) / 2, visible };
  }

  setUnderground(on) {
    if (on === this.underground) return;
    this.underground = on;
    const fog = this.game.scene.fog;
    if (on) {
      this._savedFog.color.copy(fog.color);
      this._savedFog.near = fog.near; this._savedFog.far = fog.far;
      this.dome.visible = false;
      this.sunLight.intensity = 0;
      this.sunLight.castShadow = false;
      this.hemi.color.set(0x3a2e22);
      this.hemi.groundColor.set(0x14100c);
      this.hemi.intensity = 0.5;
      fog.color.set(0x080604);
      fog.near = 8; fog.far = 90;
    } else {
      this.dome.visible = true;
      this.sunLight.castShadow = true;
      this._apply();
    }
  }

  update(dt, playerPos) {
    this.dayRolledOver = false;
    this._clock += dt;
    this.timeOfDay += dt * this.daySpeed;
    if (this.timeOfDay >= 1) {
      this.timeOfDay -= 1;
      this.dayRolledOver = true;
    }
    this._uniforms.uTime.value = this._clock;
    if (!this.underground) this._apply();

    // Dome + shadow frustum chase the viewer.
    this.dome.position.copy(this.game.camera.position);
    if (playerPos) {
      this.sunLight.position.copy(playerPos).addScaledVector(this._lightDir, 140);
      this.sunLight.target.position.copy(playerPos);
    }
  }

  // -------------------------------------------------------------------------
  _apply() {
    const t = this.timeOfDay;

    // Sun path: rises east (+X) at 0.25, sets west at 0.75, tilted south.
    const a = (t - 0.25) * Math.PI * 2;
    this._dirToSun.set(Math.cos(a), Math.sin(a), 0.28).normalize();
    // At night, light the world faintly from the moon (opposite side).
    const sunUp = this._dirToSun.y > -0.06;

    // Find keyframe span.
    let k0 = KEYS[0], k1 = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { k0 = KEYS[i]; k1 = KEYS[i + 1]; break; }
    }
    const f = k1.t === k0.t ? 0 : clamp01((t - k0.t) / (k1.t - k0.t));

    const u = this._uniforms;
    u.uZenith.value.copy(k0.zeC).lerp(k1.zeC, f);
    u.uHorizon.value.copy(k0.hoC).lerp(k1.hoC, f);
    u.uSunColor.value.copy(k0.suC).lerp(k1.suC, f);
    u.uSunDir.value.copy(this._dirToSun);

    const night = this.isNight ? 1 : 0;
    const nightBlend = smoothstep(0.78, 0.83, t) + (1 - smoothstep(0.2, 0.25, t));
    u.uStarAlpha.value = clamp01(nightBlend);
    u.uCloudLight.value = lerp(1, 0.16, clamp01(nightBlend));
    // Dusk/dawn horizon glow strength.
    const dawn = 1 - clamp01(Math.abs(t - 0.25) / 0.07);
    const dusk = 1 - clamp01(Math.abs(t - 0.75) / 0.07);
    u.uDuskGlow.value = Math.max(dawn, dusk);

    // Lights.
    const si = lerp(k0.si, k1.si, f);
    this.sunLight.color.copy(u.uSunColor.value);
    this.sunLight.intensity = si;
    if (sunUp) {
      this._lightDir.copy(this._dirToSun);
    } else {
      // Moonlight: flip to the moon's side, cool tint.
      this._lightDir.copy(this._dirToSun).negate();
      this.sunLight.color.set(0x9db4e8);
    }
    this.hemi.color.copy(k0.hsC).lerp(k1.hsC, f);
    this.hemi.groundColor.copy(k0.hgC).lerp(k1.hgC, f);
    this.hemi.intensity = lerp(k0.hi, k1.hi, f);

    // Fog.
    const fog = this.game.scene.fog;
    fog.color.copy(k0.foC).lerp(k1.foC, f);
    fog.near = lerp(k0.fn, k1.fn, f);
    fog.far = lerp(k0.ff, k1.ff, f);
    void night;
  }
}
