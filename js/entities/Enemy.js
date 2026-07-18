// Enemies: shared base class (health, knockback, terrain following, loot,
// separation) plus four procedural overworld species — boglins, a brute
// variant, skittering beetles, and nocturnal wisps.

import * as THREE from 'three';
import { toonMaterial, addOutline, PALETTE } from '../gfx/Toon.js';
import { clamp, clamp01, damp, dampAngle, lerp } from '../util/math.js';
import { Pickup } from './Pickup.js';

const _dir = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Enemy {
  constructor(game, pos, opts = {}) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.alive = true;
    this.removed = false;
    this.radius = 0.7;
    this.height = 1.4;
    this.hp = this.maxHp = 6;
    this.touchDamage = 0;
    this.name = 'Enemy';
    this.type = 'enemy';
    this.campIndex = opts.campIndex;
    this.anchor = opts.anchor || { x: pos.x, z: pos.z, r: 14 };
    this.ground = opts.ground || game.terrain;
    this.ephemeral = !!opts.ephemeral;
    this.flying = false;

    this.yaw = Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3();
    this.aggro = false;
    this._hitFlash = 0;
    this._hitstun = 0;
    this._deathT = -1;
    this._squash = 1;
    this._t = Math.random() * 100;
    this._flashMats = [];

    game.scene.add(this.group);
  }

  // Collect materials for the white hit-flash (clone so instances are unique).
  _prepFlash() {
    this.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && !o.userData.isOutline) {
        o.material = o.material.clone();
        this._flashMats.push(o.material);
      }
    });
  }

  get position() { return this.group.position; }

  distToPlayer() {
    const p = this.game.player.position;
    return Math.hypot(p.x - this.group.position.x, p.z - this.group.position.z);
  }

  facePlayer(dt, rate = 8) {
    const p = this.game.player.position;
    this.yaw = dampAngle(this.yaw,
      Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z), rate, dt);
  }

  setAggro() {
    if (this.aggro) return;
    this.aggro = true;
    this._squash = 1.35; // startled hop
    this.vel.y = this.flying ? 0 : 5;
    this.game.events.emit('enemy:aggro', { enemy: this });
  }

  takeDamage(dmg, dir, knockback = 6) {
    if (!this.alive) return true;
    this.hp -= dmg;
    this._hitFlash = 1;
    this._hitstun = 0.3;
    this._squash = 0.65;
    if (dir) {
      this.vel.x += dir.x * knockback;
      this.vel.z += dir.z * knockback;
      if (!this.flying) this.vel.y = Math.max(this.vel.y, 3);
    }
    this.setAggro();
    if (this.hp <= 0) { this._die(); return true; }
    return false;
  }

  _die() {
    this.alive = false;
    this._deathT = 0;
    this.game.events.emit('enemy:death', {
      type: this.type, pos: this.group.position.clone(), enemy: this,
    });
    this._dropLoot();
  }

  _dropLoot() {
    const g = this.game;
    const pos = _v2.copy(this.group.position).setY(this.group.position.y + 0.8);
    const drops = this.lootTable ? this.lootTable() : ['gem_green'];
    for (const type of drops) {
      g.pickups.push(new Pickup(g, type, pos, { bounce: true, life: 25 }));
    }
  }

  banish() {
    if (!this.alive) return;
    this.alive = false;
    this._deathT = 0.8; // skip loot, just fade
  }

  update(dt, game) {
    this._t += dt;

    // Death: squash, sink, fade.
    if (!this.alive) {
      this._deathT += dt;
      const f = clamp01(this._deathT / 2);
      this.group.scale.setScalar(Math.max(0.01, 1 - f * 0.9));
      this.group.scale.y = Math.max(0.01, (1 - f) * 0.5 + 0.05);
      this.group.position.y -= dt * 0.3;
      if (this._deathT > 2) {
        this.removed = true;
        game.scene.remove(this.group);
      }
      return;
    }

    this._hitFlash = Math.max(0, this._hitFlash - dt * 4);
    this._hitstun = Math.max(0, this._hitstun - dt);
    this._squash = damp(this._squash, 1, 10, dt);
    for (const m of this._flashMats) {
      m.emissive.setRGB(this._hitFlash, this._hitFlash, this._hitFlash * 0.9);
    }

    const dist = this.distToPlayer();
    const far = dist > 90;

    if (!far && this._hitstun <= 0 && game.player.alive) {
      this.behave(dt, game, dist);
    }

    // Shared physics.
    if (!this.flying) {
      this.vel.y -= 24 * dt;
      this.group.position.y += this.vel.y * dt;
      const gy = this.ground.heightAt(this.group.position.x, this.group.position.z);
      if (this.group.position.y <= gy) { this.group.position.y = gy; this.vel.y = 0; }
    }
    // Horizontal motion + friction.
    this.group.position.x += this.vel.x * dt;
    this.group.position.z += this.vel.z * dt;
    const fr = Math.max(0, 1 - 6 * dt);
    this.vel.x *= fr; this.vel.z *= fr;

    // Separation from other enemies (cheap n² over nearby only).
    if (!far) {
      for (const e of game.enemies) {
        if (e === this || !e.alive) continue;
        const dx = this.group.position.x - e.group.position.x;
        const dz = this.group.position.z - e.group.position.z;
        const rr = this.radius + e.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (rr - d) / d * 0.5;
          this.group.position.x += dx * push;
          this.group.position.z += dz * push;
        }
      }
      const solved = game.colliders.resolve(this.group.position.x, this.group.position.z, this.radius * 0.8, this.group.position.y);
      this.group.position.x = solved.x;
      this.group.position.z = solved.z;
    }

    this.group.rotation.y = this.yaw;
    // Squash & stretch.
    this.group.scale.set(1 / Math.sqrt(this._squash), this._squash, 1 / Math.sqrt(this._squash));

    this.animate(dt, game, dist);
  }

  /** Subclass AI. */
  behave() {}
  /** Subclass visual animation. */
  animate() {}
  lootTable() { return Math.random() < 0.12 ? ['gem_green', 'heart'] : ['gem_green']; }

  // Helpers -----------------------------------------------------------------
  moveToward(x, z, speed, dt, turnRate = 6) {
    const dx = x - this.group.position.x, dz = z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), turnRate, dt);
    this.vel.x += Math.sin(this.yaw) * speed * 4 * dt;
    this.vel.z += Math.cos(this.yaw) * speed * 4 * dt;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > speed) { this.vel.x *= speed / spd; this.vel.z *= speed / spd; }
    return false;
  }

  tryHitPlayer(range, arc, dmg, knockback = 6) {
    const g = this.game;
    const p = g.player;
    const dx = p.position.x - this.group.position.x;
    const dz = p.position.z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d > range + p.radius) return false;
    let ang = Math.atan2(dx, dz) - this.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > arc) return false;
    return p.takeDamage(dmg, this.group.position, knockback);
  }
}

