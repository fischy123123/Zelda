// The hero's controller: movement physics, stamina, jumping, rolling,
// sword combos, guarding, swimming, damage/i-frames. Purely mechanical —
// all visuals live in HeroModel (js/entities/HeroModel.js), which this
// class drives through a pose object every frame.

import * as THREE from 'three';
import { clamp, clamp01, damp, dampAngle, lerp } from '../util/math.js';

const _fwd = new THREE.Vector3();
const _move = new THREE.Vector3();

// Tuning — all speeds in units/second; 1 unit ≈ 1 meter.
const WALK_SPEED = 6.2;
const SPRINT_SPEED = 9.6;
const GUARD_SPEED = 2.4;
const SWIM_SPEED = 3.4;
const ACCEL = 34;
const DECEL = 26;
const TURN_RATE = 13;
const GRAVITY = -26;
const JUMP_VEL = 9.2;
const ROLL_SPEED = 11.5;
const ROLL_TIME = 0.46;
const ATTACK_TIME = 0.38;
const COMBO_WINDOW = 0.62;   // seconds after a swing during which the next chains
const SPIN_CHARGE_TIME = 0.55;
const SPIN_TIME = 0.62;
const HURT_TIME = 0.42;
const IFRAME_TIME = 0.9;

const STAMINA = {
  sprint: 16,   // per second
  swim: 9,      // per second
  jump: 6,
  roll: 22,
  spin: 25,
  guardHit: 14,
  regen: 30,    // per second (delayed after use)
  regenDelay: 0.55,
};

