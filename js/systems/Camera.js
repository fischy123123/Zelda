// Third-person orbit camera with spring smoothing, terrain avoidance,
// lock-on framing, sprint FOV kick, and trauma-based shake.

import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from '../util/math.js';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _enemyPos = new THREE.Vector3();

export class ThirdPersonCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI;          // behind player facing north
    this.pitch = -0.22;
    this.distance = 7.6;
    this.targetDistance = 7.6;
    this.baseFov = 55;
    this.shakeTrauma = 0;
    this.lockTarget = null;      // enemy object with .group.position
    this._pos = new THREE.Vector3(0, 20, 20);
    this._smoothedTargetY = 0;
    this._first = true;
  }

  shake(amount) { this.shakeTrauma = Math.min(1, this.shakeTrauma + amount); }

  /** Yaw the player-relative movement basis should use. */
  getYaw() { return this.yaw; }

  update(dt, input, player, timeScale = 1) {
    // Orbit from look input.
    const sens = 0.0026;
    this.yaw -= input.look.dx * sens;
    this.pitch = clamp(this.pitch - input.look.dy * sens, -1.15, 0.55);
    this.targetDistance = clamp(this.targetDistance + input.wheel * 0.8, 2.6, 20);

    // Lock-on gently steers yaw to keep player+enemy framed.
    if (this.lockTarget && this.lockTarget.alive) {
      this.lockTarget.group.getWorldPosition(_enemyPos);
      const toEnemy = Math.atan2(
        player.position.x - _enemyPos.x,
        player.position.z - _enemyPos.z
      );
      this.yaw = dampAngle(this.yaw, toEnemy, 3.2, dt);
      this.pitch = damp(this.pitch, -0.18, 2.5, dt);
    } else if (this.lockTarget) {
      this.lockTarget = null;
    }

    // Follow point: player chest height; smooth vertical so steps don't pop.
    _target.copy(player.position);
    const wantY = player.position.y + 1.45;
    this._smoothedTargetY = this._first ? wantY : damp(this._smoothedTargetY, wantY, 8, dt);
    _target.y = this._smoothedTargetY;

    this.distance = damp(this.distance, this.targetDistance, 6, dt);

    // Desired camera position on the orbit sphere.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _desired.set(
      _target.x + Math.sin(this.yaw) * cp * this.distance,
      _target.y - sp * this.distance,
      _target.z + Math.cos(this.yaw) * cp * this.distance
    );

    // Terrain avoidance: march along target→camera, pull in before ground hits.
    let occlDist = this.distance;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = lerp(_target.x, _desired.x, t);
      const sy = lerp(_target.y, _desired.y, t);
      const sz = lerp(_target.z, _desired.z, t);
      const ground = (player.groundProvider || this.terrain).heightAt(sx, sz);
      if (sy < ground + 0.5) { occlDist = Math.max(1.6, this.distance * t - 0.4); break; }
    }
    const d = occlDist / this.distance;
    _desired.set(
      lerp(_target.x, _desired.x, d),
      Math.max(lerp(_target.y, _desired.y, d), (player.groundProvider || this.terrain).heightAt(_desired.x, _desired.z) + 0.55),
      lerp(_target.z, _desired.z, d)
    );

    // Spring toward desired (snappier when locked on).
    if (this._first) { this._pos.copy(_desired); this._first = false; }
    const rate = this.lockTarget ? 10 : 7;
    this._pos.x = damp(this._pos.x, _desired.x, rate, dt);
    this._pos.y = damp(this._pos.y, _desired.y, rate, dt);
    this._pos.z = damp(this._pos.z, _desired.z, rate, dt);

    // Shake: decaying trauma → perlin-ish offset.
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);
    const sh = this.shakeTrauma * this.shakeTrauma;
    const t2 = performance.now() * 0.001;
    const shakeX = Math.sin(t2 * 37.7) * sh * 0.35;
    const shakeY = Math.cos(t2 * 41.3) * sh * 0.3;

    this.camera.position.set(this._pos.x + shakeX, this._pos.y + shakeY, this._pos.z);

    // Look-at: midpoint bias toward lock target.
    _lookAt.copy(_target);
    if (this.lockTarget) {
      this.lockTarget.group.getWorldPosition(_enemyPos);
      _lookAt.lerp(_enemyPos.setY(_enemyPos.y + 1), 0.32);
    }
    this.camera.lookAt(_lookAt);
    this.camera.rotation.z += Math.sin(t2 * 31.1) * sh * 0.02;

    // FOV: widen when sprinting fast for a speed rush.
    const speedFrac = clamp(player.horizontalSpeed / 10.5, 0, 1);
    const targetFov = this.baseFov + (player.sprinting ? speedFrac * 8 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  /** Instantly snap behind the player (spawn, teleport). */
  snapBehind(player, yaw = null) {
    if (yaw !== null) this.yaw = yaw;
    this._first = true;
    this.update(0.016, { look: { dx: 0, dy: 0 }, wheel: 0 }, player);
  }
}
