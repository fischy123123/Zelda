// Pooled particle system + ambient atmosphere (fireflies, leaves, embers,
// pollen). Two THREE.Points batches — additive glows and normal-blended
// motes — updated on the CPU with zero steady-state allocations.

import * as THREE from 'three';
import { clamp01 } from '../util/math.js';

const CAP_ADD = 900;   // additive glow particles
const CAP_NRM = 500;   // normal-blend motes/debris

function makeSpriteTexture(hard) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  if (hard) {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class Batch {
  constructor(scene, capacity, additive) {
    this.cap = capacity;
    this.count = 0;
    // Struct-of-arrays particle store.
    this.px = new Float32Array(capacity); this.py = new Float32Array(capacity); this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity); this.vy = new Float32Array(capacity); this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity); this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity); this.size1 = new Float32Array(capacity);
    this.cr = new Float32Array(capacity); this.cg = new Float32Array(capacity); this.cb = new Float32Array(capacity);
    this.grav = new Float32Array(capacity); this.drag = new Float32Array(capacity);
    this.flick = new Float32Array(capacity); // >0: twinkle frequency
    this.sway = new Float32Array(capacity);  // >0: horizontal sine sway

    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('color', this.aCol);
    this.geo.setAttribute('size', this.aSize);
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: makeSpriteTexture(!additive) } },
      vertexShader: /* glsl */`
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (280.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(tMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this._time = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, grav = 0, drag = 0, flick = 0, sway = 0) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0; // recycle randomly when full
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b;
    this.grav[i] = grav; this.drag[i] = drag;
    this.flick[i] = flick; this.sway[i] = sway;
    return i;
  }

  update(dt) {
    this._time += dt;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-with-last compaction.
        n--;
        if (i !== n) {
          for (const a of ['px','py','pz','vx','vy','vz','life','maxLife','size0','size1','cr','cg','cb','grav','drag','flick','sway']) {
            this[a][i] = this[a][n];
          }
          i--;
        }
        continue;
      }
      const d = this.drag[i] > 0 ? Math.max(0, 1 - this.drag[i] * dt) : 1;
      this.vx[i] *= d; this.vz[i] *= d; this.vy[i] *= d;
      this.vy[i] += this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.sway[i] > 0) {
        this.px[i] += Math.sin(this._time * 2.1 + i * 1.7) * this.sway[i] * dt;
        this.pz[i] += Math.cos(this._time * 1.7 + i * 2.3) * this.sway[i] * dt;
      }
    }
    this.count = n;

    // Write GPU buffers.
    const t = clamp01;
    for (let i = 0; i < n; i++) {
      const f = 1 - this.life[i] / this.maxLife[i];
      this.aPos.array[i * 3] = this.px[i];
      this.aPos.array[i * 3 + 1] = this.py[i];
      this.aPos.array[i * 3 + 2] = this.pz[i];
      let alpha = f < 0.15 ? f / 0.15 : 1 - t((f - 0.15) / 0.85);
      if (this.flick[i] > 0) alpha *= 0.55 + 0.45 * Math.sin(this._time * this.flick[i] + i * 3.1);
      this.aCol.array[i * 3] = this.cr[i] * alpha;
      this.aCol.array[i * 3 + 1] = this.cg[i] * alpha;
      this.aCol.array[i * 3 + 2] = this.cb[i] * alpha;
      this.aSize.array[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * f;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.geo.setDrawRange(0, n);
  }
}

export class Particles {
  constructor(game) {
    this.game = game;
    this.add = new Batch(game.scene, CAP_ADD, true);
    this.nrm = new Batch(game.scene, CAP_NRM, false);
    this._ambientTimer = 0;
    this._biomeTimer = 0;
    this._biome = null;
    this._col = new THREE.Color();

    const ev = game.events;
    ev.on('combat:hit', (e) => {
      this.emit('hit', e.pos, { big: !!e.crit });
      this.emit('slash', e.pos);
      if (e.died) this.emit('death', e.pos);
    });
    ev.on('enemy:death', (e) => this.emit('death', e.pos));
    ev.on('player:step', (e) => {
      if (e.sprint || e.biome === 'badland') this.emit('dust', e.pos);
    });
    ev.on('player:land', (e) => this.emit('dust', this.game.player.position, { big: e.hard }));
    ev.on('player:roll', (e) => this.emit('dust', e.pos));
    ev.on('player:jump', (e) => this.emit('dust', e.pos));
    ev.on('player:block', (e) => this.emit('hit', e.pos, { color: 0xffe9a8 }));
    ev.on('player:heal', () => this.emit('heal', this.game.player.position));
    ev.on('pickup', (e) => this.emit('sparkle', e.pos));
    ev.on('chest:open', (e) => {
      const c = this.game.world?.chests?.find?.((x) => x.id === e.id);
      const pos = c ? c.group.position : this.game.player.position;
      this.emit('explosion', pos, { color: 0xffd97a, soft: true });
    });
    ev.on('projectile:pop', (e) => this.emit('poof', e.pos, { color: e.color }));
  }

  // -------------------------------------------------------------------------
  emit(type, pos, opts = {}) {
    const x = pos.x, y = pos.y, z = pos.z;
    const col = this._col;
    const R = (s) => (Math.random() - 0.5) * 2 * s;
    switch (type) {
      case 'hit': {
        col.set(opts.color ?? 0xfff4c2);
        const n = opts.big ? 18 : 10;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5;
          this.add.spawn(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 4, Math.sin(a) * sp,
            0.28 + Math.random() * 0.2, 0.55, 0.05, col.r, col.g, col.b, -14, 2);
        }
        break;
      }
      case 'slash':
        for (let i = 0; i < 6; i++) {
          this.add.spawn(x + R(0.4), y + R(0.3), z + R(0.4), R(1.5), 1.5 + Math.random() * 2, R(1.5),
            0.22, 0.85, 0.1, 1, 1, 1, 0, 3);
        }
        break;
      case 'death': {
        for (let i = 0; i < 14; i++) {
          this.nrm.spawn(x + R(0.5), y + R(0.5), z + R(0.5), R(2.2), 1 + Math.random() * 2.5, R(2.2),
            0.5 + Math.random() * 0.3, 0.7, 1.4, 0.16, 0.13, 0.2, -3, 1.2);
        }
        for (let i = 0; i < 8; i++) { // rising soul motes
          this.add.spawn(x + R(0.5), y + 0.3, z + R(0.5), R(0.4), 1.6 + Math.random() * 1.4, R(0.4),
            1 + Math.random() * 0.7, 0.3, 0.05, 0.6, 0.85, 1, 0, 0, 6);
        }
        break;
      }
      case 'soul':
        this.add.spawn(x, y, z, R(0.3), 1.8, R(0.3), 1.2, 0.35, 0.05, 0.6, 0.85, 1, 0, 0, 6);
        break;
      case 'sparkle': {
        col.set(opts.color ?? 0xaef2c0);
        for (let i = 0; i < 8; i++) {
          this.add.spawn(x + R(0.3), y + R(0.3), z + R(0.3), R(1.2), 1 + Math.random() * 2, R(1.2),
            0.4 + Math.random() * 0.25, 0.4, 0.03, col.r, col.g, col.b, 0, 1, 12);
        }
        break;
      }
      case 'dust': {
        const n = opts.big ? 12 : 5;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * (opts.big ? 3 : 1.4);
          this.nrm.spawn(x + R(0.3), y + 0.12, z + R(0.3), Math.cos(a) * sp, 0.5 + Math.random(), Math.sin(a) * sp,
            0.45 + Math.random() * 0.3, 0.5, 1.3, 0.62, 0.55, 0.44, -1.2, 2.4);
        }
        break;
      }
      case 'heal':
        for (let i = 0; i < 12; i++) {
          this.add.spawn(x + R(0.6), y + 0.2 + Math.random() * 0.8, z + R(0.6), R(0.3), 1 + Math.random() * 1.2, R(0.3),
            0.9 + Math.random() * 0.4, 0.35, 0.06, 0.55, 1, 0.55, 0, 0, 8);
        }
        break;
      case 'leaf':
        this.nrm.spawn(x, y, z, R(0.6), -0.5 - Math.random() * 0.5, R(0.6),
          3 + Math.random() * 2, 0.28, 0.24, 0.32, 0.55, 0.2, -0.35, 0.6, 0, 1.4);
        break;
      case 'splash':
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.4;
          this.add.spawn(x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3,
            Math.cos(a) * sp, 2 + Math.random() * 2.5, Math.sin(a) * sp,
            0.5, 0.3, 0.06, 0.65, 0.85, 0.95, -9, 0.5);
        }
        break;
      case 'ember':
        this.add.spawn(x, y, z, R(0.4), 0.8 + Math.random() * 1.2, R(0.4),
          1.2 + Math.random(), 0.22, 0.03, 1, 0.5, 0.15, 0.3, 0.6, 9, 0.8);
        break;
      case 'poof': {
        col.set(opts.color ?? 0xcccccc);
        for (let i = 0; i < 8; i++) {
          this.add.spawn(x + R(0.2), y + R(0.2), z + R(0.2), R(2), R(2), R(2),
            0.3 + Math.random() * 0.2, 0.4, 0.9, col.r, col.g, col.b, 0, 3);
        }
        break;
      }
      case 'explosion': {
        col.set(opts.color ?? 0xffa94c);
        const n = opts.soft ? 16 : 26;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const el = Math.random() * Math.PI - Math.PI / 2;
          const sp = (opts.soft ? 2.5 : 5) + Math.random() * 4;
          this.add.spawn(x, y + 0.4, z,
            Math.cos(a) * Math.cos(el) * sp, Math.abs(Math.sin(el)) * sp + 1.5, Math.sin(a) * Math.cos(el) * sp,
            0.5 + Math.random() * 0.4, 0.7, 0.08, col.r, col.g, col.b, -6, 1.6);
        }
        if (!opts.soft) {
          for (let i = 0; i < 10; i++) {
            this.nrm.spawn(x + R(0.4), y + 0.3, z + R(0.4), R(4), 2 + Math.random() * 3, R(4),
              0.7, 0.5, 1.6, 0.25, 0.2, 0.16, -8, 1);
          }
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  update(rawDt) {
    const g = this.game;
    this.add.update(rawDt);
    this.nrm.update(rawDt);

    // Ambient beauty layer near the player (throttled).
    this._biomeTimer -= rawDt;
    if (this._biomeTimer <= 0) {
      this._biomeTimer = 0.5;
      const p = g.player.position;
      this._biome = g.inDungeon ? { id: 'dungeon', forest: 0 } : g.terrain.biomeAt(p.x, p.z);
    }
    this._ambientTimer -= rawDt;
    if (this._ambientTimer <= 0 && this._biome && g.mode !== 'title') {
      this._ambientTimer = 0.12;
      const p = g.player.position;
      const b = this._biome;
      const night = g.sky?.isNight;
      const R = (s) => (Math.random() - 0.5) * 2 * s;
      const gx = p.x + R(26), gz = p.z + R(26);
      const gy = g.inDungeon ? p.y : g.terrain.heightAt(gx, gz);
      if (g.inDungeon) {
        // Slow dust motes in torchlight.
        this.nrm.spawn(p.x + R(12), p.y + 1 + Math.random() * 3, p.z + R(12),
          R(0.1), -0.05, R(0.1), 4, 0.09, 0.09, 0.5, 0.42, 0.3, 0, 0, 0, 0.3);
      } else if (night && (b.id === 'meadow' || b.id === 'forest') && Math.random() < 0.7) {
        // Fireflies.
        this.add.spawn(gx, gy + 0.5 + Math.random() * 1.6, gz, R(0.4), R(0.15), R(0.4),
          3.5 + Math.random() * 2, 0.16, 0.14, 0.75, 1, 0.35, 0, 0, 3 + Math.random() * 3, 1.1);
      } else if (!night && b.id === 'forest' && Math.random() < 0.5) {
        this.emit('leaf', { x: gx, y: gy + 4 + Math.random() * 4, z: gz });
      } else if (b.id === 'badland' && Math.random() < 0.5) {
        this.emit('ember', { x: gx, y: gy + 0.3, z: gz });
      } else if (!night && b.id === 'meadow' && g.sky && Math.abs(g.sky.timeOfDay - 0.5) < 0.12 && Math.random() < 0.5) {
        // Noon pollen motes.
        this.nrm.spawn(gx, gy + 0.6 + Math.random() * 1.4, gz, R(0.3), 0.12, R(0.3),
          3, 0.1, 0.08, 0.98, 0.95, 0.8, 0, 0, 0, 0.8);
      }
    }
  }
}