// ===========================================================================
// Boglin — squat goblin with a club.
// ===========================================================================
class Boglin extends Enemy {
  constructor(game, pos, opts = {}) {
    super(game, pos, opts);
    this.type = 'boglin';
    this.name = 'Boglin';
    this.hp = this.maxHp = 6;
    this.radius = 0.65;
    this.height = 1.3;
    this.scale = opts.scale || 1;
    this.aggroRange = 16;
    this.speed = 4.2;
    this.attackDmg = 2;
    this.attackRange = 1.9;
    this.attackKnock = 7;
    this._state = 'idle';
    this._stateT = 0;
    this._cooldown = 0;
    this._wander = { x: pos.x, z: pos.z };
    this._buildBody(opts);
    this._prepFlash();
  }

  _buildBody(opts) {
    const s = this.scale;
    const skin = toonMaterial({ color: opts.dark ? 0x5d6b35 : 0x7a8a42, cache: false });
    const cloth = toonMaterial({ color: 0x6b4a2e, cache: false });
    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);

    // Squat pear body.
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), skin);
    belly.position.y = 0.5; belly.scale.set(1, 1.05, 0.92); belly.castShadow = true;
    body.add(belly);
    const loin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.2, 8), cloth);
    loin.position.y = 0.3; body.add(loin);
    // Head with underbite + big ears.
    this.head = new THREE.Group();
    this.head.position.y = 0.98;
    body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
    skull.scale.set(1, 0.9, 0.95); skull.castShadow = true;
    this.head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.22), skin);
    jaw.position.set(0, -0.12, 0.1);
    this.head.add(jaw);
    for (const sd of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), skin);
      ear.position.set(0.26 * sd, 0.1, -0.02);
      ear.rotation.z = sd * -1.25;
      this.head.add(ear);
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 5), toonMaterial({ color: 0xf0ead8 }));
      tooth.position.set(0.08 * sd, -0.04, 0.19);
      this.head.add(tooth);
      // Eyes: beady amber.
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffc23d, toneMapped: false }));
      eye.position.set(0.11 * sd, 0.05, 0.2);
      eye.userData.noOutline = true;
      this.eyes = this.eyes || [];
      this.eyes.push(eye);
      this.head.add(eye);
    }
    // Stub legs + arms.
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.16), skin);
    this.legL.position.set(-0.16, 0.15, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.16;
    body.add(this.legL, this.legR);
    this.armL = new THREE.Group();
    this.armL.position.set(-0.42, 0.62, 0);
    const armMeshL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), skin);
    armMeshL.position.y = -0.15;
    this.armL.add(armMeshL);
    body.add(this.armL);
    // Club arm.
    this.armR = new THREE.Group();
    this.armR.position.set(0.42, 0.62, 0);
    const armMeshR = armMeshL.clone();
    this.armR.add(armMeshR);
    const club = new THREE.Group();
    club.position.y = -0.32;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), cloth);
    handle.rotation.x = 1.2; handle.position.z = 0.16;
    const headC = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), toonMaterial({ color: PALETTE.woodDark }));
    headC.position.set(0, 0.06, 0.42); headC.scale.set(0.8, 0.8, 1.25); headC.castShadow = true;
    club.add(handle, headC);
    this.armR.add(club);
    body.add(this.armR);

    body.scale.setScalar(s);
    this.radius *= s;
    this.height *= s;
    addOutline(this.group, 0.03);
  }

  behave(dt, game, dist) {
    this._stateT += dt;
    this._cooldown = Math.max(0, this._cooldown - dt);
    const p = game.player.position;
    const anchorDist = Math.hypot(this.group.position.x - this.anchor.x, this.group.position.z - this.anchor.z);

    if (!this.aggro) {
      if (dist < this.aggroRange) { this.setAggro(); this._state = 'chase'; this._stateT = 0; }
      else {
        // Idle wander around the anchor with fidget pauses.
        if (this._state !== 'wander' || this._stateT > 4) {
          this._state = 'wander'; this._stateT = 0;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * this.anchor.r * 0.7;
          this._wander = { x: this.anchor.x + Math.sin(a) * r, z: this.anchor.z + Math.cos(a) * r };
        }
        if (this._stateT > 1.2) this.moveToward(this._wander.x, this._wander.z, this.speed * 0.35, dt);
      }
      return;
    }

    // Leash: give up when the player drags us too far from home.
    if (anchorDist > this.anchor.r + 14 || dist > this.aggroRange + 18) {
      this.aggro = false; this._state = 'wander'; this._stateT = 4;
      return;
    }

    switch (this._state) {
      case 'chase': {
        this.moveToward(p.x, p.z, this.speed, dt);
        if (dist < this.attackRange * 0.9 && this._cooldown <= 0) {
          this._state = 'windup'; this._stateT = 0;
        } else if (this._cooldown > 0 && dist < 4 && Math.random() < 0.02) {
          this._state = 'strafe'; this._stateT = 0;
          this._strafeDir = Math.random() < 0.5 ? 1 : -1;
        }
        break;
      }
      case 'strafe': {
        this.facePlayer(dt);
        const a = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z) + this._strafeDir * Math.PI / 2;
        this.vel.x += Math.sin(a) * this.speed * 2.2 * dt;
        this.vel.z += Math.cos(a) * this.speed * 2.2 * dt;
        if (this._stateT > 1) { this._state = 'chase'; this._stateT = 0; }
        break;
      }
      case 'windup': {
        this.facePlayer(dt, 10);
        if (this._stateT > this.windupTime()) { this._state = 'swing'; this._stateT = 0; }
        break;
      }
      case 'swing': {
        if (this._stateT > 0.1 && this._stateT < 0.28 && !this._didHit) {
          this._didHit = this.tryHitPlayer(this.attackRange + 0.4, 1.1, this.attackDmg, this.attackKnock);
          if (this.onSwing) this.onSwing(game);
        }
        if (this._stateT > 0.45) {
          this._didHit = false;
          this._cooldown = 1.4;
          this._state = 'back'; this._stateT = 0;
        }
        break;
      }
      case 'back': {
        // Hop back after attacking to create rhythm.
        this.facePlayer(dt);
        this.vel.x -= Math.sin(this.yaw) * this.speed * 1.6 * dt * 4;
        this.vel.z -= Math.cos(this.yaw) * this.speed * 1.6 * dt * 4;
        if (this._stateT > 0.5) { this._state = 'chase'; this._stateT = 0; }
        break;
      }
      default:
        this._state = 'chase';
    }
  }

  windupTime() { return 0.5; }

  animate(dt, game, dist) {
    const t = this._t;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const walk = clamp01(speed / this.speed);
    // Waddle.
    const ph = t * 11;
    this.legL.rotation.x = Math.sin(ph) * 0.8 * walk;
    this.legR.rotation.x = -Math.sin(ph) * 0.8 * walk;
    this.body.rotation.z = Math.sin(ph) * 0.06 * walk;
    this.body.position.y = Math.abs(Math.cos(ph)) * 0.05 * walk;
    this.armL.rotation.x = -Math.sin(ph) * 0.5 * walk + 0.2;
    // Head bob + idle fidgets.
    this.head.rotation.y = damp(this.head.rotation.y, this.aggro ? 0 : Math.sin(t * 0.7) * 0.5, 4, dt);
    this.head.rotation.x = Math.sin(t * 2.3) * 0.05;

    // Club arm per state.
    let armTgt = 0.3 + Math.sin(t * 2.1) * 0.08;
    if (this._state === 'windup') armTgt = -2.3;
    else if (this._state === 'swing') armTgt = 1.3;
    const rate = this._state === 'swing' ? 30 : 8;
    this.armR.rotation.x = damp(this.armR.rotation.x, armTgt, rate, dt);

    // Eyes glow harder at night.
    if (this.eyes) {
      const glow = game.sky?.isNight ? 1 : 0.75;
      for (const e of this.eyes) e.material.color.setRGB(glow, glow * 0.76, 0.24 * glow);
    }
    void dist;
  }

  lootTable() {
    const n = 1 + (Math.random() * 3 | 0);
    const out = [];
    for (let i = 0; i < n; i++) out.push('gem_green');
    if (Math.random() < 0.12) out.push('heart');
    return out;
  }
}

