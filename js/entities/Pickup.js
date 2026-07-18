// Floating collectible pickups: gems, hearts, stamina fruit, quest items.
// Spin, bob, magnetize toward the player, then pop with an event.

import * as THREE from 'three';
import { toonMaterial, flatMaterial, PALETTE } from '../gfx/Toon.js';

const GEOMS = {};
function gemGeo() {
  if (!GEOMS.gem) GEOMS.gem = new THREE.OctahedronGeometry(0.32, 0);
  return GEOMS.gem;
}
function heartGeo() {
  if (!GEOMS.heart) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.28);
    shape.bezierCurveTo(-0.45, 0.08, -0.28, 0.42, 0, 0.18);
    shape.bezierCurveTo(0.28, 0.42, 0.45, 0.08, 0, -0.28);
    GEOMS.heart = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    GEOMS.heart.center();
  }
  return GEOMS.heart;
}
function shroomGeo() {
  if (!GEOMS.shroom) {
    GEOMS.shroom = new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  }
  return GEOMS.shroom;
}

export const PICKUP_DEFS = {
  gem_green: { color: PALETTE.gemGreen, value: 1, geo: gemGeo, glow: true },
  gem_blue:  { color: PALETTE.gemBlue,  value: 5, geo: gemGeo, glow: true },
  gem_red:   { color: PALETTE.gemRed,   value: 20, geo: gemGeo, glow: true },
  heart:     { color: 0xff5a70, geo: heartGeo, glow: false },
  glowshroom:{ color: 0x8fe8ff, geo: shroomGeo, glow: true },
  key:       { color: PALETTE.gold, geo: gemGeo, glow: true },
};

export class Pickup {
  /** type from PICKUP_DEFS. opts: {life (s, 0=forever), bounce} */
  constructor(game, type, pos, opts = {}) {
    this.game = game;
    this.type = type;
    this.def = PICKUP_DEFS[type] || PICKUP_DEFS.gem_green;
    this.alive = true;
    this.life = opts.life ?? 0;
    this.age = 0;
    this._magnet = false;

    this.group = new THREE.Group();
    const mat = this.def.glow
      ? flatMaterial(this.def.color)
      : toonMaterial({ color: this.def.color });
    this.mesh = new THREE.Mesh(this.def.geo(), mat);
    if (this.def.glow) {
      const halo = new THREE.Mesh(
        this.def.geo(),
        new THREE.MeshBasicMaterial({ color: this.def.color, transparent: true, opacity: 0.25, toneMapped: false })
      );
      halo.scale.setScalar(1.55);
      this.mesh.add(halo);
    }
    this.group.add(this.mesh);
    this.group.position.copy(pos);
    this.baseY = pos.y;
    // Small toss when dropped by an enemy.
    this.vel = opts.bounce
      ? new THREE.Vector3((Math.random() - 0.5) * 3, 4 + Math.random() * 2, (Math.random() - 0.5) * 3)
      : null;
    game.scene.add(this.group);
  }

  update(dt) {
    if (!this.alive) return;
    const g = this.game;
    this.age += dt;
    if (this.life > 0 && this.age > this.life) { this._despawn(); return; }

    // Drop physics until it settles.
    if (this.vel) {
      this.vel.y -= 22 * dt;
      this.group.position.addScaledVector(this.vel, dt);
      const gy = g.player.groundProvider.heightAt(this.group.position.x, this.group.position.z) + 0.45;
      if (this.group.position.y <= gy) {
        this.group.position.y = gy;
        if (Math.abs(this.vel.y) > 2.5) this.vel.y = -this.vel.y * 0.4;
        else { this.baseY = gy; this.vel = null; }
      }
    } else {
      this.group.position.y = this.baseY + Math.sin(this.age * 2.6) * 0.12 + 0.12;
    }
    this.mesh.rotation.y += dt * 2.2;

    // Blink before despawn.
    if (this.life > 0 && this.life - this.age < 2) {
      this.group.visible = Math.floor(this.age * 8) % 2 === 0;
    }

    // Magnet + collect.
    const p = g.player.position;
    const dx = p.x - this.group.position.x;
    const dy = (p.y + 0.9) - this.group.position.y;
    const dz = p.z - this.group.position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 12) this._magnet = true;
    if (this._magnet && !this.vel) {
      const d = Math.sqrt(d2) || 1;
      const pull = 14 * dt / d;
      this.group.position.x += dx * pull;
      this.group.position.y += dy * pull;
      this.group.position.z += dz * pull;
    }
    if (d2 < 1.1 && g.player.alive) this._collect();
  }

  _collect() {
    const g = this.game;
    this.alive = false;
    g.scene.remove(this.group);
    const s = g.state;
    switch (this.type) {
      case 'gem_green': case 'gem_blue': case 'gem_red':
        s.gems += this.def.value;
        g.events.emit('gems', { total: s.gems, delta: this.def.value });
        break;
      case 'heart':
        g.player.heal(4);
        break;
      case 'glowshroom':
        s.items.glowshroom = (s.items.glowshroom || 0) + 1;
        g.events.emit('item:added', { id: 'glowshroom', name: 'Glowshroom' });
        break;
      case 'key':
        s.keys += 1;
        g.events.emit('keys', { total: s.keys });
        break;
    }
    g.events.emit('pickup', { type: this.type, pos: this.group.position.clone() });
  }

  _despawn() {
    this.alive = false;
    this.game.scene.remove(this.group);
  }
}
