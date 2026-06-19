import * as THREE from 'three';

// Soft, additive glowing motes (pollen by day / fireflies at dusk) that drift
// around the player. They bloom in the post pipeline for a magical atmosphere.
export class Fireflies {
  constructor({ count = 220, radius = 60, color = 0xfff1a8 } = {}) {
    this.radius = radius;
    const positions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * radius * 2;
      positions[i * 3 + 1] = 1 + Math.random() * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const sprite = makeGlowTexture(color);
    const mat = new THREE.PointsMaterial({
      size: 0.5,
      map: sprite,
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this._center = new THREE.Vector3();
  }

  update(elapsed, center) {
    if (center) this._center.copy(center);
    this.points.position.set(this._center.x, 0, this._center.z);
    const pos = this.points.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ph = this.phases[i];
      pos.setY(i, 2.5 + Math.sin(elapsed * 0.6 + ph) * 2.0 + 2.0);
      pos.setX(i, pos.getX(i) + Math.sin(elapsed * 0.3 + ph) * 0.01);
    }
    pos.needsUpdate = true;
  }
}

// Big soft billboarded clouds drifting across the sky.
export class Clouds {
  constructor({ count = 14 } = {}) {
    this.group = new THREE.Group();
    const tex = makeCloudTexture();
    this.sprites = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.55 + Math.random() * 0.25,
        depthWrite: false,
        fog: false,
      });
      const s = new THREE.Sprite(mat);
      const scale = 60 + Math.random() * 90;
      s.scale.set(scale, scale * 0.55, 1);
      s.position.set(
        (Math.random() - 0.5) * 600,
        70 + Math.random() * 50,
        (Math.random() - 0.5) * 600
      );
      s.userData.speed = 1.5 + Math.random() * 2.5;
      this.group.add(s);
      this.sprites.push(s);
    }
  }

  update(dt) {
    for (const s of this.sprites) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > 320) s.position.x = -320;
    }
  }
}

function makeGlowTexture(color) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const col = new THREE.Color(color);
  const rgb = `${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0}`;
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.3, `rgba(${rgb},0.6)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCloudTexture() {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // Stack a few soft radial puffs into a fluffy cloud shape.
  for (let i = 0; i < 18; i++) {
    const x = w * (0.2 + Math.random() * 0.6);
    const y = h * (0.4 + Math.random() * 0.3);
    const r = 18 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
