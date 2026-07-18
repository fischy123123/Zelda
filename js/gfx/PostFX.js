// Hand-rolled post-processing: scene → bright-pass → separable blur → final
// composite (bloom + god rays + color grade + vignette + grain + hit flashes).
// No three/examples imports; bulletproof fallback to a plain render.

import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float uThreshold;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = smoothstep(uThreshold, uThreshold + 0.35, lum);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tInput;
  uniform vec2 uDir; // (1/w, 0) or (0, 1/h)
  void main() {
    vec3 s = texture2D(tInput, vUv).rgb * 0.227027;
    vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692308;
    s += (texture2D(tInput, vUv + o1).rgb + texture2D(tInput, vUv - o1).rgb) * 0.3162162162;
    s += (texture2D(tInput, vUv + o2).rgb + texture2D(tInput, vUv - o2).rgb) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tBloom;
  uniform vec2 uSunPos;
  uniform float uGodray, uTime, uFlashRed, uFlashGold, uDesat, uBloomAmt;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 col = texture2D(tScene, vUv).rgb;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    col += bloom * uBloomAmt;

    // God rays: march the blurred bright buffer toward the sun.
    if (uGodray > 0.001) {
      vec2 delta = (uSunPos - vUv) / 14.0;
      vec2 p = vUv;
      float decay = 1.0, sum = 0.0;
      for (int i = 0; i < 14; i++) {
        p += delta;
        float b = dot(texture2D(tBloom, p).rgb, vec3(0.333));
        sum += b * decay;
        decay *= 0.93;
      }
      float dist = length((vUv - uSunPos) * vec2(1.6, 1.0));
      col += vec3(1.0, 0.88, 0.62) * sum * uGodray * 0.05 * smoothstep(1.35, 0.15, dist);
    }

    // Color grade: gentle S-curve, warm highlights, teal shadows, +sat.
    col = clamp(col, 0.0, 1.0);
    col = col * col * (3.0 - 2.0 * col) * 0.55 + col * 0.45;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += (vec3(1.0, 0.95, 0.82) - 1.0) * lum * lum * 0.28;         // warm highs
    col += (vec3(0.86, 0.98, 1.02) - 1.0) * (1.0 - lum) * 0.10;      // cool lows
    col = mix(vec3(lum), col, 1.08 * (1.0 - uDesat * 0.7));          // saturation

    // Damage / heal flashes.
    float edge = distance(vUv, vec2(0.5));
    col = mix(col, vec3(0.75, 0.06, 0.05), uFlashRed * smoothstep(0.25, 0.75, edge));
    col += vec3(1.0, 0.85, 0.45) * uFlashGold * 0.25 * (1.0 - edge);

    // Vignette + film grain.
    col *= 1.0 - smoothstep(0.55, 0.95, edge) * 0.32;
    col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 43.0) - 0.5) * 0.015;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostFX {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.enabled = true;
    this._failed = false;
    this._flashRed = 0;
    this._flashGold = 0;
    this._desat = 0;
    this._time = 0;

    const mk = (frag, extra = {}) => new THREE.ShaderMaterial({
      uniforms: extra,
      vertexShader: QUAD_VERT,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this._brightMat = mk(BRIGHT_FRAG, {
      tScene: { value: null }, uThreshold: { value: 0.72 },
    });
    this._blurMat = mk(BLUR_FRAG, {
      tInput: { value: null }, uDir: { value: new THREE.Vector2(1, 0) },
    });
    this._compMat = mk(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null },
      uSunPos: { value: new THREE.Vector2(0.5, 0.8) },
      uGodray: { value: 0 }, uTime: { value: 0 },
      uFlashRed: { value: 0 }, uFlashGold: { value: 0 },
      uDesat: { value: 0 }, uBloomAmt: { value: 0.85 },
    });

    // Fullscreen triangle.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this._quad = new THREE.Mesh(geo, this._compMat);
    this._quad.frustumCulled = false;
    this._fsScene = new THREE.Scene();
    this._fsScene.add(this._quad);
    this._fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._makeTargets();

    game.events.on('player:damage', () => { this._flashRed = 0.85; });
    game.events.on('player:heal', () => { this._flashGold = 0.8; });
    game.events.on('boss:start', () => { this._desat = 1; });
  }

  _makeTargets() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(4, size.x), h = Math.max(4, size.y);
    const low = this.game.quality === 'low';
    const opts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this._rtScene?.dispose();
    this._rtBright?.dispose();
    this._rtA?.dispose();
    this._rtB?.dispose();
    this._rtScene = new THREE.WebGLRenderTarget(w, h, opts);
    const bw = Math.max(2, Math.floor(w / (low ? 4 : 2)));
    const bh = Math.max(2, Math.floor(h / (low ? 4 : 2)));
    const bopts = { ...opts, depthBuffer: false };
    this._rtBright = new THREE.WebGLRenderTarget(bw, bh, bopts);
    this._rtA = new THREE.WebGLRenderTarget(bw, bh, bopts);
    this._rtB = new THREE.WebGLRenderTarget(bw, bh, bopts);
    this._blurTexel = { x: 1 / bw, y: 1 / bh };
  }

  setSize() { if (!this._failed) this._makeTargets(); }

  // -------------------------------------------------------------------------
  render(rawDt) {
    const g = this.game;
    this._time += rawDt;
    this._flashRed = Math.max(0, this._flashRed - rawDt * 2.2);
    this._flashGold = Math.max(0, this._flashGold - rawDt * 1.6);
    this._desat = Math.max(0, this._desat - rawDt * 0.8);

    if (this._failed || !this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(g.scene, g.camera);
      return;
    }

    try {
      const r = this.renderer;

      // 1) Scene into HDR-ish target.
      r.setRenderTarget(this._rtScene);
      r.render(g.scene, g.camera);

      // 2) Bright pass at reduced res.
      this._quad.material = this._brightMat;
      this._brightMat.uniforms.tScene.value = this._rtScene.texture;
      r.setRenderTarget(this._rtBright);
      r.render(this._fsScene, this._fsCam);

      // 3) Separable blur ×2.
      this._quad.material = this._blurMat;
      let src = this._rtBright;
      for (let i = 0; i < 2; i++) {
        this._blurMat.uniforms.tInput.value = src.texture;
        this._blurMat.uniforms.uDir.value.set(this._blurTexel.x * (i + 1), 0);
        r.setRenderTarget(this._rtA);
        r.render(this._fsScene, this._fsCam);
        this._blurMat.uniforms.tInput.value = this._rtA.texture;
        this._blurMat.uniforms.uDir.value.set(0, this._blurTexel.y * (i + 1));
        r.setRenderTarget(this._rtB);
        r.render(this._fsScene, this._fsCam);
        src = this._rtB;
      }

      // 4) Composite to screen.
      const u = this._compMat.uniforms;
      u.tScene.value = this._rtScene.texture;
      u.tBloom.value = this._rtB.texture;
      u.uTime.value = this._time;
      u.uFlashRed.value = this._flashRed;
      u.uFlashGold.value = this._flashGold;
      u.uDesat.value = this._desat;

      let godray = 0;
      if (g.quality !== 'low' && g.sky && !g.inDungeon) {
        const sp = g.sky.getSunScreenPos(g.camera);
        if (sp.visible && !g.sky.isNight) {
          u.uSunPos.value.set(sp.x, sp.y);
          godray = 1;
        }
      }
      u.uGodray.value = godray;

      this._quad.material = this._compMat;
      r.setRenderTarget(null);
      r.render(this._fsScene, this._fsCam);
    } catch (err) {
      console.warn('[postfx] pipeline failed, falling back to plain render', err);
      this._failed = true;
      this.renderer.setRenderTarget(null);
      this.renderer.render(g.scene, g.camera);
    }
  }
}
