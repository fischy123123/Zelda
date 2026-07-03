import * as THREE from 'three';

// Dynamic sky with a full day/night cycle: gradient dome + sun disc shader,
// stars and a moon at night, dusk glow at the horizon, and matched sun/moon
// lighting. setTime(frac) drives everything (frac 0..1, 0 = dawn).
const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 sky = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
    vec3 col = mix(sky, groundColor, smoothstep(0.0, -0.18, h));
    float s = max(dot(dir, normalize(sunDir)), 0.0);
    col += sunColor * pow(s, 1200.0) * 6.0;
    col += sunColor * pow(s, 14.0) * 0.55;
    col += sunColor * pow(s, 4.0) * 0.12;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const DAY_TOP = new THREE.Color(0x3a7bd0);
const DAY_HOR = new THREE.Color(0xcfe4f5);
const DAY_SUN = new THREE.Color(0xffe9b8);
const NIGHT_TOP = new THREE.Color(0x070b1c);
const NIGHT_HOR = new THREE.Color(0x1c2440);
const NIGHT_SUN = new THREE.Color(0xcfdcff);
const DUSK_HOR = new THREE.Color(0xff9a4a);
const DUSK_SUN = new THREE.Color(0xffb060);
const LIGHT_DAY = new THREE.Color(0xffe6b0);
const LIGHT_MOON = new THREE.Color(0xa8bcf0);

export class SkyEnv {
  constructor(renderer, { shadowMapSize = 4096 } = {}) {
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.35).normalize();
    this.lightDir = this.sunDir.clone();
    this.dayFactor = 1;
    this.fogColor = DAY_HOR.clone();
    this._top = new THREE.Color();
    this._hor = new THREE.Color();
    this._sun = new THREE.Color();

    // ---- Sky dome ----
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: DAY_TOP.clone() },
        horizonColor: { value: DAY_HOR.clone() },
        groundColor: { value: new THREE.Color(0x8f9a64) },
        sunColor: { value: DAY_SUN.clone() },
        sunDir: { value: this.sunDir.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.scale.setScalar(480);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;

    // ---- Stars (visible at night) ----
    const starN = 650;
    const sp = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.06 + Math.random() * 0.92;
      const r = Math.sqrt(Math.max(0, 1 - y * y)) * 0.985;
      sp[i * 3] = Math.cos(a) * r;
      sp[i * 3 + 1] = y;
      sp[i * 3 + 2] = Math.sin(a) * r;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sgeo, new THREE.PointsMaterial({
      color: 0xd8e4ff, size: 1.7, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.stars.frustumCulled = false;
    this.mesh.add(this.stars);

    // ---- Moon ----
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xe8eeff, transparent: true, opacity: 0, fog: false })
    );
    this.mesh.add(this.moon);

    // ---- Lights ----
    this.sun = new THREE.DirectionalLight(LIGHT_DAY, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const s = 70;
    const cam = this.sun.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 1; cam.far = 320;
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.025;

    this.hemi = new THREE.HemisphereLight(0xcfe4f5, 0x8f9a64, 0.65);
    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.3);
    this.fill.position.set(-40, 30, -40);

    // Bake the environment map from a mid-morning sky (static; reflections
    // staying "daylike" at night is a fine tradeoff for zero per-frame cost).
    this.setTime(0.3);
    this.environment = this._bakeEnvironment(renderer);
  }

  _bakeEnvironment(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const tmp = new THREE.Scene();
    const domeGeo = new THREE.SphereGeometry(1, 32, 16);
    const dome = new THREE.Mesh(domeGeo, this.material.clone());
    dome.scale.setScalar(10);
    tmp.add(dome);
    const rt = pmrem.fromScene(tmp, 0.04);
    domeGeo.dispose();
    pmrem.dispose();
    return rt.texture;
  }

  // Drive the whole sky + lighting from a 0..1 day fraction (0 = dawn).
  setTime(frac) {
    const a = frac * Math.PI * 2;
    const elev = Math.sin(a);
    const cosA = Math.cos(a);
    this.sunDir.set(cosA * 0.9, elev, 0.35).normalize();

    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
    this.dayFactor = day;
    const duskGlow = Math.max(0, 1 - Math.abs(elev) * 2.8) * (0.25 + 0.75 * day);

    this._top.copy(NIGHT_TOP).lerp(DAY_TOP, day);
    this._hor.copy(NIGHT_HOR).lerp(DAY_HOR, day).lerp(DUSK_HOR, duskGlow * 0.8);
    this._sun.copy(NIGHT_SUN).lerp(DAY_SUN, day).lerp(DUSK_SUN, duskGlow * 0.6);

    const u = this.material.uniforms;
    u.topColor.value.copy(this._top);
    u.horizonColor.value.copy(this._hor);
    u.sunColor.value.copy(this._sun);
    u.sunDir.value.copy(this.sunDir);
    this.fogColor.copy(this._hor);

    // Light from the sun by day, from the moon (opposite point) by night.
    const night = 1 - day;
    if (elev >= -0.04) this.lightDir.copy(this.sunDir);
    else this.lightDir.set(-cosA * 0.9, -elev, -0.35).normalize();
    this.sun.intensity = 0.14 + 2.45 * day;
    this.sun.color.copy(LIGHT_MOON).lerp(LIGHT_DAY, day);
    this.hemi.intensity = 0.13 + 0.55 * day;
    this.fill.intensity = 0.06 + 0.26 * day;

    this.stars.material.opacity = night * 0.9;
    this.moon.material.opacity = night;
    this.moon.position.copy(this.lightDir).multiplyScalar(0.93);
  }

  // Keep the dome centered on the viewer and the shadow frustum on the action.
  follow(pos) {
    this.mesh.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(this.lightDir, 120);
    this.sun.target.position.copy(pos);
  }
}
