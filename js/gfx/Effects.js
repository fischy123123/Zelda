import * as THREE from 'three';

// Combat "juice": spark-particle bursts and trauma-based camera shake.
let _tex = null;
function glowTex() {
  if (_tex) return _tex;
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _tex = new THREE.CanvasTexture(c);
  _tex.colorSpace = THREE.SRGBColorSpace;
  return _tex;
}

export class Particles {
  constructor(scene, poolSize = 80) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pool = [];
    this._mats = new Map();
    for (let i = 0; i < poolSize; i++) {
      const sp = new THREE.Sprite(this._mat(0xffe08a));
      sp.visible = false;
      this.group.add(sp);
      this.pool.push({ sp, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.3 });
    }
  }

  _mat(color) {
    if (!this._mats.has(color)) {
      this._mats.set(color, new THREE.SpriteMaterial({
        map: glowTex(), color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }));
    }
    return this._mats.get(color);
  }

  burst(pos, color = 0xffe08a, count = 10, speed = 5, life = 0.5, size = 0.32) {
    const mat = this._mat(color);
    let spawned = 0;
    for (const p of this.pool) {
      if (spawned >= count) break;
      if (p.life > 0) continue;
      p.sp.material = mat;
      p.sp.position.copy(pos);
      p.sp.visible = true;
      p.vel.set(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5)
        .normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      p.life = p.max = life * (0.7 + Math.random() * 0.6);
      p.size = size;
      spawned++;
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      p.sp.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - 3.2 * dt));
      p.vel.y += 1.6 * dt; // sparks drift up
      const k = p.life / p.max;
      p.sp.scale.setScalar(p.size * (0.4 + k));
    }
  }
}

// Camera shake with quadratic falloff — small hits feel snappy, big ones thump.
export class Shake {
  constructor() { this.trauma = 0; }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt, camera) {
    if (this.trauma <= 0) return;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const m = this.trauma * this.trauma * 0.35;
    camera.position.x += (Math.random() - 0.5) * m;
    camera.position.y += (Math.random() - 0.5) * m;
    camera.position.z += (Math.random() - 0.5) * m;
  }
}
