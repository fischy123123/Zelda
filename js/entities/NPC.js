// Villagers: shared procedural body rig with strong per-person silhouettes
// (staff, armor, pitchfork, beard…), waypoint wandering, idle gestures,
// dialogue hookup, and floating quest markers (! offer, ? turn-in).

import * as THREE from 'three';
import { toonMaterial, addOutline } from '../gfx/Toon.js';
import { clamp01, damp, dampAngle } from '../util/math.js';
import { getDialogue } from '../data/dialogue.js';

// ---------------------------------------------------------------------------
// Overhead quest markers — three shared sprite materials built once.
// ---------------------------------------------------------------------------
let _markerMats = null;
function markerMats() {
  if (_markerMats) return _markerMats;
  const make = (char, color, dim) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.font = '900 92px Georgia, "Times New Roman", serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 16;
    x.lineJoin = 'round';
    x.strokeStyle = 'rgba(14, 10, 4, 0.92)';
    x.strokeText(char, 64, 70);
    x.fillStyle = color;
    x.fillText(char, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped: false,
      opacity: dim ? 0.8 : 1,
    });
    return mat;
  };
  _markerMats = {
    offer: make('!', '#ffd24c'),        // gold ! — quest available
    ready: make('?', '#ffd24c'),        // gold ? — ready to turn in
    progress: make('?', '#aab2c2', 1),  // gray ? — in progress, come back later
  };
  return _markerMats;
}

export class NPC {
  /**
   * opts: {name, dialogueId, pos: {x,z}, waypoints: [{x,z}...], speed?,
   *        colors: {robe, trim?, skin?, hair?}, hat: 'none'|'straw'|'hood'|'cap',
   *        apron?: bool, scale?: number,
   *        variant?: 'elder'|'healer'|'guard'|'merchant'|'kid'|'farmer',
   *        quest?: (game) => 'offer'|'progress'|'ready'|null}
   */
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.name = opts.name;
    this.group = new THREE.Group();
    this.yaw = Math.random() * Math.PI * 2;
    this._talking = false;
    this._t = Math.random() * 10;
    this._wpIndex = 0;
    this._pause = 1 + Math.random() * 3;
    this.speed = opts.speed ?? 1.6;

    const x = opts.pos.x, z = opts.pos.z;
    this.group.position.set(x, game.terrain.heightAt(x, z), z);
    this._build(opts);
    game.scene.add(this.group);

    // Quest marker sprite (only for quest-giving folk).
    this.questKind = null;
    if (opts.quest) {
      this.marker = new THREE.Sprite(markerMats().offer);
      this.marker.visible = false;
      this._markerY = 1.55 * (opts.scale ?? 1) + 0.42;
      this.marker.position.y = this._markerY;
      this.marker.scale.setScalar(0.55);
      this.group.add(this.marker);
      this._questPoll = Math.random() * 0.4; // desync polls across NPCs
    }

