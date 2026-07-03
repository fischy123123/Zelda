import * as THREE from 'three';

// Follow camera with mouse/touch orbit, terrain avoidance, Z-target lock-on
// (frames the player against the locked enemy), and an optional auto-follow
// that eases in behind the player on touch devices so one thumb can play.
export class ThirdPersonCamera {
  constructor(camera, terrain, { autoFollow = false } = {}) {
    this.camera = camera;
    this.terrain = terrain;
    this.autoFollow = autoFollow;
    this.lockTarget = null;      // enemy object with .mesh / .dead
    this.yaw = Math.PI;
    this.pitch = 0.35;
    this.distance = 8;
    this.minPitch = -0.2;
    this.maxPitch = 1.2;
    this.sensitivity = 0.0026;
    this._desired = new THREE.Vector3();
    this._userLook = 0;          // seconds since the player last dragged the view
  }

  updateFromInput(input, dt = 0.016) {
    const { dx, dy } = input.consumeMouseDelta();
    if (dx !== 0 || dy !== 0) this._userLook = 1.6;
    this.yaw -= dx * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * this.sensitivity, this.minPitch, this.maxPitch);
    this._userLook = Math.max(0, this._userLook - dt);
  }

  _easeYaw(target, k) {
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, k);
  }

  follow(target, dt) {
    // Z-target: swing behind the player relative to the enemy.
    if (this.lockTarget && !this.lockTarget.dead) {
      const tp = target.position, ep = this.lockTarget.mesh.position;
      this._easeYaw(Math.atan2(tp.x - ep.x, tp.z - ep.z), dt * 4.5);
      this.pitch += (0.3 - this.pitch) * Math.min(1, dt * 3);
    } else if (this.autoFollow && target.isMoving && this._userLook <= 0) {
      // Touch assist: drift in behind the direction of travel.
      this._easeYaw(target.facing + Math.PI, dt * 1.8);
    }

    const look = target.position.clone();
    look.y += 1.4;

    const horiz = Math.cos(this.pitch) * this.distance;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * horiz,
      Math.sin(this.pitch) * this.distance + 1.0,
      Math.cos(this.yaw) * horiz
    );
    this._desired.copy(look).add(offset);

    const groundY = this.terrain.getHeightAt(this._desired.x, this._desired.z) + 1.2;
    if (this._desired.y < groundY) this._desired.y = groundY;

    this.camera.position.lerp(this._desired, Math.min(1, dt * 10));
    this.camera.lookAt(look);
  }

  snap(target) {
    this.follow(target, 1000);
    this.camera.position.copy(this._desired);
  }
}
