import * as THREE from 'three';
import { stylizeCharacter } from '../gfx/Materials.js?v=2';
import { CharacterModel } from './CharacterModel.js?v=2';

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
    // Palette tuned to Link's Hyrule Warriors design.
    const C = {
      tunic: 0x35a14a, tunicDk: 0x217a31, under: 0xd8cda6, skin: 0xf2c79a,
      hair: 0xf0cb55, belt: 0x6e4a28, buckle: 0xf3c63f, pants: 0xcabd95,
      boot: 0x5b3a22, glove: 0x2f6fd6, bracer: 0x7a5230, scarf: 0x2f74d6,
      scarfTip: 0xe8932a, steel: 0xe6edf3, hiltBlue: 0x2b5fb0, gold: 0xf3c63f,
      shieldBlue: 0x244fb8, shieldGold: 0xe5c23a, silver: 0xcdd5df, red: 0xc23a2e,
    };
    const mat = (color, { r = 0.85, m = 0, flat = true } = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, flatShading: flat });
    const cyl = (rt, rb, h, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 10), mat(c, o));
    const box = (w, h, d, c, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o));
    const sph = (r, c, o) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat(c, o));

    // ---------- Torso (green tunic) ----------
    this.body = new THREE.Group();
    const torso = cyl(0.27, 0.34, 0.6, C.tunic);
    torso.position.y = 1.2;
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.5, 12, 1, true), mat(C.tunic));
    skirt.position.y = 0.86;
    const collar = cyl(0.18, 0.2, 0.12, C.under);
    collar.position.y = 1.5;
    const belt = cyl(0.35, 0.35, 0.13, C.belt);
    belt.position.y = 0.96;
    const buckle = box(0.16, 0.13, 0.07, C.buckle, { m: 0.4, r: 0.4 });
    buckle.position.set(0, 0.96, 0.34);
    const pouch = box(0.14, 0.16, 0.1, C.belt);
    pouch.position.set(0.26, 0.92, 0.18);
    this.body.add(torso, skirt, collar, belt, buckle, pouch);
    this._buildShield(this.body, C, box, cyl);
    this._buildScarf(this.body, C, box);

    // ---------- Head ----------
    this.head = new THREE.Group();
    this.head.position.y = 1.78;
    const face = sph(0.25, C.skin);
    const hairBack = sph(0.26, C.hair);
    hairBack.position.set(0, 0.05, -0.04);
    hairBack.scale.set(1.02, 1.0, 1.0);
    // Bangs / fringe over the forehead.
    for (let i = -2; i <= 2; i++) {
      const bang = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat(C.hair));
      bang.position.set(i * 0.09, 0.16, 0.2);
      bang.rotation.x = Math.PI * 0.92;
      this.head.add(bang);
    }
    // Sideburns.
    for (const sx of [-1, 1]) {
      const sb = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), mat(C.hair));
      sb.position.set(sx * 0.2, -0.04, 0.12);
      sb.rotation.x = Math.PI;
      this.head.add(sb);
    }
    // Pointed elf ears.
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 5), mat(C.skin));
      ear.position.set(sx * 0.25, 0.04, 0);
      ear.rotation.set(0, 0, sx * -1.1);
      this.head.add(ear);
    }
    // Eyes (white + blue iris).
    for (const sx of [-1, 1]) {
      const white = sph(0.055, 0xffffff, { flat: false });
      white.position.set(sx * 0.1, 0.02, 0.225);
      white.scale.set(1, 1.3, 0.6);
      const iris = sph(0.03, 0x2f6fd6, { flat: false });
      iris.position.set(sx * 0.1, 0.0, 0.27);
      this.head.add(white, iris);
    }
    const nose = sph(0.03, C.skin, { flat: false });
    nose.position.set(0, -0.06, 0.25);
    this.head.add(face, hairBack, nose);

    // ---------- Cap (long pointed hat) ----------
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.4, 10), mat(C.tunic));
    cap.position.set(0, 0.22, -0.02);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 6, 12), mat(C.tunicDk));
    brim.position.set(0, 0.05, 0);
    brim.rotation.x = Math.PI / 2;
    this.head.add(cap, brim);
    // Floppy tail draping down the back, made of tapering segments.
    this.capTail = [];
    let prev = new THREE.Group();
    prev.position.set(0, 0.34, -0.1);
    this.head.add(prev);
    let segR = 0.16;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      const segMesh = new THREE.Mesh(new THREE.ConeGeometry(segR, 0.24, 8), mat(C.tunic));
      segMesh.position.y = -0.12;
      segMesh.rotation.x = Math.PI;
      seg.add(segMesh);
      seg.position.set(0, i === 0 ? 0 : -0.2, i === 0 ? 0 : -0.06);
      seg.rotation.x = -0.7;
      prev.add(seg);
      this.capTail.push(seg);
      prev = seg;
      segR *= 0.78;
    }

    // ---------- Legs (pivot at hips) ----------
    const makeLeg = () => {
      const g = new THREE.Group();
      const pant = cyl(0.13, 0.12, 0.5, C.pants);
      pant.position.y = -0.28;
      const boot = cyl(0.15, 0.16, 0.32, C.boot);
      boot.position.y = -0.64;
      const toe = box(0.18, 0.14, 0.3, C.boot);
      toe.position.set(0, -0.74, 0.08);
      g.add(pant, boot, toe);
      return g;
    };
    this.legL = makeLeg(); this.legL.position.set(-0.15, 0.92, 0);
    this.legR = makeLeg(); this.legR.position.set(0.15, 0.92, 0);

    // ---------- Arms (pivot at shoulders) ----------
    const makeArm = () => {
      const g = new THREE.Group();
      const sleeve = cyl(0.12, 0.11, 0.3, C.tunic);
      sleeve.position.y = -0.16;
      const bracer = cyl(0.11, 0.1, 0.22, C.bracer);
      bracer.position.y = -0.39;
      const glove = sph(0.1, C.glove);
      glove.position.y = -0.53;
      g.add(sleeve, bracer, glove);
      return g;
    };
    this.armL = makeArm(); this.armL.position.set(-0.4, 1.42, 0);
    this.armR = makeArm(); this.armR.position.set(0.4, 1.42, 0);

    // ---------- Master Sword in the right hand ----------
    this.sword = new THREE.Group();
    const grip = cyl(0.028, 0.028, 0.16, C.hiltBlue, { flat: false });
    const pommel = box(0.07, 0.06, 0.07, C.gold, { m: 0.4 });
    pommel.position.y = -0.1;
    const guardWing = box(0.32, 0.05, 0.06, C.gold, { m: 0.4 });
    guardWing.position.y = 0.1;
    const blade = box(0.085, 0.95, 0.025, C.steel, { m: 0.5, r: 0.25, flat: false });
    blade.position.y = 0.6;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), mat(C.steel, { m: 0.5, r: 0.25, flat: false }));
    tip.position.y = 1.08;
    this.sword.add(grip, pommel, guardWing, blade, tip);
    this.sword.position.set(0.02, -0.55, 0.05);
    this.armR.add(this.sword);

    // Procedural model lives under its own root so it can be hidden once the
    // rigged human model loads.
    this.procRoot = new THREE.Group();
    this.procRoot.add(this.body, this.head, this.legL, this.legR, this.armL, this.armR);
    this.group.add(this.procRoot);
    this.procRoot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    stylizeCharacter(this.procRoot, { thickness: 0.04 });
    this.walkPhase = 0;
    this.animTime = 0;

    // Upgrade to a rigged human model with motion-captured animation. Until it
    // loads (or if it fails), the procedural model above is shown.
    this.usingProc = true;
    this.model = new CharacterModel((m) => {
      if (m && m.ready) {
        this.group.add(m.root);
        this.procRoot.visible = false;
        this.usingProc = false;
      }
    });
  }

  // Hylian Shield worn on the back.
  _buildShield(parent, C, box, cyl) {
    const mat = (c, o = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.6, metalness: o.m ?? 0.2, flatShading: true });

    // Heater-shield silhouette via an extruded shape.
    const s = new THREE.Shape();
    s.moveTo(-0.26, 0.3);
    s.quadraticCurveTo(-0.3, 0.18, -0.3, 0.0);
    s.quadraticCurveTo(-0.3, -0.3, 0, -0.44);
    s.quadraticCurveTo(0.3, -0.3, 0.3, 0.0);
    s.quadraticCurveTo(0.3, 0.18, 0.26, 0.3);
    s.quadraticCurveTo(0, 0.4, -0.26, 0.3);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
    geo.center();

    const shield = new THREE.Group();
    const border = new THREE.Mesh(geo, mat(C.shieldGold, { m: 0.4 }));
    border.scale.set(1.0, 1.0, 1.0);
    const face = new THREE.Mesh(geo, mat(C.shieldBlue));
    face.scale.set(0.86, 0.86, 1.0);
    face.position.z = 0.02;
    shield.add(border, face);

    // Silver lower chevron + a small gold Triforce up top.
    const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.16, 3), mat(C.silver, { m: 0.5 }));
    chevron.position.set(0, -0.08, 0.05);
    chevron.rotation.z = Math.PI;
    shield.add(chevron);
    const tri = box(0.07, 0.06, 0.03, C.shieldGold, { m: 0.5 });
    tri.position.set(0, 0.16, 0.05);
    shield.add(tri);

    shield.position.set(0, 1.12, -0.3);
    shield.rotation.set(0.12, Math.PI, 0); // face outward from the back
    parent.add(shield);
  }

  // Long blue scarf draped from the shoulder down the back.
  _buildScarf(parent, C, box) {
    this.scarf = new THREE.Group();
    this.scarf.position.set(0.16, 1.46, -0.16);
    this.scarfSegs = [];
    let prev = this.scarf;
    let w = 0.22;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      const cloth = box(w, 0.26, 0.04, i === 4 ? C.scarfTip : C.scarf);
      cloth.position.y = -0.13;
      seg.add(cloth);
      seg.position.y = i === 0 ? 0 : -0.24;
      seg.rotation.x = -0.5 - i * 0.12;
      prev.add(seg);
      this.scarfSegs.push(seg);
      prev = seg;
      w *= 0.92;
    }
    parent.add(this.scarf);
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

    // Touch joystick (analog): magnitude scales speed for a natural feel.
    const tm = input.touchMove;
    if (tm && (tm.x !== 0 || tm.y !== 0)) {
      move.addScaledVector(forward, tm.y);
      move.addScaledVector(right, tm.x);
    }

    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const maxSpeed = running ? RUN_SPEED : WALK_SPEED;
    const pos = this.group.position;

    let moving = false;
    const mag = Math.min(1, move.length());
    if (mag > 0.05) {
      move.normalize();
      const speed = maxSpeed * mag;
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
    // ---- Rigged model: drive locomotion state with mocap clips ----
    if (this.model && this.model.ready) {
      let state = 'idle';
      if (moving) state = running ? 'run' : 'walk';
      this.model.setState(state);
      this.model.update(dt);
    }

    // ---- Procedural fallback: limb-swing walk cycle ----
    if (this.usingProc) {
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
    }

    // ---- Sword swing: always advance the timer (combat needs it); only pose
    // the procedural arm when the procedural model is shown. ----
    if (this.attacking) {
      this.attackTimer += dt;
      const t = this.attackTimer / this.attackDuration;
      if (this.usingProc) {
        this.armR.rotation.x = -2.2 + t * 3.4;
        this.armR.rotation.z = -t * 1.2;
      }
      if (this.attackTimer >= this.attackDuration) {
        this.attacking = false;
        if (this.usingProc) this.armR.rotation.set(0, 0, 0);
      }
    }

    // ---- Cloth sway: scarf + cap tail drift with motion and a gentle breeze ----
    this.animTime += dt;
    if (this.usingProc) {
    const gait = moving ? (running ? 1.6 : 1.0) : 0.4;
    const flow = Math.sin(this.animTime * 6) * 0.08 * gait + Math.sin(this.animTime * 2.1) * 0.05;
    if (this.scarfSegs) {
      for (let i = 0; i < this.scarfSegs.length; i++) {
        this.scarfSegs[i].rotation.z = flow * (i + 1) * 0.5;
        this.scarfSegs[i].rotation.y = Math.sin(this.animTime * 3 + i) * 0.06 * (i + 1);
      }
    }
    if (this.capTail) {
      for (let i = 0; i < this.capTail.length; i++) {
        this.capTail[i].rotation.z = flow * (i + 1) * 0.4;
      }
    }
    }

    // ---- Timers ----
    this.invuln = Math.max(0, this.invuln - dt);
    // Blink while invulnerable.
    this.group.visible = !(this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0);
  }
}
