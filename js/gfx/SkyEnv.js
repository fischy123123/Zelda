import * as THREE from 'three';

// A stylized gradient sky dome with a soft glowing sun, plus the matching sun
// (directional) and sky (hemisphere) lights and a PMREM environment map for
// subtle reflections on water, metal, and gems.
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
    // Sky gradient from horizon to zenith, with a hazy ground band below.
    vec3 sky = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55));
    vec3 col = mix(sky, groundColor, smoothstep(0.0, -0.18, h));
    // Sun disc + soft halo.
    float s = max(dot(dir, normalize(sunDir)), 0.0);
    col += sunColor * pow(s, 1200.0) * 6.0;   // crisp disc
    col += sunColor * pow(s, 14.0) * 0.55;    // inner glow
    col += sunColor * pow(s, 4.0) * 0.12;     // wide haze
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class SkyEnv {
  constructor(renderer, {
    elevationDeg = 26,
    azimuthDeg = 135,
    topColor = 0x2a6cd6,
    horizonColor = 0xcfe8ff,
    groundColor = 0x9fb88a,
    sunColor = 0xfff3d0,
  } = {}) {
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - elevationDeg),
      THREE.MathUtils.degToRad(azimuthDeg)
    );

    // ---- Sky dome ----
    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(topColor) },
        horizonColor: { value: new THREE.Color(horizonColor) },
        groundColor: { value: new THREE.Color(groundColor) },
        sunColor: { value: new THREE.Color(sunColor) },
        sunDir: { value: this.sunDir.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(480); // inside camera far; reposition to follow view
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;

    // ---- Lights matched to the sky ----
    this.sun = new THREE.DirectionalLight(0xfff1d4, 2.4);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    const cam = this.sun.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 1; cam.far = 320;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;

    this.hemi = new THREE.HemisphereLight(horizonColor, groundColor, 0.65);
    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.35); // cool sky fill
    this.fill.position.set(-this.sunDir.x, 0.5, -this.sunDir.z).multiplyScalar(80);

    // ---- Environment map for reflections ----
    this.environment = this._bakeEnvironment(renderer);

    // Fog colour that matches the horizon so distance fades naturally.
    this.fogColor = new THREE.Color(horizonColor);
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

  // Keep the dome centered on the viewer so its edge is never reached.
  follow(pos) {
    this.mesh.position.copy(pos);
    this.sun.position.copy(pos).addScaledVector(this.sunDir, 120);
    this.sun.target.position.copy(pos);
  }
}
