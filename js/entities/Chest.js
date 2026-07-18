// Treasure chests: procedural model, open animation, loot burst, persistent
// opened-state via game.state.flags.

import * as THREE from 'three';
import { toonMaterial, PALETTE } from '../gfx/Toon.js';
import { ease, clamp01 } from '../util/math.js';
import { Pickup } from './Pickup.js';

export class Chest {
  /**
   * id: unique string (persisted). loot: {gems?: n, item?: 'potion'|..., hearts?: n,
   * key?: bool, onOpen?: (game)=>void}
   */
  constructor(game, id, pos, yaw, loot, opts = {}) {
    this.game = game;
    this.id = id;
    this.loot = loot;
    this.opened = !!game.state.flags[`chest:${id}`];
    this.openT = this.opened ? 1 : 0;
    this.big = !!opts.big;

    const s = this.big ? 1.5 : 1;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;

    const wood = toonMaterial({ color: opts.big ? 0x8a6b9e : PALETTE.wood });
    const trim = toonMaterial({ color: PALETTE.gold, emissive: 0x442b00, emissiveIntensity: 0.4 });

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.55 * s, 0.7 * s), wood);
    base.position.y = 0.28 * s;
    base.castShadow = true;
    this.group.add(base);

    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.55 * s, -0.35 * s);
    const lidMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36 * s, 0.36 * s, 1.1 * s, 10, 1, false, 0, Math.PI),
      wood
    );
    lidMesh.rotation.z = Math.PI / 2;
    lidMesh.position.z = 0.35 * s;
    lidMesh.castShadow = true;
    this.lid.add(lidMesh);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.4 * s, 0.74 * s), trim);
    band.position.set(0, 0.16 * s, 0.35 * s);
    this.lid.add(band);
    this.group.add(this.lid);

    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.24 * s, 0.1 * s), trim);
    lock.position.set(0, 0.5 * s, 0.36 * s);
    this.group.add(lock);

    if (this.opened) this.lid.rotation.x = -1.9;

    game.scene.add(this.group);
    game.colliders.add({ x: pos.x, z: pos.z, r: 0.75 * s });

    this._unregister = game.interact.register({
      position: this.group.position,
      radius: 2.6 * s,
      prompt: 'Open',
      enabled: () => !this.opened,
      onInteract: () => this.open(),
    });
  }

  open() {
    if (this.opened) return;
    const g = this.game;
    // Big chests in the dungeon can require a key.
    if (this.loot.locked && g.state.keys < 1) {
      g.events.emit('toast', { text: 'Locked tight. It needs a key.' });
      g.events.emit('chest:locked', {});
      return;
    }
    if (this.loot.locked) {
      g.state.keys -= 1;
      g.events.emit('keys', { total: g.state.keys });
    }
    this.opened = true;
    this._animT = 0;
    g.state.flags[`chest:${this.id}`] = true;
    g.events.emit('chest:open', { id: this.id, big: this.big, loot: this.loot });

    // Loot burst.
    const up = this.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    const gems = this.loot.gems || 0;
    let remaining = gems;
    const drops = [];
    while (remaining >= 20) { drops.push('gem_red'); remaining -= 20; }
    while (remaining >= 5) { drops.push('gem_blue'); remaining -= 5; }
    while (remaining >= 1) { drops.push('gem_green'); remaining -= 1; }
    for (const type of drops.slice(0, 12)) {
      g.pickups.push(new Pickup(g, type, up, { bounce: true }));
    }
    if (this.loot.hearts) for (let i = 0; i < this.loot.hearts; i++) {
      g.pickups.push(new Pickup(g, 'heart', up, { bounce: true }));
    }
    if (this.loot.item) {
      const s = g.state;
      s.items[this.loot.item] = (s.items[this.loot.item] || 0) + 1;
      g.events.emit('item:added', { id: this.loot.item, name: itemName(this.loot.item) });
      g.events.emit('toast', { text: `You got ${aAn(itemName(this.loot.item))}!` });
    }
    if (this.loot.key) {
      g.state.keys += 1;
      g.events.emit('keys', { total: g.state.keys });
      g.events.emit('toast', { text: 'You found a Shrine Key!' });
    }
    this.loot.onOpen?.(g);
  }

  update(dt) {
    if (this.opened && this.openT < 1) {
      this._animT = (this._animT ?? 0) + dt;
      this.openT = clamp01(this._animT / 0.6);
      this.lid.rotation.x = -1.9 * ease.outBack(this.openT);
    }
  }
}

function itemName(id) {
  return { potion: 'Restorative Potion', sunblade: 'the Sunblade', old_key: 'Old Key' }[id] || id;
}
function aAn(name) { return /^(the|a|an)\s/i.test(name) ? name : `a ${name}`; }