// ===========================================================================
// Boglin Brute — big, horned, ground-shaking slams.
// ===========================================================================
class BoglinBrute extends Boglin {
  constructor(game, pos, opts = {}) {
    super(game, pos, { ...opts, scale: 1.8, dark: true });
    this.type = 'boglin_brute';
    this.name = 'Boglin Brute';
    this.hp = this.maxHp = 14;
    this.speed = 3.0;
    this.attackDmg = 4;
    this.attackRange = 2.6;
    this.attackKnock = 11;
    this.aggroRange = 18;
    // Horned helm.
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      toonMaterial({ color: 0x555a60 }));
    helm.position.y = 0.12;
    this.head.add(helm);
    for (const sd of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 6), toonMaterial({ color: 0xd8d2c0 }));
      horn.position.set(0.22 * sd, 0.22, 0);
      horn.rotation.z = sd * -0.7;
      this.head.add(horn);
    }
    this.onSwing = (g) => {
      g.cameraRig.shake(0.25);
      g.particles?.emit('dust', this.group.position, { big: true });
      g.events.emit('brute:slam', { pos: this.group.position });
    };
  }
  windupTime() { return 0.75; }
  lootTable() {
    const out = ['gem_blue'];
    if (Math.random() < 0.4) out.push('heart');
    return out;
  }
}

