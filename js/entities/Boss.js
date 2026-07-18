// The Bonewrought Colossus — the Hollow Shrine's guardian. A hulking construct
// of weathered bone plates wrapped around a burning amber core. Three phases:
// ponderous stomps and arm slams, then sweeping arcs and shoulder charges,
// then an enraged storm of shockwave rings. Everything is telegraphed.
//
// Implements the Enemy-style contract (alive, removed, radius, height, group,
// update(dt, game), takeDamage) so Combat.js can hit it once the Dungeon
// pushes it into game.enemies.

import * as THREE from 'three';
import { toonMaterial, flatMaterial, addOutline } from '../gfx/Toon.js';
import { clamp01, lerp, damp, dampAngle, ease, TAU } from '../util/math.js';
import { Pickup } from './Pickup.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const HP = 60;
const WALK_SPEED = [0, 2.1, 2.7, 3.7];      // by phase
const ATTACK_CD = [0, 2.6, 2.0, 1.35];      // seconds between attacks, by phase
const SLAM_TIME = 1.55;
const SWEEP_TIME = 1.7;
const CHARGE_WIND = 1.05;
const CHARGE_MAX = 1.35;
const RING_TIME = 1.35;
const RING_PERIOD = 5.5;
const DIE_TIME = 3.4;

export class Boss {
  /**
   * pos: {x, z} world position (arena center). opts:
   *   ground — dungeon ground provider (heightAt), REQUIRED
   *   arena  — {x, z, r} movement bounds
   * The caller (Dungeon) adds this.group to the scene graph.
   */
  constructor(game, pos, opts = {}) {
    this.game = game;
    this.ground = opts.ground || game.terrain;
    this.arena = opts.arena || { x: pos.x, z: pos.z, r: 20 };

    // Enemy contract fields.
    this.name = 'Bonewrought Colossus';
    this.maxHp = HP;
    this.hp = HP;
    this.alive = true;
    this.removed = false;
    this.radius = 2.2;
    this.height = 5;
    this.touchDamage = 0;      // 0 while dormant; 2 in battle

    this.state = 'dormant';    // dormant|rise|pursue|slam|sweep|chargeWind|chargeRun|stunned|ring|dying
    this.stateT = 0;
    this.phase = 1;
    this.yaw = Math.PI;        // face the arena entrance (south, +z)
    this._cd = 1.2;            // attack cooldown
    this._ringTimer = RING_PERIOD;
    this._hitFlash = 0;
    this._teleFlash = 0;       // telegraph glow 0..1
    this._walkT = 0;
    this._stepSide = 1;
    this._hitDone = false;     // per-attack "damage applied" latch
    this._chargeDir = { x: 0, z: 1 };
    this._corePhase = 0;

    this._build(pos);
  }