    game.interact.register({
      position: this.group.position,
      radius: 3,
      prompt: `Talk — ${opts.name}`,
      enabled: () => !game.inDungeon,
      onInteract: (g) => this._startTalk(g),
    });
    game.events.on('dialogue:end', () => { this._talking = false; });
  }

  _startTalk(g) {
    this._talking = true;
    const { def, entry } = getDialogue(this.opts.dialogueId, g);
    g.ui.dialogue.start(def, entry);
  }

  // -------------------------------------------------------------------------
  _build(opts) {
    const c = opts.colors || {};
    const robe = toonMaterial({ color: c.robe ?? 0x7a6a9a, cache: false });
    const trim = toonMaterial({ color: c.trim ?? 0x50436b, cache: false });
    const skin = toonMaterial({ color: c.skin ?? 0xeec39a, cache: false });
    const hairM = toonMaterial({ color: c.hair ?? 0x5c4632, cache: false });
    const s = opts.scale ?? 1;
    const variant = opts.variant;

    this.body = new THREE.Group();
    this.group.add(this.body);

    // Rounded robe body.
    const robeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.85, 10), robe);
    robeMesh.position.y = 0.46;
    robeMesh.castShadow = true;
    this.body.add(robeMesh);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), robe);
    chest.position.y = 0.88;
    chest.scale.set(1, 0.8, 0.85);
    chest.castShadow = true;
    this.body.add(chest);
    if (variant === 'merchant') {
      // Prosperous roundness.
      robeMesh.scale.set(1.3, 1, 1.18);
      chest.scale.set(1.28, 0.8, 1.0);
    }
    if (opts.apron) {
      const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.04), trim);
      apron.position.set(0, 0.52, 0.28);
      apron.rotation.x = 0.08;
      this.body.add(apron);
    }

    // Head.
    this.head = new THREE.Group();
    this.head.position.y = 1.18;
    this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
    skull.castShadow = true;
    this.head.add(skull);
    // Simple eyes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a2331 });
    for (const sd of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 6), eyeMat);
      eye.position.set(0.065 * sd, 0.02, 0.15);
      eye.scale.set(0.8, 1.3, 0.5);
      eye.userData.noOutline = true;
      this.head.add(eye);
    }
    // Hair / hat. Guards get a helmet and merchants go bald via their variant.
    const bareHead = variant === 'guard' || variant === 'merchant';
    if (opts.hat === 'straw') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 12), toonMaterial({ color: 0xd9b970 }));
      brim.position.y = 0.13;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.14, 10), toonMaterial({ color: 0xd9b970 }));
      crown.position.y = 0.2;
      this.head.add(brim, crown);
    } else if (opts.hat === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), trim);
      hood.position.y = 0.05;
      hood.scale.set(1.05, 1.1, 1.05);
      this.head.add(hood);
    } else if (opts.hat === 'cap') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), hairM);
      cap.position.y = 0.08;
      this.head.add(cap);
    } else if (!bareHead) {
      const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      hairMesh.position.y = 0.045;
      this.head.add(hairMesh);
    }

    // Stub arms.
    this.armL = new THREE.Group();
    this.armL.position.set(-0.26, 0.95, 0);
    this.armR = new THREE.Group();
    this.armR.position.set(0.26, 0.95, 0);
    for (const arm of [this.armL, this.armR]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 7), robe);
      m.position.y = -0.16;
      m.castShadow = true;
      arm.add(m);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 6), skin);
      hand.position.y = -0.34;
      arm.add(hand);
      this.body.add(arm);
    }

    // Distinct per-person features so folk read at a glance.
    if (variant) this._buildVariant(variant, { robe, trim, skin, hairM });

    this.body.scale.setScalar(s);
    addOutline(this.group, 0.03);
  }

  // -------------------------------------------------------------------------
  _buildVariant(variant, mats) {
    const { trim, hairM } = mats;
    const B = this.body, H = this.head;
    const add = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    if (variant === 'elder') {
      // Hunched, white-haired, leaning on a glowing star-staff.
      B.rotation.x = 0.13;
      const backHair = add(H, new THREE.SphereGeometry(0.1, 8, 7), hairM, 0, -0.07, -0.13);
      backHair.scale.set(1.25, 1.9, 0.7);
      const shawl = add(B, new THREE.SphereGeometry(0.2, 10, 8), trim, 0, 1.0, 0);
      shawl.scale.set(1.55, 0.55, 1.35);
      const wood = toonMaterial({ color: 0x5c422a });
      const staff = new THREE.Group();
      staff.position.set(0, -0.34, 0.07);
      const pole = add(staff, new THREE.CylinderGeometry(0.028, 0.04, 1.24, 7), wood, 0, -0.05, 0);
      void pole;
      add(staff, new THREE.SphereGeometry(0.062, 8, 8),
        toonMaterial({ color: 0xffd88a, emissive: 0xb87c1e, emissiveIntensity: 0.9 }), 0, 0.62, 0);
      this.armR.add(staff);
    } else if (variant === 'healer') {
      // Bun, headband, herb satchel and a belt potion.
      add(H, new THREE.SphereGeometry(0.085, 8, 7), hairM, 0, 0.21, -0.06);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 6, 16), trim);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.1;
      H.add(band);
      const strap = add(B, new THREE.BoxGeometry(0.07, 0.62, 0.03), trim, 0.02, 0.82, 0.22);
      strap.rotation.z = 0.85;
      const bag = add(B, new THREE.BoxGeometry(0.17, 0.15, 0.09), trim, -0.24, 0.55, 0.13);
      bag.rotation.y = 0.35;
      add(bag, new THREE.SphereGeometry(0.045, 7, 6),
        toonMaterial({ color: 0xd9527a, emissive: 0x581a2e, emissiveIntensity: 0.6 }), 0.04, 0.1, 0);
    } else if (variant === 'guard') {
      // Steel cuirass, pauldrons, crested helmet, regulation mustache.
      const steel = toonMaterial({ color: 0x8f96a3 });
      const crest = toonMaterial({ color: 0xc9564c });
      const cuirass = add(B, new THREE.SphereGeometry(0.26, 10, 8), steel, 0, 0.88, 0);
      cuirass.scale.set(1.02, 0.82, 0.9);
      for (const sd of [-1, 1]) {
        const p = add(B, new THREE.SphereGeometry(0.1, 8, 7), steel, sd * 0.26, 1.0, 0);
        p.scale.set(1.2, 0.65, 1.2);
      }
      const helm = add(H, new THREE.SphereGeometry(0.185, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), steel, 0, 0.055, 0);
      helm.scale.set(1.04, 1.05, 1.04);
      const plume = add(H, new THREE.BoxGeometry(0.045, 0.1, 0.3), crest, 0, 0.24, -0.02);
      plume.rotation.x = -0.15;
      add(H, new THREE.BoxGeometry(0.12, 0.032, 0.03), hairM, 0, -0.045, 0.155);
      const scab = add(B, new THREE.BoxGeometry(0.06, 0.42, 0.04), toonMaterial({ color: 0x4a3826 }), -0.26, 0.42, 0.06);
      scab.rotation.z = 0.14;
      add(scab, new THREE.BoxGeometry(0.09, 0.05, 0.05), steel, 0, 0.24, 0);
    } else if (variant === 'merchant') {
      // Bald crown, grand beard, coin pouch, showman's sash.
      for (const sd of [-1, 1]) {
        const tuft = add(H, new THREE.SphereGeometry(0.06, 7, 6), hairM, sd * 0.14, 0.02, -0.06);
        tuft.scale.set(0.8, 1, 1.3);
      }
      const beard = add(H, new THREE.SphereGeometry(0.11, 9, 8), hairM, 0, -0.1, 0.09);
      beard.scale.set(1.25, 1.15, 0.75);
      const sash = add(B, new THREE.BoxGeometry(0.1, 0.72, 0.04), toonMaterial({ color: 0xc9564c }), 0, 0.8, 0.24);
      sash.rotation.z = 0.8;
      const pouch = add(B, new THREE.SphereGeometry(0.095, 8, 7), toonMaterial({ color: 0x8a6a44 }), 0.3, 0.52, 0.14);
      pouch.scale.set(1, 1.15, 1);
      add(pouch, new THREE.CylinderGeometry(0.03, 0.045, 0.05, 6), toonMaterial({ color: 0xe8b64c }), 0, 0.11, 0);
    } else if (variant === 'kid') {
      // Oversized noggin, cowlick spikes, adventure backpack.
      H.scale.setScalar(1.26);
      for (const [sx, rz] of [[-0.07, 0.5], [0.02, -0.15], [0.09, -0.6]]) {
        const spike = add(H, new THREE.ConeGeometry(0.045, 0.11, 6), hairM, sx, 0.2, -0.02);
        spike.rotation.z = rz;
        spike.rotation.x = -0.3;
      }
      const pack = add(B, new THREE.BoxGeometry(0.22, 0.24, 0.12), trim, 0, 0.82, -0.24);
      pack.rotation.x = -0.08;
      add(pack, new THREE.SphereGeometry(0.05, 6, 6), toonMaterial({ color: 0xd9b970 }), 0, 0.15, 0);
    } else if (variant === 'farmer') {
      // Neck kerchief and a well-used pitchfork over the shoulder.
      const scarf = add(B, new THREE.SphereGeometry(0.1, 8, 7), toonMaterial({ color: 0xc9564c }), 0, 1.05, 0.05);
      scarf.scale.set(1.45, 0.55, 1.2);
      const wood = toonMaterial({ color: 0x8a6a44 });
      const steel = toonMaterial({ color: 0xb8bcc4 });
      const fork = new THREE.Group();
      fork.position.set(0.24, 1.0, -0.14);
      fork.rotation.z = -0.42;
      fork.rotation.x = 0.12;
      add(fork, new THREE.CylinderGeometry(0.025, 0.03, 1.5, 6), wood, 0, 0, 0);
      add(fork, new THREE.BoxGeometry(0.2, 0.035, 0.03), steel, 0, 0.76, 0);
      for (const tx of [-0.08, 0, 0.08]) {
        add(fork, new THREE.CylinderGeometry(0.012, 0.006, 0.16, 5), steel, tx, 0.85, 0);
      }
      B.add(fork);
    }
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    this._t += dt;
    const t = this._t;
    const p = g.player.position;
    const distToPlayer = Math.hypot(p.x - this.group.position.x, p.z - this.group.position.z);

    let moving = false;
    if (this._talking || distToPlayer < 2.2) {
      // Face the player.
      this.yaw = dampAngle(this.yaw,
        Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z), 6, dt);
    } else if (this.opts.waypoints && this.opts.waypoints.length > 1) {
      if (this._pause > 0) {
        this._pause -= dt;
      } else {
        const wp = this.opts.waypoints[this._wpIndex];
        const dx = wp.x - this.group.position.x;
        const dz = wp.z - this.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          this._wpIndex = (this._wpIndex + 1) % this.opts.waypoints.length;
          this._pause = 1.5 + Math.random() * 4;
        } else {
          moving = true;
          this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
          const step = this.speed * dt;
          this.group.position.x += Math.sin(this.yaw) * step;
          this.group.position.z += Math.cos(this.yaw) * step;
          this.group.position.y = g.terrain.heightAt(this.group.position.x, this.group.position.z);
        }
      }
    }

    this.group.rotation.y = this.yaw;

    // Quest marker: poll status at ~2.5Hz, bob gently while shown.
    if (this.opts.quest) {
      this._questPoll -= dt;
      if (this._questPoll <= 0) {
        this._questPoll = 0.4;
        let kind = null;
        try { kind = this.opts.quest(g) || null; } catch (e) { kind = null; }
        if (kind !== this.questKind) {
          this.questKind = kind;
          this.marker.visible = !!kind;
          if (kind) this.marker.material = markerMats()[kind];
        }
      }
      if (this.marker.visible) {
        this.marker.position.y = this._markerY + Math.sin(t * 2.6) * 0.07;
        this.marker.scale.setScalar(this.questKind === 'progress' ? 0.42 : 0.58);
      }
    }

    // Walk waddle / idle sway / talk gestures.
    this._walk = damp(this._walk ?? 0, moving ? 1 : 0, 8, dt);
    const w = this._walk;
    this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.05 * w;
    this.body.rotation.z = Math.sin(t * 7) * 0.05 * w;
    this.armL.rotation.x = Math.sin(t * 7) * 0.5 * w;
    this.armR.rotation.x = -Math.sin(t * 7) * 0.5 * w;
    if (this._talking) {
      const g1 = Math.sin(t * 3.1);
      this.armR.rotation.x = -0.5 + g1 * 0.25;
      this.armR.rotation.z = -0.3;
      this.head.rotation.x = Math.sin(t * 2.2) * 0.06;
    } else {
      this.head.rotation.x = Math.sin(t * 1.7) * 0.03;
      this.head.rotation.y = damp(this.head.rotation.y, distToPlayer < 6 ? 0 : Math.sin(t * 0.4) * 0.4, 3, dt);
      this.armR.rotation.z = damp(this.armR.rotation.z, 0, 6, dt);
    }
  }
}
