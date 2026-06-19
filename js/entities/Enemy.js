import * as THREE from 'three';
import { stylizeCharacter } from '../gfx/Materials.js?v=3';

// Simple enemy with patrol + chase AI. Two flavors:
//   'chu'    — a bouncy slime (weak)
//   'moblin' — a sturdier humanoid grunt (carries the dungeon key when flagged)
export class Enemy {
  constructor(kind, x, z, terrain, opts = {}) {
    this.kind = kind;
    this.terrain = terrain;
    this.dead = false;
    this.hitCooldown = 0;       // i-frames after being struck
    this.attackCooldown = 0;    // delay between contact hits on the player

    const stats = kind === 'moblin'
      ? { hp: 5, speed: 3.2, sight: 16, damage: 1, touch: 1.2 }
      : { hp: 2, speed: 2.2, sight: 11, damage: 1, touch: 1.0 };
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.speed = stats.speed;
    this.sight = stats.sight;
    this.damage = stats.damage;
    this.touchRange = stats.touch;
    this.dropsKey = !!opts.dropsKey;

    this.home = new THREE.Vector3(x, 0, z);
    this.wanderTarget = this.home.clone();
    this.wanderTimer = 0;
    this.bouncePhase = Math.random() * Math.PI * 2;

    this.mesh = this._build(kind);
    this.mesh.position.set(x, terrain.getHeightAt(x, z), z);
  }

  _build(kind) {
    const g = new THREE.Group();
    if (kind === 'moblin') {
      const skin = new THREE.MeshStandardMaterial({ color: 0xb05a3a, roughness: 0.9, flatShading: true });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.9, 4, 8), skin);
      body.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 10), skin);
      head.position.y = 2.0;
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 6), skin);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, 1.95, 0.45);
      g.add(body, head, snout);
    } else {
      const jelly = new THREE.MeshStandardMaterial({
        color: 0x5ad2ff, transparent: true, opacity: 0.85, roughness: 0.2, flatShading: true,
      });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), jelly);
      body.position.y = 0.6;
      body.scale.y = 0.85;
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0x102030 });
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), eyeMat);
      const e2 = e1.clone();
      e1.position.set(-0.2, 0.7, 0.5);
      e2.position.set(0.2, 0.7, 0.5);
      g.add(body, e1, e2);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // Cel-shade with an outline; keep the slime translucent so it still reads as jelly.
    stylizeCharacter(g, { thickness: kind === 'chu' ? 0.04 : 0.06 });
    return g;
  }

  // Returns the damage to deal to the player this frame (0 if none).
  update(dt, playerPos) {
    if (this.dead) return 0;
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const pos = this.mesh.position;
    const toPlayer = new THREE.Vector3().subVectors(playerPos, pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();

    let moveDir = null;
    if (dist < this.sight) {
      // Chase the player.
      moveDir = toPlayer.normalize();
    } else {
      // Wander around home.
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 6;
        this.wanderTarget.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
      }
      const toTarget = new THREE.Vector3().subVectors(this.wanderTarget, pos);
      toTarget.y = 0;
      if (toTarget.length() > 0.5) moveDir = toTarget.normalize();
    }

    if (moveDir) {
      const sp = this.speed * (dist < this.sight ? 1 : 0.45);
      pos.x += moveDir.x * sp * dt;
      pos.z += moveDir.z * sp * dt;
      this.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // Clamp to ground; chus bob, moblins stride.
    const ground = this.terrain.getHeightAt(pos.x, pos.z);
    this.bouncePhase += dt * 8;
    const bob = this.kind === 'chu' ? Math.abs(Math.sin(this.bouncePhase)) * 0.3 : 0;
    pos.y = ground + bob;

    // Contact damage with its own cooldown so it doesn't drain health instantly.
    if (dist < this.touchRange && this.attackCooldown <= 0) {
      this.attackCooldown = 0.8;
      return this.damage;
    }
    return 0;
  }

  // Apply a sword hit; returns true if this hit was lethal.
  takeHit(damage, knockFrom) {
    if (this.dead || this.hitCooldown > 0) return false;
    this.hp -= damage;
    this.hitCooldown = 0.25;
    // Knockback away from the attacker.
    const kb = new THREE.Vector3().subVectors(this.mesh.position, knockFrom);
    kb.y = 0;
    kb.normalize().multiplyScalar(1.4);
    this.mesh.position.add(kb);
    // Flash red briefly.
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material.emissive) {
        o.material.emissive.setHex(0xff0000);
        setTimeout(() => o.material.emissive && o.material.emissive.setHex(0x000000), 120);
      }
    });
    if (this.hp <= 0) { this.dead = true; return true; }
    return false;
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