// ===========================================================================
// Skitter — darting beetle-spider.
// ===========================================================================
class Skitter extends Enemy {
  constructor(game, pos, opts = {}) {
    super(game, pos, opts);
    this.type = 'skitter';
    this.name = 'Skitter';
    this.hp = this.maxHp = 4;
    this.radius = 0.5;
    this.height = 0.6;
    this.touchDamage = 0;
    this._state = 'lurk';
    this._stateT = 0;
    this._cooldown = 0;
    this._buildBody();
    this._prepFlash();
  }

  _buildBody() {
    const shell = toonMaterial({ color: 0x3c3348, cache: false });
    const under = toonMaterial({ color: 0x5a4a66, cache: false });
    this.body = new THREE.Group();
    this.body.position.y = 0.32;
    this.group.add(this.body);
    const carapace = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 9), shell);
    carapace.scale.set(1, 0.62, 1.25);
    carapace.castShadow = true;
    this.body.add(carapace);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), under);
    headM.position.set(0, -0.02, 0.42);
    this.body.add(headM);
    for (const sd of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffb03d, toneMapped: false }));
      eye.position.set(0.09 * sd, 0.07, 0.55);
      eye.userData.noOutline = true;
      this.body.add(eye);
      // Mandibles.
      const mand = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), shell);
      mand.position.set(0.1 * sd, -0.08, 0.56);
      mand.rotation.x = 1.4;
      mand.rotation.z = sd * -0.4;
      this.body.add(mand);
    }
    // 6 stubby legs.
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const sd = i % 2 === 0 ? 1 : -1;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.34, 5), shell);
      const zOff = (Math.floor(i / 2) - 1) * 0.28;
      leg.position.set(0.36 * sd, -0.12, zOff);
      leg.rotation.z = sd * 0.9;
      leg.userData.phase = i * 1.1;
      this.body.add(leg);
      this.legs.push(leg);
    }
    addOutline(this.group, 0.03);
  }

  behave(dt, game, dist) {
    this._stateT += dt;
    this._cooldown = Math.max(0, this._cooldown - dt);
    const p = game.player.position;
    switch (this._state) {
      case 'lurk':
        this.touchDamage = 0;
        if (dist < 10) { this.setAggro(); this._state = 'zig'; this._stateT = 0; }
        break;
      case 'zig': {
        // Erratic approach: zigzag toward the player.
        const base = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);
        const zig = Math.sin(this._t * 6.5) * 0.9;
        const a = base + zig;
        this.vel.x += Math.sin(a) * 24 * dt;
        this.vel.z += Math.cos(a) * 24 * dt;
        const spd = Math.hypot(this.vel.x, this.vel.z);
        if (spd > 6.4) { this.vel.x *= 6.4 / spd; this.vel.z *= 6.4 / spd; }
        this.yaw = dampAngle(this.yaw, a, 10, dt);
        if (dist < 3.2 && this._cooldown <= 0) { this._state = 'lunge'; this._stateT = 0; this.facePlayer(dt, 50); }
        if (dist > 16) { this._state = 'lurk'; this.aggro = false; }
        break;
      }
      case 'lunge': {
        if (this._stateT < 0.12) {
          this._squash = 0.6; // crouch
        } else if (this._stateT < 0.4) {
          this.touchDamage = 2;
          this.vel.x = Math.sin(this.yaw) * 11;
          this.vel.z = Math.cos(this.yaw) * 11;
        } else {
          this.touchDamage = 0;
          this._cooldown = 1.5;
          this._state = 'back'; this._stateT = 0;
        }
        break;
      }
      case 'back': {
        this.vel.x -= Math.sin(this.yaw) * 18 * dt;
        this.vel.z -= Math.cos(this.yaw) * 18 * dt;
        if (this._stateT > 0.45) { this._state = 'zig'; this._stateT = 0; }
        break;
      }
    }
  }

  animate(dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const scuttle = clamp01(speed / 5);
    for (const leg of this.legs) {
      leg.rotation.x = Math.sin(this._t * 26 + leg.userData.phase) * 0.7 * scuttle;
    }
    this.body.position.y = 0.32 + Math.abs(Math.sin(this._t * 26)) * 0.03 * scuttle;
    this.body.rotation.x = damp(this.body.rotation.x, this._state === 'lunge' && this._squash < 0.9 ? 0.3 : 0, 10, dt);
  }

  lootTable() {
    const out = ['gem_green'];
    if (Math.random() < 0.5) out.push('gem_green');
    if (Math.random() < 0.1) out.push('heart');
    return out;
  }
}

