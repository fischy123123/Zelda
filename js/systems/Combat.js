// Combat resolution: player sword arcs vs enemies, enemy contact damage,
// projectiles, lock-on target selection, hitstop and hit feedback.

import * as THREE from 'three';
import { clamp01 } from '../util/math.js';

const _v = new THREE.Vector3();

// Swing timing windows (fractions of the swing) during which the blade hits.
const ACTIVE = { 0: [0.25, 0.62], 1: [0.22, 0.6], 2: [0.28, 0.7], spin: [0.12, 0.88] };

const SWORDS = {
  bronze:   { damage: 2, reach: 2.6, name: 'Bronze Sword' },
  sunblade: { damage: 5, reach: 3.0, name: 'The Sunblade' },
};

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this._projPool = [];
  }

  swordStats() { return SWORDS[this.game.state.sword] || SWORDS.bronze; }

  update(dt) {
    this._playerMelee();
    this._enemyContact(dt);
    this._projectilesStep(dt);
  }

  // --- player sword ---------------------------------------------------------
  _playerMelee() {
    const g = this.game;
    const p = g.player;
    const atk = p.attack;
    if (!atk || !p.alive) return;

    const dur = atk.index === 'spin' ? 0.62 : 0.38;
    const frac = clamp01(atk.t / dur);
    const [a0, a1] = ACTIVE[atk.index] ?? ACTIVE[0];
    if (frac < a0 || frac > a1) return;

    const sword = this.swordStats();
    const isSpin = atk.index === 'spin';
    const reach = sword.reach + (isSpin ? 0.5 : 0);
    const dmgMul = isSpin ? 1.3 : (atk.index === 2 ? 1.6 : 1);

    for (const e of g.enemies) {
      if (!e.alive || atk.hitSet.has(e)) continue;
      const dx = e.group.position.x - p.position.x;
      const dz = e.group.position.z - p.position.z;
      const dist = Math.hypot(dx, dz) - (e.radius || 0.7);
      if (dist > reach) continue;
      const dy = Math.abs((e.group.position.y + (e.height || 1.5) * 0.5) - (p.position.y + 1.1));
      if (dy > 2.6) continue;
      if (!isSpin) {
        // Frontal 130° arc.
        let d = Math.atan2(dx, dz) - p.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > 1.15) continue;
      }
      atk.hitSet.add(e);
      const dmg = Math.round(sword.damage * dmgMul);
      _v.set(dx, 0, dz).normalize();
      const died = e.takeDamage(dmg, _v, isSpin ? 9 : 6.5);
      g.hitstop(died ? 0.09 : 0.05);
      g.cameraRig.shake(died ? 0.22 : 0.1);
      g.events.emit('combat:hit', {
        pos: e.group.position.clone().setY(e.group.position.y + (e.height || 1.4) * 0.6),
        died, enemy: e, crit: atk.index === 2 || isSpin,
      });
    }
  }

  // --- enemy contact damage (walking into spiky things hurts) --------------
  _enemyContact(dt) {
    const g = this.game;
    const p = g.player;
    if (!p.alive || p.invulnerable) return;
    for (const e of g.enemies) {
      if (!e.alive || !e.touchDamage) continue;
      const dx = e.group.position.x - p.position.x;
      const dz = e.group.position.z - p.position.z;
      const rr = (e.radius || 0.7) + p.radius - 0.15;
      if (dx * dx + dz * dz < rr * rr &&
          Math.abs(e.group.position.y - p.position.y) < 2) {
        p.takeDamage(e.touchDamage, e.group.position, 6);
        break;
      }
    }
  }

  // --- projectiles ----------------------------------------------------------
  /** opts: {pos, vel, r=0.35, dmg=2, from='enemy', color=0xff8855, life=4, gravity=0} */
  spawnProjectile(opts) {
    const g = this.game;
    let p = this._projPool.pop();
    if (!p) {
      p = {
        mesh: new THREE.Mesh(
          new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
        ),
        glow: null,
      };
      p.mesh.material = p.mesh.material.clone();
      g.scene.add(p.mesh);
    }
    p.pos = opts.pos.clone();
    p.vel = opts.vel.clone();
    p.r = opts.r ?? 0.35;
    p.dmg = opts.dmg ?? 2;
    p.from = opts.from ?? 'enemy';
    p.life = opts.life ?? 4;
    p.gravity = opts.gravity ?? 0;
    p.mesh.material.color.set(opts.color ?? 0xff8855);
    p.mesh.scale.setScalar(p.r);
    p.mesh.visible = true;
    p.mesh.position.copy(p.pos);
    this.projectiles.push(p);
    return p;
  }

  _projectilesStep(dt) {
    const g = this.game;
    const p = g.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      pr.vel.y += pr.gravity * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      pr.mesh.rotation.y += dt * 6;

      let dead = pr.life <= 0;
      // Ground hit.
      if (!dead && pr.pos.y < p.groundProvider.heightAt(pr.pos.x, pr.pos.z) + 0.1) dead = true;

      // Player hit.
      if (!dead && pr.from === 'enemy' && p.alive) {
        const dx = pr.pos.x - p.position.x;
        const dy = pr.pos.y - (p.position.y + 1);
        const dz = pr.pos.z - p.position.z;
        if (dx * dx + dz * dz < (pr.r + p.radius) ** 2 && Math.abs(dy) < 1.6) {
          const blocked = p.guarding;
          p.takeDamage(pr.dmg, pr.pos, 5);
          if (!blocked || true) dead = true;
        }
      }
      // Enemy hit (player-sourced projectiles, e.g. future upgrades).
      if (!dead && pr.from === 'player') {
        for (const e of g.enemies) {
          if (!e.alive) continue;
          const dx = pr.pos.x - e.group.position.x;
          const dz = pr.pos.z - e.group.position.z;
          if (dx * dx + dz * dz < (pr.r + (e.radius || 0.7)) ** 2) {
            _v.copy(pr.vel).setY(0).normalize();
            e.takeDamage(pr.dmg, _v, 6);
            g.events.emit('combat:hit', { pos: pr.pos.clone(), died: !e.alive, enemy: e });
            dead = true;
            break;
          }
        }
      }

      if (dead) {
        g.events.emit('projectile:pop', { pos: pr.pos.clone(), color: pr.mesh.material.color.getHex() });
        pr.mesh.visible = false;
        this.projectiles.splice(i, 1);
        this._projPool.push(pr);
      }
    }
  }

  // --- lock-on --------------------------------------------------------------
  toggleLockOn() {
    const g = this.game;
    const rig = g.cameraRig;
    if (rig.lockTarget && rig.lockTarget.alive) { rig.lockTarget = null; return null; }
    let best = null, bestScore = Infinity;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const dx = e.group.position.x - g.player.position.x;
      const dz = e.group.position.z - g.player.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 26) continue;
      // Prefer enemies in front of the camera.
      let ang = Math.atan2(dx, dz) - rig.yaw + Math.PI;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      const score = d + Math.abs(ang) * 6;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    rig.lockTarget = best;
    if (best) g.events.emit('lockon', { enemy: best });
    return best;
  }
}