  // -------------------------------------------------------------------------
  _build(pos) {
    const g = new THREE.Group();
    this.group = g;
    g.position.set(pos.x, this.ground.heightAt(pos.x, pos.z), pos.z);
    g.rotation.y = this.yaw;

    // Bespoke (uncached) materials so hit-flash never leaks to the world.
    this.boneMat = toonMaterial({ color: 0xded5bc, cache: false });
    this.boneDarkMat = toonMaterial({ color: 0xb4a888, cache: false });
    this.jointMat = toonMaterial({ color: 0x554f42, cache: false });
    this.coreMat = flatMaterial(0xffb347);
    this.eyeMat = flatMaterial(0xffc978);
    this._coreColor = new THREE.Color(0xffb347);
    this._eyeColor = new THREE.Color(0xffc978);

    const bone = this.boneMat, dark = this.boneDarkMat, joint = this.jointMat;

    // Legs — thick bone columns with clawed feet.
    this.legL = this._leg(bone, joint, -0.95);
    this.legR = this._leg(bone, joint, 0.95);
    g.add(this.legL, this.legR);

    // Pelvis.
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.9, 1.4), dark);
    pelvis.position.y = 2.15;
    g.add(pelvis);

    // Torso group (ribcage + core + shoulders + head + arms pivot here).
    const torso = new THREE.Group();
    torso.position.y = 2.6;
    this.torso = torso;
    g.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.9, 1.7), bone);
    chest.position.y = 1.0;
    torso.add(chest);
    // Rib plates curving around the chest.
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.55 - i * 0.12, 0.14, 6, 12, Math.PI), dark);
      rib.position.set(0, 0.45 + i * 0.55, 0.15);
      rib.rotation.set(Math.PI / 2, 0, 0);
      torso.add(rib);
    }
    // Spine spikes.
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 5), joint);
      sp.position.set(0, 0.3 + i * 0.5, -0.95);
      sp.rotation.x = -0.6;
      torso.add(sp);
    }

    // The amber core — the visual weak point, burning in the ribcage.
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), this.coreMat);
    core.position.set(0, 0.95, 0.85);
    core.userData.noOutline = true;
    this.core = core;
    torso.add(core);
    const halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffb347, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    halo.scale.setScalar(1.7);
    halo.userData.noOutline = true;
    core.add(halo);
    this.coreHalo = halo;

    // Shoulder pauldrons.
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.85, 9, 7, 0, TAU, 0, Math.PI * 0.6), dark);
      pad.position.set(s * 1.85, 1.85, 0);
      torso.add(pad);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 5), bone);
      spike.position.set(s * 2.25, 2.3, 0);
      spike.rotation.z = -s * 0.7;
      torso.add(spike);
    }

    // Arms — pivot at the shoulders; fists hang low for ground slams.
    this.armL = this._arm(bone, dark, joint, -1);
    this.armR = this._arm(bone, dark, joint, 1);
    torso.add(this.armL, this.armR);

    // Skull — horned, jawed, eyes glowing amber.
    const head = new THREE.Group();
    head.position.set(0, 2.35, 0.25);
    this.head = head;
    torso.add(head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 1.1), bone);
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, 0.8), dark);
    jaw.position.set(0, -0.6, 0.15);
    this.jaw = jaw;
    head.add(jaw);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.0, 5), joint);
      horn.position.set(s * 0.62, 0.55, -0.1);
      horn.rotation.z = -s * 0.85;
      head.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), this.eyeMat);
      eye.position.set(s * 0.3, 0.08, 0.56);
      eye.userData.noOutline = true;
      head.add(eye);
    }

    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    addOutline(g, 0.02);
    this._applyDormantPose(1);
  }

  _leg(bone, joint, x) {
    const leg = new THREE.Group();
    leg.position.set(x, 2.1, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 1.2, 7), bone);
    thigh.position.y = -0.55;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 1.1, 7), bone);
    shin.position.y = -1.6;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.35, 1.1), joint);
    foot.position.set(0, -2.05, 0.2);
    leg.add(thigh, shin, foot);
    return leg;
  }

  _arm(bone, dark, joint, side) {
    const arm = new THREE.Group();
    arm.position.set(side * 1.95, 1.75, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 1.5, 7), bone);
    upper.position.y = -0.8;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 7, 6), joint);
    elbow.position.y = -1.6;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.44, 1.7, 7), dark);
    fore.position.y = -2.5;
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), bone);
    fist.position.y = -3.45;
    arm.add(upper, elbow, fore, fist);
    arm.userData.fist = fist;
    arm.rotation.x = 0.12;
    return arm;
  }

  _applyDormantPose(t) {
    // Slumped, kneeling, arms hanging — an ancient statue until disturbed.
    const g = this.group;
    g.position.y = this.ground.heightAt(g.position.x, g.position.z) - 0.85 * t;
    this.torso.rotation.x = 0.42 * t;
    this.head.rotation.x = 0.5 * t;
    this.armL.rotation.x = 0.15 * t + 0.12;
    this.armR.rotation.x = 0.15 * t + 0.12;
    this.legL.rotation.x = -0.5 * t;
    this.legR.rotation.x = 0.55 * t;
  }

  // -------------------------------------------------------------------------
  /** Wake the construct: rise animation, roar, dust. Called by Dungeon. */
  activate() {
    if (!this.alive || this.state !== 'dormant') return;
    this.state = 'rise';
    this.stateT = 0;
    this.touchDamage = 2;
    this.game.audio?.sfx?.('boss_roar');
    this.game.cameraRig.shake(0.4);
    this._burst('dust', 10, 2.2);
  }

  /** Reset to dormant full health (player died or fled mid-fight, new game). */
  reset() {
    this.hp = this.maxHp;
    this.alive = true;
    this.removed = false;
    this._coreBurst = false;
    this.core.visible = true;
    this.state = 'dormant';
    this.stateT = 0;
    this.phase = 1;
    this.touchDamage = 0;
    this._cd = 1.2;
    this._hitFlash = 0;
    this._teleFlash = 0;
    this.yaw = Math.PI;
    this.group.visible = true;
    this.group.rotation.set(0, this.yaw, 0);
    this.group.position.set(this.arena.x, 0, this.arena.z);
    this._applyDormantPose(1);
  }

  /** Permanently retire (shrine already cleared on load). */
  retire() {
    this.alive = false;
    this.state = 'gone';
    this.touchDamage = 0;
    this.group.visible = false;
  }

  // -------------------------------------------------------------------------
  takeDamage(dmg, dir, knockback = 6) {
    if (!this.alive || this.state === 'dormant' || this.state === 'rise' || this.state === 'dying') return false;
    this.hp = Math.max(0, this.hp - dmg);
    this._hitFlash = 1;
    // Massive: barely nudged.
    if (dir) {
      this.group.position.x += dir.x * knockback * 0.02;
      this.group.position.z += dir.z * knockback * 0.02;
    }
    this.game.events.emit('boss:hp', { frac: this.hp / this.maxHp });
    this.game.audio?.sfx?.('boss_hit');
    if (this.hp <= 0) { this._die(); return true; }
    // Phase transitions roar and reset the tempo.
    const frac = this.hp / this.maxHp;
    const newPhase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this._teleFlash = 1;
      this._cd = Math.min(this._cd, 0.8);
      if (newPhase === 3) this._ringTimer = 1.4;
      this.game.audio?.sfx?.('boss_roar');
      this.game.cameraRig.shake(0.35);
      this._burst('explosion', 1, 0, this._coreWorld(_v));
    }
    return false;
  }

  _die() {
    this.alive = false;
    this.touchDamage = 0;
    this.state = 'dying';
    this.stateT = 0;
    const pos = this.group.position;
    this.game.events.emit('enemy:death', { type: 'colossus', pos, enemy: this });
    this.game.events.emit('boss:end', { victory: true });
    this.game.cameraRig.shake(0.6);
    this.game.hitstop(0.18);
    // Gem shower — a fountain of treasure from the shattering core.
    const up = _v.copy(pos); up.y += 3.5;
    const drops = ['gem_red', 'gem_red', 'gem_red', 'gem_blue', 'gem_blue', 'gem_blue',
      'gem_blue', 'gem_green', 'gem_green', 'gem_green', 'gem_green', 'gem_green', 'heart', 'heart'];
    const n = this.game.quality === 'low' ? 9 : drops.length;
    for (let i = 0; i < n; i++) {
      this.game.pickups.push(new Pickup(this.game, drops[i], up, { bounce: true }));
    }
  }

  // -------------------------------------------------------------------------
  update(dt, game) {
    this._corePhase += dt;
    this._hitFlash = Math.max(0, this._hitFlash - dt * 5);
    this._teleFlash = Math.max(0, this._teleFlash - dt * 2.2);
    this._updateGlow();

    if (this.state === 'gone') return;
    if (this.state === 'dormant') {
      // Statue-still but for the slow smoulder of the core.
      this.torso.scale.y = 1 + Math.sin(this._corePhase * 0.7) * 0.006;
      return;
    }
    if (this.state === 'dying') { this._updateDying(dt); return; }

    this.stateT += dt;
    const p = game.player;
    const dx = p.position.x - this.group.position.x;
    const dz = p.position.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);

    switch (this.state) {
      case 'rise': this._updateRise(dt); break;
      case 'pursue': this._updatePursue(dt, game, dist, toPlayer); break;
      case 'slam': this._updateSlam(dt, game, toPlayer); break;
      case 'sweep': this._updateSweep(dt, game, dist); break;
      case 'chargeWind': this._updateChargeWind(dt, toPlayer); break;
      case 'chargeRun': this._updateChargeRun(dt, game); break;
      case 'stunned': this._updateStunned(dt); break;
      case 'ring': this._updateRing(dt, game); break;
    }

    // Keep planted on the arena floor and inside its walls.
    const gp = this.group.position;
    const ax = gp.x - this.arena.x, az = gp.z - this.arena.z;
    const ad = Math.hypot(ax, az);
    if (ad > this.arena.r) {
      gp.x = this.arena.x + (ax / ad) * this.arena.r;
      gp.z = this.arena.z + (az / ad) * this.arena.r;
    }
    if (this.state !== 'rise') gp.y = this.ground.heightAt(gp.x, gp.z);
    this.group.rotation.y = this.yaw;
  }

  _updateRise(dt) {
    const t = clamp01(this.stateT / 1.8);
    this._applyDormantPose(1 - ease.inOutQuad(t));
    if (Math.random() < dt * 14) this._burst('dust', 1, 1.8);
    if (t >= 1) { this.state = 'pursue'; this.stateT = 0; this._cd = 1.0; }
  }

  _updatePursue(dt, game, dist, toPlayer) {
    const ph = this.phase;
    this.yaw = dampAngle(this.yaw, toPlayer, 2.4 + ph * 0.5, dt);
    const speed = WALK_SPEED[ph];
    if (dist > 3.4) {
      this.group.position.x += Math.sin(this.yaw) * speed * dt;
      this.group.position.z += Math.cos(this.yaw) * speed * dt;
      this._walkT += dt * (1.6 + ph * 0.35);
      this._walkAnim(this._walkT, game);
    } else {
      this._walkAnim(this._walkT, game, true);
    }

    // Phase 3 shockwave rings fire on their own clock.
    if (ph === 3) {
      this._ringTimer -= dt;
      if (this._ringTimer <= 0) { this._enter('ring'); return; }
    }

    this._cd -= dt;
    if (this._cd > 0) return;
    if (dist < 5.0) this._enter('slam');
    else if (ph >= 2 && dist < 7.5 && Math.random() < 0.5) this._enter('sweep');
    else if (ph >= 2 && dist > 7.5) this._enter('chargeWind');
    else if (dist < 6.5) this._enter('slam');
  }

  _enter(state) {
    this.state = state;
    this.stateT = 0;
    this._hitDone = false;
    this._teleFlash = 1;
    if (state === 'chargeWind' || state === 'ring') this.game.audio?.sfx?.('boss_roar');
  }

  _walkAnim(t, game, still = false) {
    const amp = still ? 0.08 : 0.5;
    this.legL.rotation.x = Math.sin(t) * amp;
    this.legR.rotation.x = -Math.sin(t) * amp;
    this.armL.rotation.x = 0.12 - Math.sin(t) * amp * 0.4;
    this.armR.rotation.x = 0.12 + Math.sin(t) * amp * 0.4;
    this.torso.rotation.x = 0.06;
    this.torso.rotation.z = Math.sin(t) * 0.05;
    this.torso.rotation.y = damp(this.torso.rotation.y, 0, 8, 0.016);
    this.head.rotation.x = -0.05;
    // Heavy footfalls: dust + tremor each stride.
    if (!still) {
      const side = Math.sin(t) > 0 ? 1 : -1;
      if (side !== this._stepSide) {
        this._stepSide = side;
        _v.copy(this.group.position);
        _v.x += Math.sin(this.yaw + side * 1.2) * 1.1;
        _v.z += Math.cos(this.yaw + side * 1.2) * 1.1;
        game.particles?.emit?.('dust', _v);
        const d = Math.hypot(game.player.position.x - this.group.position.x,
          game.player.position.z - this.group.position.z);
        if (d < 18) game.cameraRig.shake(0.06);
      }
    }
  }

  _updateSlam(dt, game, toPlayer) {
    const t = clamp01(this.stateT / SLAM_TIME);
    if (t < 0.5) {
      // Windup: track the player, arm hauled skyward, glow building.
      this.yaw = dampAngle(this.yaw, toPlayer, 3.5, dt);
      const w = ease.inOutQuad(t / 0.5);
      this.armR.rotation.x = lerp(0.12, -2.5, w);
      this.torso.rotation.x = lerp(0.06, -0.28, w);
      this.torso.rotation.y = lerp(0, -0.35, w);
      this._teleFlash = Math.max(this._teleFlash, w * 0.8);
    } else if (t < 0.64) {
      // Strike: the fist comes down like a falling tower.
      const w = ease.inCubic((t - 0.5) / 0.14);
      this.armR.rotation.x = lerp(-2.5, 0.9, w);
      this.torso.rotation.x = lerp(-0.28, 0.42, w);
      this.torso.rotation.y = lerp(-0.35, 0.1, w);
      if (!this._hitDone && w > 0.85) {
        this._hitDone = true;
        this._impactAt(game, this.yaw, 3.4, 3.6, 4, 9);
      }
    } else {
      const w = ease.inOutQuad((t - 0.64) / 0.36);
      this.armR.rotation.x = lerp(0.9, 0.12, w);
      this.torso.rotation.x = lerp(0.42, 0.06, w);
      this.torso.rotation.y = lerp(0.1, 0, w);
    }
    if (t >= 1) { this.state = 'pursue'; this.stateT = 0; this._cd = ATTACK_CD[this.phase]; }
  }

  /** Ground impact in front of the boss: dust ring, tremor, radial damage. */
  _impactAt(game, yaw, fwdDist, radius, dmg, kb) {
    _v.copy(this.group.position);
    _v.x += Math.sin(yaw) * fwdDist;
    _v.z += Math.cos(yaw) * fwdDist;
    _v.y = this.ground.heightAt(_v.x, _v.z) + 0.2;
    game.particles?.emit?.('explosion', _v);
    for (let i = 0; i < 6; i++) game.particles?.emit?.('dust', _v);
    game.cameraRig.shake(0.35);
    game.audio?.sfx?.('explosion');
    const p = game.player;
    const d = Math.hypot(p.position.x - _v.x, p.position.z - _v.z);
    if (d < radius && p.alive) p.takeDamage(dmg, _v, kb);
  }

  _updateSweep(dt, game, dist) {
    const t = clamp01(this.stateT / SWEEP_TIME);
    if (t < 0.42) {
      // Windup: left arm cocked far across the body.
      const w = ease.inOutQuad(t / 0.42);
      this.armL.rotation.x = lerp(0.12, -1.5, w);
      this.armL.rotation.z = lerp(0, -1.1, w);
      this.torso.rotation.y = lerp(0, 1.0, w);
      this._teleFlash = Math.max(this._teleFlash, w * 0.7);
    } else if (t < 0.66) {
      // The arc: torso whips around, arm scything at chest height.
      const w = (t - 0.42) / 0.24;
      const sweepYaw = this.yaw + lerp(1.0, -1.3, w);
      this.torso.rotation.y = lerp(1.0, -1.3, w);
      this.armL.rotation.x = -1.5;
      this.armL.rotation.z = -1.1;
      if (!this._hitDone && dist < 5.6) {
        const p = game.player;
        const a = Math.atan2(p.position.x - this.group.position.x, p.position.z - this.group.position.z);
        let da = a - sweepYaw;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) < 0.6 && p.alive) {
          this._hitDone = true;
          p.takeDamage(4, this.group.position, 10);
        }
      }
    } else {
      const w = ease.inOutQuad((t - 0.66) / 0.34);
      this.armL.rotation.x = lerp(-1.5, 0.12, w);
      this.armL.rotation.z = lerp(-1.1, 0, w);
      this.torso.rotation.y = lerp(-1.3, 0, w);
    }
    if (t >= 1) { this.state = 'pursue'; this.stateT = 0; this._cd = ATTACK_CD[this.phase]; }
  }

  _updateChargeWind(dt, toPlayer) {
    const t = clamp01(this.stateT / CHARGE_WIND);
    // Lean back, paw the ground, core blazing — unmistakable "get out of the way".
    this.yaw = dampAngle(this.yaw, toPlayer, 4, dt);
    this.torso.rotation.x = lerp(0.06, -0.4, ease.inOutQuad(t));
    this.armL.rotation.x = this.armR.rotation.x = lerp(0.12, -0.7, t);
    this.legR.rotation.x = Math.sin(this.stateT * 18) * 0.2 * t;
    this._teleFlash = Math.max(this._teleFlash, t);
    this.group.position.x -= Math.sin(this.yaw) * dt * 0.8;
    this.group.position.z -= Math.cos(this.yaw) * dt * 0.8;
    if (t >= 1) {
      this._chargeDir.x = Math.sin(this.yaw);
      this._chargeDir.z = Math.cos(this.yaw);
      this.state = 'chargeRun';
      this.stateT = 0;
      this._hitDone = false;
      this.game.cameraRig.shake(0.2);
    }
  }

  _updateChargeRun(dt, game) {
    const speed = 15;
    const gp = this.group.position;
    gp.x += this._chargeDir.x * speed * dt;
    gp.z += this._chargeDir.z * speed * dt;
    this.torso.rotation.x = 0.5;
    this.armL.rotation.x = this.armR.rotation.x = -1.1;
    this.legL.rotation.x = Math.sin(this.stateT * 22) * 0.7;
    this.legR.rotation.x = -Math.sin(this.stateT * 22) * 0.7;
    if (Math.random() < dt * 20) this._burst('dust', 1, 1.4);

    // Shoulder connects.
    const p = game.player;
    if (!this._hitDone && p.alive) {
      const d = Math.hypot(p.position.x - gp.x, p.position.z - gp.z);
      if (d < 3.0) {
        this._hitDone = true;
        p.takeDamage(5, gp, 13);
        game.cameraRig.shake(0.3);
      }
    }
    // Slams into the arena wall or runs out of steam → stagger, wide-open.
    const ad = Math.hypot(gp.x - this.arena.x, gp.z - this.arena.z);
    if (ad > this.arena.r - 1.5 || this.stateT > CHARGE_MAX) {
      this.state = 'stunned';
      this.stateT = 0;
      if (ad > this.arena.r - 1.5) {
        game.cameraRig.shake(0.4);
        game.audio?.sfx?.('explosion');
        this._burst('dust', 8, 2.5);
      }
    }
  }

  _updateStunned(dt) {
    // Reeling — the punish window.
    const t = clamp01(this.stateT / 1.1);
    this.torso.rotation.x = lerp(0.5, 0.06, ease.outQuad(t));
    this.torso.rotation.z = Math.sin(this.stateT * 9) * 0.12 * (1 - t);
    this.armL.rotation.x = this.armR.rotation.x = lerp(-1.1, 0.12, t);
    this.legL.rotation.x = damp(this.legL.rotation.x, 0, 6, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, 0, 6, dt);
    this.head.rotation.z = Math.sin(this.stateT * 11) * 0.2 * (1 - t);
    if (t >= 1) { this.state = 'pursue'; this.stateT = 0; this._cd = ATTACK_CD[this.phase] * 0.7; this.head.rotation.z = 0; }
  }

  _updateRing(dt, game) {
    const t = clamp01(this.stateT / RING_TIME);
    // Rear up, core swelling — then a ring of burning shards.
    this.torso.rotation.x = lerp(0.06, -0.5, ease.inOutQuad(Math.min(t / 0.6, 1)));
    this.armL.rotation.x = this.armR.rotation.x = lerp(0.12, -2.2, Math.min(t / 0.6, 1));
    this.armL.rotation.z = -0.5; this.armR.rotation.z = 0.5;
    this._teleFlash = Math.max(this._teleFlash, Math.min(t / 0.6, 1));
    this.core.scale.setScalar(1 + Math.min(t / 0.6, 1) * 0.6);
    if (!this._hitDone && t >= 0.62) {
      this._hitDone = true;
      this._coreWorld(_v);
      _v.y = this.group.position.y + 1.2;
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.yaw;
        _v2.set(Math.sin(a) * 10.5, 0, Math.cos(a) * 10.5);
        game.combat.spawnProjectile({
          pos: _v, vel: _v2, r: 0.42, dmg: 2, from: 'enemy',
          color: 0xffb347, life: 2.6,
        });
      }
      game.cameraRig.shake(0.3);
      game.audio?.sfx?.('bolt');
      game.particles?.emit?.('explosion', _v);
    }
    if (t >= 1) {
      this.state = 'pursue';
      this.stateT = 0;
      this.core.scale.setScalar(1);
      this.armL.rotation.z = this.armR.rotation.z = 0;
      this._ringTimer = RING_PERIOD;
      this._cd = ATTACK_CD[3] * 0.8;
    }
  }

  _updateDying(dt) {
    this.stateT += dt;
    const t = clamp01(this.stateT / DIE_TIME);
    const g = this.group;
    // Slow crumble: shudder, sag, knees buckling, plates grinding...
    g.rotation.y = this.yaw + Math.sin(this.stateT * 21) * 0.05 * (1 - t);
    this.torso.rotation.x = lerp(0.06, 0.9, ease.inQuad(t));
    this.head.rotation.x = lerp(-0.05, 0.8, t);
    this.armL.rotation.x = this.armR.rotation.x = lerp(0.12, 0.55, t);
    this.legL.rotation.x = lerp(0, -0.7, t);
    this.legR.rotation.x = lerp(0, 0.75, t);
    g.position.y = this.ground.heightAt(g.position.x, g.position.z) - ease.inCubic(t) * 3.2;
    if (Math.random() < dt * 10) {
      _v.copy(g.position);
      _v.x += (Math.random() - 0.5) * 3.5;
      _v.z += (Math.random() - 0.5) * 3.5;
      _v.y += 1 + Math.random() * 2.5;
      this.game.particles?.emit?.('dust', _v);
    }
    // ...then the core shatters in a flash of amber.
    if (!this._coreBurst && t > 0.8) {
      this._coreBurst = true;
      this._coreWorld(_v);
      this.game.particles?.emit?.('explosion', _v);
      this.game.particles?.emit?.('soul', _v);
      this.game.audio?.sfx?.('explosion');
      this.game.cameraRig.shake(0.5);
      this.core.visible = false;
    }
    if (t >= 1) {
      this.removed = true;
      this.group.visible = false;
      this.state = 'gone';
    }
  }

  // -------------------------------------------------------------------------
  _coreWorld(out) { return this.core.getWorldPosition(out); }

  /** Scatter n particles of `type` around a point (default: the boss's feet). */
  _burst(type, n, spread, at = null) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      _v2.copy(at || this.group.position);
      if (spread > 0) {
        _v2.x += (Math.random() - 0.5) * spread * 2;
        _v2.z += (Math.random() - 0.5) * spread * 2;
        _v2.y += 0.3 + Math.random() * 0.5;
      }
      g.particles?.emit?.(type, _v2);
    }
  }

  _updateGlow() {
    // Core breathes; telegraphs and hits push it to a blaze; bone flashes white.
    const pulse = 0.82 + Math.sin(this._corePhase * 3.1) * 0.18;
    const boost = 1 + this._teleFlash * 1.4 + this._hitFlash * 0.5;
    this.coreMat.color.copy(this._coreColor).multiplyScalar(pulse * boost);
    this.eyeMat.color.copy(this._eyeColor).multiplyScalar(0.85 + this._teleFlash * 0.8);
    this.coreHalo.scale.setScalar(1.7 + this._teleFlash * 0.8 + Math.sin(this._corePhase * 3.1) * 0.12);
    const f = this._hitFlash * 0.85 + this._teleFlash * 0.22;
    this.boneMat.emissive.setRGB(f, f * 0.92, f * 0.75);
    this.boneDarkMat.emissive.setRGB(f, f * 0.92, f * 0.75);
  }
}
