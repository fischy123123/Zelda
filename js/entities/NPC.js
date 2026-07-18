// Villagers: shared procedural body rig with per-person variety, waypoint
// wandering, idle gestures, and dialogue hookup.

import * as THREE from 'three';
import { toonMaterial, addOutline } from '../gfx/Toon.js';
import { clamp01, damp, dampAngle } from '../util/math.js';
import { getDialogue } from '../data/dialogue.js';

export class NPC {
  /**
   * opts: {name, dialogueId, pos: {x,z}, waypoints: [{x,z}...], speed?,
   *        colors: {robe, trim?, skin?, hair?}, hat: 'none'|'straw'|'hood'|'cap',
   *        apron?: bool, scale?: number}
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

    game.interact.register({
      position: this.group.position,
      radius: 3,
      prompt: 'Talk',
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
    // Hair / hat.
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
    } else {
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

    this.body.scale.setScalar(s);
    addOutline(this.group, 0.03);
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