export class Player {
  constructor(game) {
    this.game = game;
    this.position = new THREE.Vector3(0, 20, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.radius = 0.55;
    this.height = 1.7;

    this.grounded = false;
    this.sprinting = false;
    this.guarding = false;
    this.swimming = false;
    this.alive = true;
    this.horizontalSpeed = 0;
    this.groundProvider = game.terrain; // swapped by dungeon

    // Timed states (null or {t: seconds elapsed, ...}).
    this.attack = null;   // {index: 0..2 | 'spin', t, hitSet:Set}
    this.roll = null;     // {t, dirX, dirZ}
    this.hurt = null;     // {t}
    this.charge = 0;      // spin charge accumulator while attack held
    this._comboTimer = 0; // time left to chain next swing
    this._nextCombo = 0;
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._staminaDelay = 0;
    this._iframes = 0;
    this._airTime = 0;
    this.idleTime = 0;
    this._stepAccum = 0;
    this.model = null;    // HeroModel attached by Game after construction
  }

  get invulnerable() {
    return this._iframes > 0 || (this.roll && this.roll.t > 0.04 && this.roll.t < 0.32);
  }

  get busy() { return !!(this.attack || this.roll || this.hurt) || !this.alive; }

  spendStamina(amount) {
    const s = this.game.state;
    s.stamina = Math.max(0, s.stamina - amount);
    this._staminaDelay = STAMINA.regenDelay;
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const input = g.input;
    const s = g.state;
    const ground = this.groundProvider;

    const groundY = ground.heightAt(this.position.x, this.position.z);
    const waterY = ground.waterLevel ?? -Infinity;
    const inWaterDepth = waterY - groundY;
    this.swimming = this.alive && inWaterDepth > 1.15 && this.position.y < waterY + 0.4;

    // --- intent -------------------------------------------------------------
    const camYaw = g.cameraRig.getYaw();
    let ix = 0, iz = 0;
    if (this.alive && !g.uiBlocked) { ix = input.move.x; iz = input.move.z; }
    const wantMove = Math.hypot(ix, iz) > 0.01;
    let targetYaw = this.yaw;
    if (wantMove) {
      // Camera-relative move direction.
      _move.set(ix, 0, iz).normalize();
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      _fwd.set(_move.x * cos - _move.z * sin, 0, _move.x * sin + _move.z * cos).multiplyScalar(-1);
      targetYaw = Math.atan2(_fwd.x, _fwd.z);
    }

    // --- state machines -------------------------------------------------------
    this._updateTimers(dt);

    if (this.alive && !g.uiBlocked) {
      this._handleActions(dt, input, wantMove, targetYaw);
    } else {
      this.guarding = false; this.sprinting = false;
    }

    // --- locomotion -----------------------------------------------------------
    let maxSpeed = 0;
    if (this.roll) {
      maxSpeed = ROLL_SPEED * (1 - 0.5 * clamp01(this.roll.t / ROLL_TIME));
      this.velocity.x = this.roll.dirX * maxSpeed;
      this.velocity.z = this.roll.dirZ * maxSpeed;
      this.yaw = Math.atan2(this.roll.dirX, this.roll.dirZ);
    } else if (this.hurt || !this.alive) {
      // Knockback decays; no control.
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    } else {
      const attacking = !!this.attack;
      this.sprinting = this.alive && input.held('sprint') && wantMove && !this.guarding &&
        !this.swimming && !attacking && s.stamina > 0.5;
      if (this.swimming) maxSpeed = SWIM_SPEED;
      else if (this.guarding) maxSpeed = GUARD_SPEED;
      else if (attacking) maxSpeed = wantMove ? 1.6 : 0;
      else maxSpeed = this.sprinting ? SPRINT_SPEED : WALK_SPEED;

      if (wantMove) {
        this.yaw = dampAngle(this.yaw, targetYaw, this.guarding ? 8 : TURN_RATE, dt);
        const spd = Math.hypot(this.velocity.x, this.velocity.z);
        const newSpd = Math.min(maxSpeed, spd + ACCEL * dt);
        this.velocity.x = Math.sin(this.yaw) * newSpd;
        this.velocity.z = Math.cos(this.yaw) * newSpd;
      } else {
        const spd = Math.hypot(this.velocity.x, this.velocity.z);
        const newSpd = Math.max(0, spd - DECEL * dt);
        if (spd > 1e-4) {
          this.velocity.x *= newSpd / spd;
          this.velocity.z *= newSpd / spd;
        }
      }
      // Lock-on strafing: face the target while moving.
      const lock = g.cameraRig.lockTarget;
      if (lock && lock.alive && !attacking && !this.swimming) {
        const lp = lock.group.position;
        this.yaw = dampAngle(this.yaw, Math.atan2(lp.x - this.position.x, lp.z - this.position.z), 10, dt);
      }
    }

    // Stamina drain / regen.
    if (this.sprinting) this.spendStamina(STAMINA.sprint * dt);
    if (this.swimming) {
      this.spendStamina(STAMINA.swim * dt);
      if (s.stamina <= 0) this._drown();
    }
    if (this._staminaDelay <= 0 && !this.sprinting && !this.swimming) {
      s.stamina = Math.min(s.maxStamina, s.stamina + STAMINA.regen * dt);
    }

    // --- vertical -------------------------------------------------------------
    if (this.swimming) {
      // Bob at the surface.
      this.velocity.y = 0;
      this.position.y = damp(this.position.y, waterY - 0.55, 10, dt);
      this.grounded = false;
    } else {
      this.velocity.y += GRAVITY * dt;
      this.position.y += this.velocity.y * dt;
      if (this.position.y <= groundY) {
        if (this._airTime > 0.35 && this.velocity.y < -14) {
          g.events.emit('player:land', { hard: true });
          g.cameraRig.shake(0.18);
        }
        this.position.y = groundY;
        this.velocity.y = 0;
        if (!this.grounded) g.events.emit('player:land', { hard: false });
        this.grounded = true;
        this._coyote = 0.12;
        this._airTime = 0;
      } else if (this.position.y > groundY + 0.05) {
        this.grounded = false;
        this._airTime += dt;
      }
    }

    // --- horizontal + collision ----------------------------------------------
    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;

    // Steep-slope check: refuse moves that climb walls.
    const newGround = ground.heightAt(nx, nz);
    const rise = newGround - groundY;
    const runLen = Math.hypot(nx - this.position.x, nz - this.position.z);
    if (this.grounded && runLen > 1e-5 && rise / runLen > 1.7) {
      // Try sliding along each axis.
      const gx = ground.heightAt(nx, this.position.z);
      const gz = ground.heightAt(this.position.x, nz);
      if ((gx - groundY) / Math.max(Math.abs(nx - this.position.x), 1e-5) <= 1.7) nz = this.position.z;
      else if ((gz - groundY) / Math.max(Math.abs(nz - this.position.z), 1e-5) <= 1.7) nx = this.position.x;
      else { nx = this.position.x; nz = this.position.z; }
    }

    const solved = g.colliders.resolve(nx, nz, this.radius, this.position.y);
    this.position.x = solved.x;
    this.position.z = solved.z;

    if (this.grounded && !this.swimming) {
      this.position.y = ground.heightAt(this.position.x, this.position.z);
    }

    this.horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.idleTime = (this.horizontalSpeed < 0.2 && !this.busy) ? this.idleTime + dt : 0;

    // Footstep events for audio/particles.
    if (this.grounded && this.horizontalSpeed > 1) {
      this._stepAccum += this.horizontalSpeed * dt;
      const stride = this.sprinting ? 3.1 : 2.4;
      if (this._stepAccum > stride) {
        this._stepAccum = 0;
        g.events.emit('player:step', {
          pos: this.position,
          biome: ground.biomeAt ? ground.biomeAt(this.position.x, this.position.z).id : 'stone',
          sprint: this.sprinting,
        });
      }
    }

    // --- drive the visual model ----------------------------------------------
    if (this.model) {
      const grp = this.model.group;
      grp.position.copy(this.position);
      grp.rotation.y = this.yaw;
      this.model.update(dt, {
        speed: this.horizontalSpeed,
        runBlend: clamp01(this.horizontalSpeed / WALK_SPEED),
        sprinting: this.sprinting,
        grounded: this.grounded,
        yVel: this.velocity.y,
        guarding: this.guarding,
        swimming: this.swimming,
        attack: this.attack ? { index: this.attack.index, t: this.attack.t / (this.attack.index === 'spin' ? SPIN_TIME : ATTACK_TIME) } : null,
        roll: this.roll ? { t: this.roll.t / ROLL_TIME } : null,
        hurt: this.hurt ? { t: this.hurt.t / HURT_TIME } : null,
        dead: !this.alive,
        charge: clamp01(this.charge / SPIN_CHARGE_TIME),
        idleTime: this.idleTime,
        iframes: this._iframes > 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  _updateTimers(dt) {
    if (this.attack) {
      this.attack.t += dt;
      const dur = this.attack.index === 'spin' ? SPIN_TIME : ATTACK_TIME;
      if (this.attack.t >= dur) {
        this._comboTimer = this.attack.index === 'spin' ? 0 : COMBO_WINDOW;
        this.attack = null;
      }
    }
    if (this.roll) {
      this.roll.t += dt;
      if (this.roll.t >= ROLL_TIME) this.roll = null;
    }
    if (this.hurt) {
      this.hurt.t += dt;
      if (this.hurt.t >= HURT_TIME) this.hurt = null;
    }
    this._comboTimer = Math.max(0, this._comboTimer - dt);
    this._coyote = Math.max(0, this._coyote - dt);
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._staminaDelay = Math.max(0, this._staminaDelay - dt);
    this._iframes = Math.max(0, this._iframes - dt);
  }

  _handleActions(dt, input, wantMove, targetYaw) {
    const s = this.game.state;

    // Guard (hold) — grounded, not mid-action.
    this.guarding = input.held('guard') && this.grounded && !this.busy && !this.swimming;

    // Spin charge: holding attack after a swing finishes charges the spin.
    if (input.held('attack') && !this.attack && !this.roll && !this.swimming && this._comboTimer <= 0 && this.charge >= 0) {
      if (this._chargeArmed) this.charge += dt;
    } else if (this.charge > 0 && !input.held('attack')) {
      if (this.charge >= SPIN_CHARGE_TIME && s.stamina > 5) {
        this.attack = { index: 'spin', t: 0, hitSet: new Set() };
        this.spendStamina(STAMINA.spin);
        this.game.events.emit('player:attack', { index: 'spin' });
      }
      this.charge = 0;
      this._chargeArmed = false;
    }

    // Attack (edge) — combo chain.
    if (input.pressed('attack') && !this.roll && !this.hurt && !this.swimming && !this.guarding) {
      if (!this.attack) {
        const index = this._comboTimer > 0 ? this._nextCombo : 0;
        this.attack = { index, t: 0, hitSet: new Set() };
        this._nextCombo = (index + 1) % 3;
        this._chargeArmed = index === 0; // holding after first swing charges spin
        if (wantMove) this.yaw = targetYaw; // snap toward intended direction
        this.game.events.emit('player:attack', { index });
      }
    }

    // Jump — buffered + coyote time.
    if (input.pressed('jump')) this._jumpBuffer = 0.14;
    if (this._jumpBuffer > 0 && (this.grounded || this._coyote > 0) && !this.busy && !this.swimming && !this.guarding) {
      this._jumpBuffer = 0;
      this._coyote = 0;
      this.velocity.y = JUMP_VEL;
      this.grounded = false;
      this.spendStamina(STAMINA.jump);
      this.game.events.emit('player:jump', { pos: this.position });
    }

    // Roll — dodge with i-frames.
    if (input.pressed('roll') && this.grounded && !this.busy && !this.swimming && s.stamina > 5) {
      const yaw = wantMove ? targetYaw : this.yaw;
      this.roll = { t: 0, dirX: Math.sin(yaw), dirZ: Math.cos(yaw) };
      this.attack = null;
      this.charge = 0;
      this.spendStamina(STAMINA.roll);
      this.game.events.emit('player:roll', { pos: this.position });
    }
  }

  // -------------------------------------------------------------------------
  /** amount in quarter-hearts. Returns true if damage landed. */
  takeDamage(amount, sourcePos = null, knockback = 7) {
    const g = this.game;
    if (!this.alive || this.invulnerable) return false;

    // Guard: blocks frontal hits at reduced damage.
    if (this.guarding && sourcePos) {
      const toSrc = Math.atan2(sourcePos.x - this.position.x, sourcePos.z - this.position.z);
      let d = toSrc - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 1.15) {
        this.spendStamina(STAMINA.guardHit);
        amount = Math.max(1, Math.floor(amount * 0.25));
        g.events.emit('player:block', { pos: this.position });
        this._applyKnockback(sourcePos, knockback * 0.5);
        g.state.hp = Math.max(0, g.state.hp - amount);
        g.events.emit('player:damage', { amount, hp: g.state.hp, blocked: true });
        if (g.state.hp <= 0) this._die();
        return true;
      }
    }

    g.state.hp = Math.max(0, g.state.hp - amount);
    this.hurt = { t: 0 };
    this.attack = null;
    this.charge = 0;
    this._iframes = IFRAME_TIME;
    if (sourcePos) this._applyKnockback(sourcePos, knockback);
    g.cameraRig.shake(0.32);
    g.events.emit('player:damage', { amount, hp: g.state.hp, blocked: false });
    if (g.state.hp <= 0) this._die();
    return true;
  }

  _applyKnockback(sourcePos, strength) {
    const dx = this.position.x - sourcePos.x;
    const dz = this.position.z - sourcePos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.velocity.x = (dx / d) * strength;
    this.velocity.z = (dz / d) * strength;
  }

  heal(quarterHearts) {
    const s = this.game.state;
    s.hp = Math.min(s.maxHp, s.hp + quarterHearts);
    this.game.events.emit('player:heal', { hp: s.hp });
  }

  _drown() {
    // Out of stamina in deep water: take damage, teleport to last dry land.
    this.game.state.hp = Math.max(0, this.game.state.hp - 2);
    this.game.events.emit('player:damage', { amount: 2, hp: this.game.state.hp, drown: true });
    if (this.game.state.hp <= 0) { this._die(); return; }
    const p = this._lastDry || { x: 0, z: 0 };
    this.position.set(p.x, this.groundProvider.heightAt(p.x, p.z) + 0.5, p.z);
    this.velocity.set(0, 0, 0);
    this.game.state.stamina = this.game.state.maxStamina * 0.4;
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.game.events.emit('player:death', {});
  }

  respawn(x, z, yaw = 0) {
    this.alive = true;
    this.position.set(x, this.groundProvider.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.attack = this.roll = this.hurt = null;
    this.charge = 0;
    this._iframes = 1.2;
    this.game.events.emit('player:respawn', {});
  }

  noteDryLand() {
    if (this.grounded && !this.swimming) {
      this._lastDry = { x: this.position.x, z: this.position.z };
    }
  }
}