// ===========================================================================
// Wisp — nocturnal floating spirit, ranged bolts.
// ===========================================================================
class Wisp extends Enemy {
  constructor(game, pos, opts = {}) {
    super(game, pos, opts);
    this.type = 'wisp';
    this.name = 'Wisp';
    this.hp = this.maxHp = 4;
    this.radius = 0.55;
    this.height = 1.2;
    this.flying = true;
    this._boltT = 1.5 + Math.random() * 1.5;
    this._hoverBase = pos.y;
    this._buildBody();
    this._prepFlash();
  }

  _buildBody() {
    const shroud = toonMaterial({
      color: 0x8aa4c8, transparent: true, opacity: 0.75, cache: false,
      emissive: 0x24405e, emissiveIntensity: 0.6,
    });
    this.body = new THREE.Group();
    this.group.add(this.body);
    // Tattered cone shroud.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.15, 8, 1, true), shroud);
    cone.rotation.x = Math.PI;
    cone.position.y = 0.55;
    this.body.add(cone);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), shroud);
    hood.position.y = 1.12;
    hood.scale.set(1, 0.9, 1);
    this.body.add(hood);
    // Glowing cyan core.
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, toneMapped: false }));
    this.core.position.y = 1.05;
    this.core.userData.noOutline = true;
    this.body.add(this.core);
    // Eyes.
    for (const sd of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xd8f6ff, toneMapped: false }));
      eye.position.set(0.1 * sd, 1.14, 0.24);
      eye.userData.noOutline = true;
      this.body.add(eye);
    }
  }

  behave(dt, game, dist) {
    const p = game.player.position;
    this.facePlayer(dt, 4);
    if (dist < 22) this.setAggro();
    if (!this.aggro) return;

    // Keep 8–12u ring distance.
    const want = dist < 8 ? -1 : dist > 12 ? 1 : 0;
    if (want !== 0) {
      const a = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z);
      this.vel.x += Math.sin(a) * want * 8 * dt;
      this.vel.z += Math.cos(a) * want * 8 * dt;
    }
    // Slow orbit.
    const oa = Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z) + Math.PI / 2;
    this.vel.x += Math.sin(oa) * 2.4 * dt;
    this.vel.z += Math.cos(oa) * 2.4 * dt;

    // Bolt volley.
    this._boltT -= dt;
    if (this._boltT <= 0 && dist < 26) {
      this._boltT = 3 + Math.random();
      _dir.set(p.x - this.group.position.x, (p.y + 1.1) - (this.group.position.y + 1.05), p.z - this.group.position.z).normalize();
      game.combat.spawnProjectile({
        pos: _v2.copy(this.group.position).setY(this.group.position.y + 1.05),
        vel: _dir.multiplyScalar(9),
        dmg: 2, r: 0.3, color: 0x8fd4ff, life: 5, from: 'enemy',
      });
      game.events.emit('wisp:bolt', { pos: this.group.position });
      this._squash = 1.3;
    }
  }

  animate(dt, game) {
    // Hover bob above terrain.
    const gy = this.ground.heightAt(this.group.position.x, this.group.position.z);
    const want = gy + 1.6 + Math.sin(this._t * 1.7) * 0.35;
    this.group.position.y = damp(this.group.position.y, want, 3, dt);
    this.core.scale.setScalar(1 + Math.sin(this._t * 5) * 0.15);
    this.body.rotation.z = Math.sin(this._t * 1.3) * 0.08;
    void game;
  }

  lootTable() { return ['gem_blue']; }
}

// ===========================================================================
export function createEnemy(game, type, pos, opts = {}) {
  switch (type) {
    case 'boglin': return new Boglin(game, pos, opts);
    case 'boglin_brute': return new BoglinBrute(game, pos, opts);
    case 'skitter': return new Skitter(game, pos, opts);
    case 'wisp': return new Wisp(game, pos, opts);
    default:
      console.warn(`[enemy] unknown type "${type}", spawning boglin`);
      return new Boglin(game, pos, opts);
  }
}
