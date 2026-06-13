import * as THREE from 'three';

const GRAVITY = -28;
const JUMP_SPEED = 11;
const WALK_SPEED = 6;
const RUN_SPEED = 11;

// The hero. Built from primitives, moves relative to the camera, swings a sword,
// jumps with gravity, and is clamped to the terrain. Health is tracked in
// half-hearts (2 units per heart).
export class Player {
  constructor(terrain) {
    this.terrain = terrain;
    this.maxHealth = 6;   // 3 hearts
    this.health = 6;
    this.velocityY = 0;
    this.grounded = true;
    this.facing = 0;      // yaw the model faces

    this.invuln = 0;      // i-frame timer after taking damage
    this.knockback = new THREE.Vector3();

    this.attacking = false;
    this.attackTimer = 0;
    this.attackDuration = 0.35;
    this.hitSet = new Set();   // enemies already hit by the current swing

    this.swordDamage = 1;
    this.hasShield = false;

    this.group = new THREE.Group();
    this._build();
    this.group.position.set(0, terrain.getHeightAt(0, 0), 0);
  }

  _build() {
    const tunic = new THREE.MeshStandardMaterial({ color: 0x2e8b3d, roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c08a, roughness: 0.8 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x256b30, roughness: 0.8, flatShading: true });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.7, 4, 8), tunic);
    this.body.position.y = 1.0;

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), skin);
    this.head.position.y = 1.75;

    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 8), cap);
    hat.position.set(0, 2.05, -0.05);
    hat.rotation.x = -0.25;

    // Limbs grouped so we can swing them while walking.
    this.legL = this._limb(0x3a5a8a);
    this.legR = this._limb(0x3a5a8a);
    this.legL.position.set(-0.16, 0.62, 0);
    this.legR.position.set(0.16, 0.62, 0);

    this.armL = this._limb(0x2e8b3d);
    this.armR = new THREE.Group(); // right arm holds the sword; pivot at shoulder
    const armRMesh = this._limb(0x2e8b3d);
    this.armR.add(armRMesh);
    this.armL.position.set(-0.42, 1.25, 0);
    this.armR.position.set(0.42, 1.25, 0);

    // Sword in the right hand.
    this.sword = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.9, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xdfe7ee, metalness: 0.6, roughness: 0.3 })
    );
    blade.position.y = -0.55;
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.5 })
    );
    guard.position.y = -0.12;
    this.sword.add(blade, guard);
    this.sword.position.set(0, -0.5, 0);
    this.armR.add(this.sword);

    this.group.add(this.body, this.head, hat, this.legL, this.legR, this.armL, this.armR);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.walkPhase = 0;
  }

  _limb(color) {
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.45, 3, 6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
    );
    return m;
  }

  get position() { return this.group.position; }

  startAttack() {
    if (this.attacking) return;
    this.attacking = true;
    this.attackTimer = 0;
    this.hitSet.clear();
  }

  // While the swing is in its active window, return a sphere in front of the
  // hero for hit detection; otherwise null.
  getAttackSphere() {
    if (!this.attacking) return null;
    const t = this.attackTimer / this.attackDuration;
    if (t < 0.15 || t > 0.7) return null; // only the mid part of the swing connects
    const reach = 1.5;
    const center = this.group.position.clone();
    center.x += Math.sin(this.facing) * reach;
    center.z += Math.cos(this.facing) * reach;
    center.y += 1.0;
    return { center, radius: 1.3 };
  }

  takeDamage(amount, fromPos) {
    if (this.invuln > 0) return;
    let dmg = amount;
    // A raised shield halves incoming damage (rounded down, min 1 unit lands).
    if (this.hasShield) dmg = Math.max(1, Math.floor(dmg / 2));
    this.health = Math.max(0, this.health - dmg);
    this.invuln = 1.0;
    if (fromPos) {
      const kb = new THREE.Vector3().subVectors(this.group.position, fromPos);
      kb.y = 0;
      kb.normalize().multiplyScalar(7);
      this.knockback.copy(kb);
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  update(dt, input, camera) {
    // ---- Movement relative to the camera yaw ----
    const yaw = camera.yaw;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const move = new THREE.Vector3();
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) move.add(forward);
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) move.sub(forward);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) move.add(right);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) move.sub(right);

    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const pos = this.group.position;

    let moving = false;
    if (move.lengthSq() > 0) {
      move.normalize();
      pos.x += move.x * speed * dt;
      pos.z += move.z * speed * dt;
      this.facing = Math.atan2(move.x, move.z);
      moving = true;
    }

    // Apply and decay knockback.
    if (this.knockback.lengthSq() > 0.001) {
      pos.x += this.knockback.x * dt;
      pos.z += this.knockback.z * dt;
      this.knockback.multiplyScalar(Math.max(0, 1 - dt * 6));
    }

    // Keep the hero inside the world bounds.
    const lim = this.terrain.size / 2 - 2;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);

    // ---- Jump + gravity ----
    const groundY = this.terrain.getHeightAt(pos.x, pos.z);
    if (this.grounded && input.wasPressed('Space')) {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
    }
    this.velocityY += GRAVITY * dt;
    pos.y += this.velocityY * dt;
    if (pos.y <= groundY) {
      pos.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
    }

    // Face movement direction smoothly.
    const targetRot = this.facing;
    let diff = targetRot - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 12);

    // ---- Limb animation ----
    if (moving && this.grounded) {
      this.walkPhase += dt * (running ? 16 : 10);
      const swing = Math.sin(this.walkPhase) * 0.6;
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      if (!this.attacking) {
        this.armL.rotation.x = -swing;
        this.armR.rotation.x = swing;
      }
    } else {
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
      if (!this.attacking) {
        this.armL.rotation.x *= 0.8;
        this.armR.rotation.x *= 0.8;
      }
    }

    // ---- Sword swing animation ----
    if (this.attacking) {
      this.attackTimer += dt;
      const t = this.attackTimer / this.attackDuration;
      // Wind up then slash down-and-across.
      this.armR.rotation.x = -2.2 + t * 3.4;
      this.armR.rotation.z = -t * 1.2;
      if (this.attackTimer >= this.attackDuration) {
        this.attacking = false;
        this.armR.rotation.set(0, 0, 0);
      }
    }

    // ---- Timers ----
    this.invuln = Math.max(0, this.invuln - dt);
    // Blink while invulnerable.
    this.group.visible = !(this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0);
  }
}
