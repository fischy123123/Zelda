// The hero's visual body: a fully procedural, cel-shaded adventurer with
// layered procedural animation (locomotion, combat choreography, roll, guard,
// swim, hurt, death) driven each frame by the pose object from Player.js.

import * as THREE from 'three';
import { toonMaterial, addOutline, PALETTE } from '../gfx/Toon.js';
import { clamp01, lerp, damp, ease } from '../util/math.js';

const _tip = new THREE.Vector3();

// Small helper: a pivot group at (x, y, z) — rotate the pivot, not the mesh.
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function box(parent, w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function sph(parent, r, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class HeroModel {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this._t = 0;
    this._phase = 0;          // locomotion cycle phase
    this._runAmp = 0;
    this._deadT = -1;
    this._drawTimer = 0;      // sword drawn while > 0
    this._blinkT = 0;

    const tunic = toonMaterial({ color: PALETTE.heroTunic });
    const tunicDark = toonMaterial({ color: 0x1f6650 });
    const skin = toonMaterial({ color: PALETTE.heroSkin });
    const hair = toonMaterial({ color: PALETTE.heroHair });
    const leather = toonMaterial({ color: 0x6b4a2e });
    const boots = toonMaterial({ color: 0x53381f });
    const capMat = toonMaterial({ color: 0x256b52 });

    // --- body rig ------------------------------------------------------------
    // root → hips → torso → (head, arms), legs hang from hips.
    this.root = pivot(this.group, 0, 0, 0);
    this.hips = pivot(this.root, 0, 0.92, 0);

    this.torso = pivot(this.hips, 0, 0.02, 0);
    const chest = box(this.torso, 0.44, 0.5, 0.27, tunic, 0, 0.28, 0);
    chest.geometry.translate(0, 0, 0);
    box(this.torso, 0.47, 0.12, 0.29, leather, 0, 0.05, 0);       // belt
    box(this.torso, 0.1, 0.14, 0.02, toonMaterial({ color: PALETTE.gold }), 0, 0.05, 0.15); // buckle
    // Skirt of the tunic.
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.22, 8), tunicDark);
    skirt.position.y = -0.08;
    skirt.castShadow = true;
    this.torso.add(skirt);

    // Head.
    this.neck = pivot(this.torso, 0, 0.56, 0);
    this.head = pivot(this.neck, 0, 0.06, 0);
    sph(this.head, 0.19, skin, 0, 0.13, 0, 1, 1.05, 0.95);
    // Hair mop + swept fringe.
    sph(this.head, 0.2, hair, 0, 0.2, -0.03, 1.02, 0.85, 1.02);
    sph(this.head, 0.09, hair, 0, 0.16, 0.14, 1.4, 0.55, 0.8);
    // Ears.
    sph(this.head, 0.045, skin, -0.19, 0.12, 0, 0.6, 1, 1.6);
    sph(this.head, 0.045, skin, 0.19, 0.12, 0, 0.6, 1, 1.6);
    // Eyes: big friendly dark ovals.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a2331 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat);
      eye.position.set(0.075 * s, 0.13, 0.165);
      eye.scale.set(0.8, 1.4, 0.5);
      eye.userData.noOutline = true;
      this.head.add(eye);
    }
    // Floppy cap: cone base + trailing tip segments.
    this.cap = pivot(this.head, 0, 0.3, -0.02);
    const capBase = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.28, 9), capMat);
    capBase.position.y = 0.1;
    capBase.castShadow = true;
    this.cap.add(capBase);
    this.capTip = pivot(this.cap, 0, 0.22, -0.05);
    const capT = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 7), capMat);
    capT.rotation.x = -1.1;
    capT.position.set(0, 0.03, -0.12);
    capT.castShadow = true;
    this.capTip.add(capT);

    // Arms: shoulder → elbow.
    this.armL = pivot(this.torso, -0.28, 0.46, 0);
    this.armR = pivot(this.torso, 0.28, 0.46, 0);
    this.elbowL = pivot(this.armL, 0, -0.24, 0);
    this.elbowR = pivot(this.armR, 0, -0.24, 0);
    for (const [shoulder, elbow] of [[this.armL, this.elbowL], [this.armR, this.elbowR]]) {
      sph(shoulder, 0.085, tunic, 0, 0, 0);
      box(shoulder, 0.11, 0.26, 0.11, tunic, 0, -0.13, 0);
      box(elbow, 0.1, 0.24, 0.1, skin, 0, -0.11, 0);
      sph(elbow, 0.06, leather, 0, -0.24, 0, 1, 0.9, 1); // glove
    }

    // Legs: hip → knee.
    this.legL = pivot(this.hips, -0.12, -0.12, 0);
    this.legR = pivot(this.hips, 0.12, -0.12, 0);
    this.kneeL = pivot(this.legL, 0, -0.36, 0);
    this.kneeR = pivot(this.legR, 0, -0.36, 0);
    for (const [leg, knee] of [[this.legL, this.kneeL], [this.legR, this.kneeR]]) {
      box(leg, 0.14, 0.38, 0.15, toonMaterial({ color: 0xd8cfb4 }), 0, -0.18, 0);
      box(knee, 0.13, 0.3, 0.14, boots, 0, -0.14, 0);
      box(knee, 0.14, 0.09, 0.22, boots, 0, -0.31, 0.04); // foot
    }

    // --- sword + shield ------------------------------------------------------
    this.swordHand = pivot(this.elbowR, 0, -0.27, 0);
    this.swordGrip = pivot(this.swordHand, 0, -0.02, 0.02);
    this._buildSwords();
    this.shieldArm = pivot(this.elbowL, 0, -0.22, 0);
    this.shield = this._buildShield(leather);
    this.shieldArm.add(this.shield);

    // Back mounts (visible when sheathed).
    this.backSword = pivot(this.torso, -0.1, 0.4, -0.18);
    this.backSword.rotation.z = 0.5;
    this.backShield = pivot(this.torso, 0.02, 0.32, -0.2);
    this._buildBackMounts(leather);

    addOutline(this.group, 0.028);

    // Sword slash trail (ribbon of recent tip positions).
    this._trailPts = [];
    for (let i = 0; i < 12; i++) this._trailPts.push(new THREE.Vector3());
    this._trailAges = new Float32Array(12).fill(1);
    const trailGeo = new THREE.BufferGeometry();
    this._trailPos = new THREE.BufferAttribute(new Float32Array(12 * 2 * 3), 3);
    this._trailPos.setUsage(THREE.DynamicDrawUsage);
    trailGeo.setAttribute('position', this._trailPos);
    const idx = [];
    for (let i = 0; i < 11; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    trailGeo.setIndex(idx);
    this.trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({
      color: 0xfff6d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    game.scene.add(this.trail);

    this.setSword('bronze');
    this._setDrawn(false, true);
  }

  // -------------------------------------------------------------------------
  _buildSwords() {
    const steel = toonMaterial({ color: 0xd4d8e0 });
    const bronzeGuard = toonMaterial({ color: 0xa87c3a });
    const goldBlade = toonMaterial({ color: 0xf2cf6a, emissive: 0x8a5c10, emissiveIntensity: 0.5 });
    const goldGuard = toonMaterial({ color: PALETTE.gold, emissive: 0x5a3a00, emissiveIntensity: 0.4 });
    const gripMat = toonMaterial({ color: 0x3f3244 });

    const mk = (bladeMat, guardMat, sunDisc) => {
      const g = new THREE.Group();
      box(g, 0.05, 0.14, 0.05, gripMat, 0, -0.05, 0);              // grip
      box(g, 0.2, 0.05, 0.07, guardMat, 0, 0.03, 0);               // crossguard
      if (sunDisc) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12), guardMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.y = 0.05;
        disc.castShadow = true;
        g.add(disc);
      }
      const blade = box(g, 0.07, 0.62, 0.025, bladeMat, 0, 0.38, 0);
      blade.geometry = blade.geometry.clone();
      blade.geometry.scale(1, 1, 1);
      const tipM = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), bladeMat);
      tipM.rotation.y = Math.PI / 4;
      tipM.position.y = 0.74;
      tipM.castShadow = true;
      g.add(tipM);
      const tipAnchor = new THREE.Object3D();
      tipAnchor.position.y = 0.8;
      g.add(tipAnchor);
      g.userData.tip = tipAnchor;
      return g;
    };

    this.swordBronze = mk(steel, bronzeGuard, false);
    this.swordSun = mk(goldBlade, goldGuard, true);
    this.swordGrip.add(this.swordBronze, this.swordSun);
  }

  _buildShield(leather) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 16), toonMaterial({ color: 0x8a6440 }));
    face.rotation.x = Math.PI / 2;
    face.castShadow = true;
    g.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 18), toonMaterial({ color: 0xb8bcc4 }));
    g.add(rim);
    const bossM = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toonMaterial({ color: 0xb8bcc4 }));
    bossM.position.z = 0.05;
    g.add(bossM);
    g.position.set(0, -0.08, 0.06);
    g.rotation.y = 0;
    void leather;
    return g;
  }

  _buildBackMounts(leather) {
    // Simplified silhouettes for the sheathed state.
    const sheath = box(this.backSword, 0.08, 0.7, 0.05, leather, 0, 0.2, 0);
    sheath.rotation.z = 0;
    this.backShieldMesh = this._buildShield(leather);
    this.backShieldMesh.position.set(0, 0, -0.03);
    this.backShieldMesh.rotation.y = Math.PI;
    this.backShield.add(this.backShieldMesh);
  }

  setSword(id) {
    this._swordId = id;
    this.swordBronze.visible = id === 'bronze';
    this.swordSun.visible = id === 'sunblade';
  }

  getSwordTip(out = _tip) {
    const sw = this._swordId === 'sunblade' ? this.swordSun : this.swordBronze;
    return sw.userData.tip.getWorldPosition(out);
  }

  _setDrawn(drawn, force = false) {
    if (this._drawn === drawn && !force) return;
    this._drawn = drawn;
    this.swordGrip.visible = drawn;
    this.shield.visible = drawn;
    this.backSword.visible = !drawn;
    this.backShield.visible = !drawn;
  }

  // -------------------------------------------------------------------------
  update(dt, pose) {
    this._t += dt;
    const t = this._t;

    // Weapon draw state: drawn while fighting, sheathed after ~6 calm seconds.
    if (pose.attack || pose.guarding || pose.charge > 0) this._drawTimer = 6;
    else this._drawTimer = Math.max(0, this._drawTimer - dt);
    this._setDrawn(this._drawTimer > 0 && !pose.swimming);

    // --- base neutral each frame (poses are layered on top) -----------------
    const P = {
      hipsY: 0, hipsRotX: 0, hipsRotZ: 0, rootRotX: 0, rootRotY: 0, rootRotZ: 0,
      torsoRotX: 0, torsoRotY: 0, headRotX: 0, headRotY: 0,
      armL: [0.1, 0, 0.12], armR: [0.1, 0, -0.12], elbL: -0.25, elbR: -0.25,
      legL: 0, legR: 0, kneeL: 0.1, kneeR: 0.1, scaleY: 1,
    };

    const speed = pose.speed || 0;
    const run = clamp01(pose.runBlend ?? speed / 6.2);
    this._runAmp = damp(this._runAmp, run, 10, dt);
    const amp = this._runAmp;

    // --- locomotion ---------------------------------------------------------
    if (pose.swimming) {
      P.rootRotX = 1.25;
      P.hipsY = -0.35;
      const s = Math.sin(t * 6);
      P.armL = [2.6 + s * 0.8, 0, 0.4];
      P.armR = [2.6 - s * 0.8, 0, -0.4];
      P.legL = s * 0.5; P.legR = -s * 0.5;
      P.kneeL = 0.3; P.kneeR = 0.3;
    } else if (pose.grounded && amp > 0.02) {
      const freq = pose.sprinting ? 11.5 : 8.5;
      this._phase += dt * freq * (0.4 + 0.6 * amp);
      const ph = this._phase;
      const swing = Math.sin(ph) * (0.75 + (pose.sprinting ? 0.35 : 0)) * amp;
      P.legL = swing; P.legR = -swing;
      P.kneeL = Math.max(0, -Math.sin(ph - 0.7)) * 1.1 * amp + 0.1;
      P.kneeR = Math.max(0, -Math.sin(ph - 0.7 + Math.PI)) * 1.1 * amp + 0.1;
      P.armL = [-swing * 0.85 + 0.1, 0, 0.12];
      P.armR = [swing * 0.85 + 0.1, 0, -0.12];
      P.elbL = -0.35 - Math.max(0, swing) * 0.4;
      P.elbR = -0.35 - Math.max(0, -swing) * 0.4;
      P.hipsY = Math.abs(Math.cos(ph)) * 0.06 * amp;
      P.rootRotX = (pose.sprinting ? 0.32 : 0.1) * amp;
      P.rootRotZ = Math.sin(ph) * 0.035 * amp;
      P.torsoRotY = Math.sin(ph) * 0.09 * amp;
    } else if (!pose.grounded) {
      // Air: tuck rising, spread falling.
      const rising = (pose.yVel || 0) > 0.5;
      if (rising) {
        P.legL = 0.5; P.legR = -0.25; P.kneeL = 1.1; P.kneeR = 0.7;
        P.armL = [-0.6, 0, 0.5]; P.armR = [-0.6, 0, -0.5];
        P.rootRotX = 0.12;
      } else {
        P.legL = -0.2; P.legR = 0.35; P.kneeL = 0.5; P.kneeR = 0.4;
        P.armL = [-2.4, 0, 0.6]; P.armR = [-2.4, 0, -0.6];
        P.rootRotX = -0.06;
      }
    } else {
      // Idle: breathe, sway, occasional look-around.
      const br = Math.sin(t * 2.1);
      P.hipsY = br * 0.012;
      P.torsoRotX = 0.02 + br * 0.015;
      P.armL = [0.08 + br * 0.02, 0, 0.14];
      P.armR = [0.08 + br * 0.02, 0, -0.14];
      const idle = pose.idleTime || 0;
      if (idle > 4) {
        const lk = Math.sin((idle - 4) * 0.8);
        P.headRotY = lk * 0.55;
        P.headRotX = Math.sin((idle - 4) * 0.5) * 0.1;
      }
    }

    // --- guard --------------------------------------------------------------
    if (pose.guarding) {
      P.armL = [-1.35, 0.35, 0.55];
      P.elbL = -1.5;
      P.torsoRotY = 0.28;
      P.rootRotX = Math.max(P.rootRotX, 0.08);
      P.armR = [0.35, 0, -0.3];
      P.elbR = -0.6;
    }

    // --- charge (spin wind-up) ---------------------------------------------
    const charge = pose.charge || 0;
    if (charge > 0 && !pose.attack) {
      P.hipsY -= charge * 0.1;
      P.torsoRotY = -charge * 0.9;
      P.armR = [0.5, 0, -1.1 * charge];
      P.elbR = -0.4;
      P.kneeL += charge * 0.4; P.kneeR += charge * 0.4;
    }
    const swords = [this.swordBronze, this.swordSun];
    for (const sw of swords) {
      for (const child of sw.children) {
        if (child.material && child.material.emissive && sw === this.swordSun) {
          child.material.emissiveIntensity = 0.5 + charge * 1.2;
        }
      }
    }

    // --- attack choreography -------------------------------------------------
    let trailActive = false;
    if (pose.attack) {
      const { index, t: at } = pose.attack;
      trailActive = at > 0.15 && at < 0.75;
      if (index === 'spin') {
        const spin = ease.outCubic(clamp01(at)) * Math.PI * 2.6;
        P.rootRotY = spin;
        P.armR = [1.35, 0, -1.5];
        P.elbR = -0.1;
        P.armL = [0.6, 0, 0.9];
        P.hipsY -= 0.08;
        P.torsoRotX = 0.15;
        trailActive = at > 0.05 && at < 0.9;
      } else if (index === 0) {
        // Horizontal slash left→right.
        const w = attackCurve(at);
        P.torsoRotY = lerp(0.9, -0.9, w);
        P.armR = [lerp(0.2, 1.5, w), 0, lerp(0.9, -1.2, w)];
        P.elbR = lerp(-0.9, -0.05, w);
        P.armL = [0.3, 0, lerp(0.3, 0.7, w)];
        P.rootRotX = 0.1;
      } else if (index === 1) {
        // Return backhand right→left.
        const w = attackCurve(at);
        P.torsoRotY = lerp(-0.95, 0.85, w);
        P.armR = [lerp(1.3, 0.5, w), 0, lerp(-1.3, 1.0, w)];
        P.elbR = lerp(-0.15, -0.5, w);
        P.rootRotX = 0.12;
      } else {
        // Overhead finisher.
        const w = attackCurve(at);
        P.armR = [lerp(-2.6, 1.15, w), 0, -0.15];
        P.elbR = lerp(-0.5, -0.1, w);
        P.torsoRotX = lerp(-0.25, 0.5, w);
        P.hipsY -= w * 0.09;
        P.kneeL += w * 0.5; P.kneeR += w * 0.5;
        P.armL = [lerp(-0.6, 0.5, w), 0, 0.5];
      }
    }

    // --- roll ----------------------------------------------------------------
    if (pose.roll) {
      const rt = clamp01(pose.roll.t);
      P.rootRotX = ease.inOutQuad(rt) * Math.PI * 2;
      P.hipsY = -0.28 * Math.sin(rt * Math.PI);
      P.kneeL = 1.6; P.kneeR = 1.6; P.legL = 0.9; P.legR = 0.9;
      P.armL = [0.8, 0, 0.4]; P.armR = [0.8, 0, -0.4];
      P.elbL = -1.4; P.elbR = -1.4;
      P.headRotX = 0.4;
    }

    // --- hurt ----------------------------------------------------------------
    if (pose.hurt) {
      const ht = 1 - clamp01(pose.hurt.t);
      P.torsoRotX = -0.5 * ht;
      P.headRotX = -0.35 * ht;
      P.armL = [-0.7 * ht, 0, 0.5]; P.armR = [-0.7 * ht, 0, -0.5];
      P.scaleY = 1 - 0.08 * ht;
    }

    // --- death ---------------------------------------------------------------
    if (pose.dead) {
      if (this._deadT < 0) this._deadT = 0;
      this._deadT = Math.min(1.2, this._deadT + dt);
      const dtn = this._deadT / 1.2;
      const kneel = ease.outQuad(clamp01(dtn * 2));
      const fall = ease.inQuad(clamp01(dtn * 2 - 1));
      P.hipsY = -0.45 * kneel;
      P.kneeL = 1.9 * kneel; P.kneeR = 1.9 * kneel;
      P.legL = 0.6 * kneel; P.legR = 0.6 * kneel;
      P.rootRotX = 0.25 * kneel;
      P.rootRotZ = fall * 1.5;
      P.torsoRotX = 0.4 * kneel;
      P.headRotX = 0.5 * kneel + fall * 0.3;
      P.armL = [0.3, 0, 0.7]; P.armR = [0.3, 0, -0.7];
    } else {
      this._deadT = -1;
    }

    // --- apply with smoothing ------------------------------------------------
    const k = pose.attack || pose.roll ? 26 : 14; // snappier during actions
    const dr = (obj, axis, target) => { obj.rotation[axis] = damp(obj.rotation[axis], target, k, dt); };
    this.hips.position.y = damp(this.hips.position.y, 0.92 + P.hipsY, 18, dt);
    dr(this.root, 'x', P.rootRotX);
    // Roll/spin rotations wrap; snap-assign to avoid long-way lerps.
    this.root.rotation.y = pose.attack?.index === 'spin' ? P.rootRotY : damp(this.root.rotation.y, P.rootRotY, k, dt);
    if (pose.roll) this.root.rotation.x = P.rootRotX;
    dr(this.root, 'z', P.rootRotZ);
    dr(this.torso, 'x', P.torsoRotX);
    dr(this.torso, 'y', P.torsoRotY);
    dr(this.head, 'x', P.headRotX);
    dr(this.head, 'y', P.headRotY);
    const arm = (a, tgt) => {
      a.rotation.x = damp(a.rotation.x, tgt[0], k, dt);
      a.rotation.y = damp(a.rotation.y, tgt[1], k, dt);
      a.rotation.z = damp(a.rotation.z, tgt[2], k, dt);
    };
    arm(this.armL, P.armL); arm(this.armR, P.armR);
    dr(this.elbowL, 'x', P.elbL); dr(this.elbowR, 'x', P.elbR);
    dr(this.legL, 'x', P.legL); dr(this.legR, 'x', P.legR);
    dr(this.kneeL, 'x', P.kneeL); dr(this.kneeR, 'x', P.kneeR);
    this.root.scale.y = damp(this.root.scale.y, P.scaleY, 20, dt);

    // Cap + hair secondary motion.
    const lean = this.root.rotation.x;
    this.capTip.rotation.x = damp(this.capTip.rotation.x, -0.3 - lean * 1.4 - amp * 0.5 + Math.sin(t * 3.2) * 0.08, 8, dt);
    this.cap.rotation.z = damp(this.cap.rotation.z, Math.sin(t * 2.2) * 0.03 + this.root.rotation.z * 0.8, 8, dt);

    // I-frame flicker: emissive pulse on the tunic (no visibility strobing).
    this._blinkT += dt;
    const flick = pose.iframes && !pose.dead ? (Math.sin(this._blinkT * 26) * 0.5 + 0.5) * 0.5 : 0;
    const tunicMat = this.torso.children[0].material;
    if (tunicMat && tunicMat.emissive) {
      tunicMat.emissive.setRGB(flick * 0.9, flick * 0.85, flick * 0.7);
    }

    this._updateTrail(dt, trailActive);
  }

  _updateTrail(dt, active) {
    const pts = this._trailPts;
    // Shift history.
    for (let i = pts.length - 1; i > 0; i--) {
      pts[i].copy(pts[i - 1]);
      this._trailAges[i] = this._trailAges[i - 1] + dt;
    }
    this.getSwordTip(pts[0]);
    this._trailAges[0] = active ? 0 : 1;

    this.trail.visible = active || this._trailAges[3] < 0.12;
    if (!this.trail.visible) return;

    // Build ribbon: tip position + point pulled toward the hand.
    const hand = this.swordGrip.getWorldPosition(_tip);
    const arr = this._trailPos.array;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const o = i * 6;
      arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z;
      arr[o + 3] = lerp(p.x, hand.x, 0.55);
      arr[o + 4] = lerp(p.y, hand.y, 0.55);
      arr[o + 5] = lerp(p.z, hand.z, 0.55);
    }
    this._trailPos.needsUpdate = true;
  }
}

// Anticipation → strike → recover curve: slow pull-back, fast swing, ease out.
function attackCurve(t) {
  if (t < 0.22) return -0.25 * ease.outQuad(t / 0.22);          // wind-up (negative = pull back)
  if (t < 0.55) return -0.25 + 1.25 * ease.inCubic((t - 0.22) / 0.33) + 0; // strike 0→1ish
  return 1 - 0.0 * (t - 0.55) / 0.45;                            // hold/recover
}
