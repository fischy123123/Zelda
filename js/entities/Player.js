import * as THREE from 'three';
import { stylizeCharacter } from '../gfx/Materials.js?v=11';
import { CharacterModel } from './CharacterModel.js?v=11';
import { HeroModel } from './HeroModel.js?v=11';

const GRAVITY = -28;
const JUMP_SPEED = 11;
const WALK_SPEED = 6;
const RUN_SPEED = 11;

// Use the real textured BOTW Link OBJ as the hero (static mesh). The procedural
// Link is the fallback if it fails to load. The rigged human model stays off.
const USE_LINK_MODEL = true;
const USE_RIGGED_MODEL = false;

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
    // Palette tuned to Breath of the Wild Link (blue Champion's Tunic).
    const C = {
      tunic: 0x3f76c0, tunicDk: 0x2b5286, under: 0xe8e2c8, skin: 0xf2c79a,
      hair: 0xf0cb55, belt: 0x6e4a28, buckle: 0xe5c23a, pants: 0xcabd95,
      boot: 0x5b3a22, glove: 0x9c8b66, bracer: 0x7a5230, scarf: 0x2f74d6,
      scarfTip: 0xe8932a, steel: 0xe6edf3, hiltBlue: 0x2b5fb0, gold: 0xf3c63f,
      shieldBlue: 0x244fb8, shieldGold: 0xe5c23a, silver: 0xcdd5df, red: 0xc23a2e,
    };
    const mat = (color, { r = 0.85, m = 0, flat = true } = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, flatShading: flat });
    const cyl = (rt, rb, h, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 16), mat(c, o));
    const box = (w, h, d, c, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o));
    const sph = (r, c, o) => new THREE.Mesh(new THREE.SphereGeometry(r, 18, 18), mat(c, o));
    const cap = (radius, len, c, o) => new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 16), mat(c, o));

    // ---------- Torso (green tunic) ----------
    this.body = new THREE.Group();
    const torso = cap(0.3, 0.5, C.tunic);   // smooth rounded chest
    torso.position.y = 1.18;
    torso.scale.z = 0.82;
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.58, 18, 1, true), mat(C.tunic, { flat: false }));
    skirt.position.y = 0.92;
    const collar = cap(0.17, 0.1, C.under);
    collar.position.y = 1.48;
    collar.scale.z = 0.82;
    const belt = cyl(0.37, 0.37, 0.14, C.belt);
    belt.position.y = 0.95;
    const buckle = box(0.16, 0.13, 0.07, C.buckle, { m: 0.4, r: 0.4 });
    buckle.position.set(0, 0.95, 0.36);
    const pouch = box(0.14, 0.16, 0.1, C.belt);
    pouch.position.set(0.28, 0.9, 0.16);
    // Champion's Tunic chest emblem (gold diamond).
    const emblem = box(0.17, 0.17, 0.04, C.buckle, { m: 0.4, r: 0.4 });
    emblem.position.set(0, 1.24, 0.28);
    emblem.rotation.z = Math.PI / 4;
    this.body.add(torso, skirt, collar, belt, buckle, pouch, emblem);
    this._buildShield(this.body, C, box, cyl);

    // ---------- Head (bigger, expressive — Wind Waker / Hyrule Warriors feel) ----------
    this.head = new THREE.Group();
    this.head.position.y = 1.74;
    const face = sph(0.3, C.skin);
    face.scale.set(1, 1.06, 0.96);
    const hairBack = sph(0.31, C.hair);
    hairBack.position.set(0, 0.05, -0.05);
    hairBack.scale.set(1.03, 1.0, 0.92);
    // Bangs / fringe poking out under the cap.
    for (let i = -2; i <= 2; i++) {
      const bang = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), mat(C.hair));
      bang.position.set(i * 0.1, 0.2, 0.25);
      bang.rotation.x = Math.PI * 0.9;
      bang.rotation.z = i * 0.12;
      this.head.add(bang);
    }
    // Sideburns framing the face.
    for (const sx of [-1, 1]) {
      const sb = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 6), mat(C.hair));
      sb.position.set(sx * 0.24, -0.06, 0.14);
      sb.rotation.x = Math.PI;
      this.head.add(sb);
    }
    // Pointed elf ears.
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), mat(C.skin));
      ear.position.set(sx * 0.3, 0.05, 0.02);
      ear.rotation.set(0, 0, sx * -1.05);
      this.head.add(ear);
    }
    // Big, tall anime eyes (the dark cel outline frames them) + blue irises.
    for (const sx of [-1, 1]) {
      const white = sph(0.085, 0xffffff, { flat: false });
      white.position.set(sx * 0.12, 0.0, 0.27);
      white.scale.set(0.72, 1.5, 0.5);
      const iris = sph(0.05, 0x2f6fd6, { flat: false });
      iris.position.set(sx * 0.12, -0.03, 0.32);
      iris.scale.set(0.9, 1.2, 0.7);
      const pupil = sph(0.022, 0x101820, { flat: false });
      pupil.position.set(sx * 0.12, -0.04, 0.35);
      // Eyebrow.
      const brow = box(0.11, 0.025, 0.03, C.hair);
      brow.position.set(sx * 0.12, 0.13, 0.29);
      brow.rotation.z = sx * 0.12;
      this.head.add(white, iris, pupil, brow);
    }
    const nose = sph(0.028, C.skin, { flat: false });
    nose.position.set(0, -0.08, 0.3);
    this.head.add(face, hairBack, nose);

    // ---------- Hair: tousled blonde top + swept-back ponytail (BOTW, no hat) ----------
    const hairTop = sph(0.31, C.hair);
    hairTop.position.set(0, 0.13, -0.03);
    hairTop.scale.set(1.05, 0.82, 1.02);
    this.head.add(hairTop);
    // A few spiky tufts on top.
    for (let i = -1; i <= 1; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), mat(C.hair));
      tuft.position.set(i * 0.12, 0.32, -0.02);
      tuft.rotation.set(-0.2, 0, i * 0.2);
      this.head.add(tuft);
    }
    // Hair tie + swept ponytail (stored in capTail so it sways with motion).
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 6, 12), mat(C.belt));
    tie.position.set(0, 0.18, -0.26);
    tie.rotation.x = Math.PI / 2;
    this.head.add(tie);
    this.capTail = [];
    let prev = new THREE.Group();
    prev.position.set(0, 0.16, -0.28);
    this.head.add(prev);
    let segR = 0.11;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      const segMesh = new THREE.Mesh(new THREE.ConeGeometry(segR, 0.18, 8), mat(C.hair));
      segMesh.position.y = -0.09;
      segMesh.rotation.x = Math.PI;
      seg.add(segMesh);
      seg.position.set(0, i === 0 ? 0 : -0.14, 0);
      seg.rotation.x = 0.85; // sweep back and down
      prev.add(seg);
      this.capTail.push(seg);
      prev = seg;
      segR *= 0.82;
    }

    // ---------- Legs (rounded, pivot at hips) ----------
    const makeLeg = () => {
      const g = new THREE.Group();
      const thigh = cap(0.14, 0.34, C.pants);
      thigh.position.y = -0.3;
      const boot = cap(0.15, 0.12, C.boot);
      boot.position.y = -0.64;
      const toe = box(0.2, 0.13, 0.32, C.boot);
      toe.position.set(0, -0.72, 0.1);
      g.add(thigh, boot, toe);
      return g;
    };
    this.legL = makeLeg(); this.legL.position.set(-0.16, 0.92, 0);
    this.legR = makeLeg(); this.legR.position.set(0.16, 0.92, 0);

    // ---------- Arms (rounded, pivot at shoulders) ----------
    const makeArm = () => {
      const g = new THREE.Group();
      const sleeve = cap(0.12, 0.16, C.tunic);
      sleeve.position.y = -0.18;
      const fore = cap(0.1, 0.16, C.bracer);
      fore.position.y = -0.42;
      const glove = sph(0.12, C.glove);
      glove.position.y = -0.56;
      g.add(sleeve, fore, glove);
      return g;
    };
    this.armL = makeArm(); this.armL.position.set(-0.42, 1.42, 0);
    this.armR = makeArm(); this.armR.position.set(0.42, 1.42, 0);

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

    // Sword-slash VFX: a bright crescent shown during the swing's active window.
    // Works for both the rigged and procedural models and blooms via post.
    this.slash = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.55, 28, 1, Math.PI * 0.12, Math.PI * 0.8),
      new THREE.MeshBasicMaterial({
        color: 0xd6f2ff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      })
    );
    this.slash.position.set(0, 1.1, 1.0);
    this.slash.visible = false;
    this.group.add(this.slash);

    // The procedural Link shows immediately; swap to a higher-fidelity model
    // once it loads. The textured BOTW Link OBJ is preferred; the rigged human
    // model is an alternative experiment.
    this.usingProc = true;
    this.usingHero = false;
    this.model = null;
    this.heroModel = null;
    if (USE_LINK_MODEL) {
      this.heroModel = new HeroModel((m) => {
        if (m && m.ready) {
          this.group.add(m.root);
          this.procRoot.visible = false;
          this.usingProc = false;
          this.usingHero = true;
        }
      });
    } else if (USE_RIGGED_MODEL) {
      this.model = new CharacterModel((m) => {
        if (m && m.ready) {
          this.group.add(m.root);
          this.procRoot.visible = false;
          this.usingProc = false;
        }
      });
    }
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
      // No jump clip exists, so airborne -> hold idle (legs stop "running") and
      // sell the jump with squash-and-stretch on the body instead.
      let state = 'idle';
      if (this.grounded && moving) state = running ? 'run' : 'walk';
      this.model.setState(state);
      this.model.update(dt);

      // Layer a sword swing onto the arm bones (after the mocap pose is applied).
      if (this.attacking) {
        const at = THREE.MathUtils.clamp(this.attackTimer / this.attackDuration, 0, 1);
        this.model.applyAttackPose(at);
      }

      let sy = 1, sxz = 1;
      if (!this.grounded) {
        const stretch = THREE.MathUtils.clamp(this.velocityY * 0.018, -0.14, 0.16);
        sy = 1 + stretch;
        sxz = 1 - stretch * 0.5;
      }
      this.model.root.scale.set(sxz, sy, sxz);
    }

    // ---- Static BOTW Link model: no skeleton, so fake a lively stride with
    // whole-body bob, forward lean, and a side-to-side rock ----
    if (this.usingHero && this.heroModel) {
      const root = this.heroModel.root;
      const striding = moving && this.grounded;
      if (striding) this.walkPhase += dt * (running ? 14 : 9);
      const w = this.walkPhase;
      root.position.y = striding ? Math.abs(Math.sin(w)) * 0.06 : root.position.y * 0.8;
      const targetLean = striding ? (running ? 0.18 : 0.1) : 0;
      let lean = targetLean;
      if (this.attacking) {
        const t = THREE.MathUtils.clamp(this.attackTimer / this.attackDuration, 0, 1);
        lean += Math.sin(t * Math.PI) * 0.45; // forward lunge on a swing
      }
      root.rotation.x += (lean - root.rotation.x) * Math.min(1, dt * 8);
      root.rotation.z = striding ? Math.sin(w) * 0.05 : root.rotation.z * 0.8;
    }

    // ---- Procedural Link: limb-swing walk cycle + subtle body bob ----
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
        // Gentle up-down bob in time with the stride.
        this.procRoot.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06;
      } else {
        this.legL.rotation.x *= 0.8;
        this.legR.rotation.x *= 0.8;
        if (!this.attacking) {
          this.armL.rotation.x *= 0.8;
          this.armR.rotation.x *= 0.8;
        }
        this.procRoot.position.y *= 0.8;
      }
    }

    // ---- Sword swing: always advance the timer (combat needs it); only pose
    // the procedural arm when the procedural model is shown. ----
    if (this.attacking) {
      this.attackTimer += dt;
      const t = this.attackTimer / this.attackDuration;

      // Slash crescent sweeps across and fades — clear feedback for both models.
      if (this.slash) {
        const active = t > 0.08 && t < 0.78;
        this.slash.visible = active;
        if (active) {
          const k = (t - 0.08) / 0.7;
          this.slash.rotation.z = 1.4 - k * 2.8;
          this.slash.material.opacity = 0.95 * (1 - k);
          const s = 0.85 + k * 0.6;
          this.slash.scale.set(s, s, s);
        }
      }

      if (this.usingProc) {
        this.armR.rotation.x = -2.2 + t * 3.4;
        this.armR.rotation.z = -t * 1.2;
      }
      if (this.attackTimer >= this.attackDuration) {
        this.attacking = false;
        if (this.slash) this.slash.visible = false;
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
