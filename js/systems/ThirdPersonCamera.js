import * as THREE from 'three';

// A follow camera that orbits the hero with the mouse and pulls in to avoid
// clipping through the terrain.
export class ThirdPersonCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI;       // start looking toward +Z (behind the hero)
    this.pitch = 0.35;        // slight downward tilt
    this.distance = 8;
    this.minPitch = -0.2;
    this.maxPitch = 1.2;
    this.sensitivity = 0.0026;
    this._desired = new THREE.Vector3();
  }

  updateFromInput(input) {
    const { dx, dy } = input.consumeMouseDelta();
    this.yaw -= dx * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * this.sensitivity, this.minPitch, this.maxPitch);
  }

  follow(target, dt) {
    // Look at a point slightly above the hero's feet.
    const look = target.position.clone();
    look.y += 1.4;

    // Orbit offset from yaw/pitch.
    const horiz = Math.cos(this.pitch) * this.distance;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * horiz,
      Math.sin(this.pitch) * this.distance + 1.0,
      Math.cos(this.yaw) * horiz
    );
    this._desired.copy(look).add(offset);

    // Keep the camera above the ground so it never dips underground.
    const groundY = this.terrain.getHeightAt(this._desired.x, this._desired.z) + 1.2;
    if (this._desired.y < groundY) this._desired.y = groundY;

    // Smoothly move toward the desired position.
    this.camera.position.lerp(this._desired, Math.min(1, dt * 10));
    this.camera.lookAt(look);
  }

  // Snap instantly (used on spawn / area changes so there is no swoop).
  snap(target) {
    this.follow(target, 1000);
    this.camera.position.copy(this._desired);
  }
}
