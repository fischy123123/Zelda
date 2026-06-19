import * as THREE from 'three';

// A field of instanced grass blades that sway in the wind. Uses a single
// InstancedMesh (one draw call) with per-instance color, and injects a wind
// displacement into the standard material's vertex shader so it still receives
// scene lighting. Only blades on grassy, above-water ground are placed.
export class Grass {
  constructor(terrain, { count = 14000, radius = 130 } = {}) {
    this.terrain = terrain;

    // A tapered blade, base at y=0, ~1 unit tall, bent over 4 segments.
    const blade = new THREE.PlaneGeometry(0.14, 1.0, 1, 4);
    blade.translate(0, 0.5, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: false,
    });
    this._injectWind(mat);

    this.mesh = new THREE.InstancedMesh(blade, mat, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const grassMax = terrain.maxHeight * 0.5;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      // Reject spots that are underwater, too high (rocky), or off-map.
      let x, z, h, ok = false;
      for (let t = 0; t < 6; t++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        h = terrain.getHeightAt(x, z);
        if (h > terrain.seaLevel + 0.3 && h < grassMax) { ok = true; break; }
      }
      if (!ok) continue;

      dummy.position.set(x, h, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const sc = 0.6 + Math.random() * 0.9;
      dummy.scale.set(0.8 + Math.random() * 0.5, sc, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed, dummy.matrix);

      // Subtle green variation so the field isn't flat.
      const hue = 0.27 + Math.random() * 0.06;
      const light = 0.32 + Math.random() * 0.16;
      color.setHSL(hue, 0.55, light);
      this.mesh.setColorAt(placed, color);
      placed++;
    }
    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  _injectWind(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      mat.userData.shader = shader;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`
        #include <begin_vertex>
        float bladeH = position.y;                 // 0 at root, ~1 at tip
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float phase = wp.x * 0.35 + wp.z * 0.35;
        float gust = sin(uTime * 1.6 + phase) * 0.18
                   + sin(uTime * 0.7 + phase * 1.7) * 0.09;
        transformed.x += gust * bladeH * bladeH;
        transformed.z += cos(uTime * 1.2 + phase) * 0.10 * bladeH * bladeH;
        `
      );
    };
  }

  update(elapsed) {
    const shader = this.mesh.material.userData.shader;
    if (shader) shader.uniforms.uTime.value = elapsed;
  }
}
