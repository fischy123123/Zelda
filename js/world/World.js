import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { makeTree, makeRock, makeBush, makeRuin, makeDungeonEntrance } from './Props.js';
import { Enemy } from '../entities/Enemy.js';
import { Pickup } from '../entities/Pickup.js';
import { Chest } from '../entities/Chest.js';

// Builds and owns the open overworld: terrain, water, scattered props, enemies,
// pickups, chests, and the dungeon entrance.
export class World {
  constructor() {
    this.name = 'overworld';
    this.terrain = new Terrain({ size: 400, segments: 200, maxHeight: 22, seed: 7 });
    this.group = new THREE.Group();
    this.enemies = [];
    this.pickups = [];
    this.chests = [];
    this.colliders = [];          // overworld is open; props are non-blocking
    this.interactables = [];

    this.background = new THREE.Color(0x9bd3ff);
    this.fog = new THREE.Fog(0x9bd3ff, 80, 320);
    this.spawn = new THREE.Vector3(0, this.terrain.getHeightAt(0, 0), 0);

    this._buildLighting();
    this.group.add(this.terrain.mesh);
    this._buildWater();
    this._scatterProps();
    this._buildDungeonEntrance();
    this._spawnEnemies();
    this._spawnLoot();
  }

  _buildLighting() {
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a6b3a, 0.9);
    this.group.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d6, 1.5);
    sun.position.set(60, 90, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0004;
    this.sun = sun;
    this.group.add(sun);
    this.group.add(sun.target);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(this.terrain.size, this.terrain.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f7fd1, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.3,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = this.terrain.seaLevel;
    this.water.receiveShadow = true;
    this.group.add(this.water);
  }

  // Reject spots that are underwater or too close to the spawn meadow.
  _validSpot(minR = 18, maxR = 185) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.terrain.isUnderwater(x, z)) return { x, z };
    }
    return null;
  }

  _scatterProps() {
    for (let i = 0; i < 260; i++) {
      const spot = this._validSpot(12);
      if (!spot) continue;
      const h = this.terrain.getHeightAt(spot.x, spot.z);
      let prop;
      if (h > this.terrain.maxHeight * 0.72) prop = makeRock(spot.x, spot.z, this.terrain);
      else {
        const roll = Math.random();
        if (roll < 0.55) prop = makeTree(spot.x, spot.z, this.terrain);
        else if (roll < 0.8) prop = makeRock(spot.x, spot.z, this.terrain);
        else prop = makeBush(spot.x, spot.z, this.terrain);
      }
      this.group.add(prop);
    }
    // A few ruin landmarks.
    for (let i = 0; i < 5; i++) {
      const spot = this._validSpot(30, 160);
      if (spot) this.group.add(makeRuin(spot.x, spot.z, this.terrain));
    }
  }

  _buildDungeonEntrance() {
    // Place the entrance at a fixed, reachable spot on dry land.
    let x = 48, z = -34;
    // Nudge to dry land if needed.
    if (this.terrain.isUnderwater(x, z)) { x = 30; z = 30; }
    this.entrancePos = new THREE.Vector3(x, this.terrain.getHeightAt(x, z), z);
    this.entrance = makeDungeonEntrance(x, z, this.terrain);
    this.group.add(this.entrance);

    this.interactables.push({
      position: this.entrancePos,
      range: 4.5,
      getPrompt: () => '[E] Enter the dungeon',
      interact: (game) => game.enterDungeon(),
    });
  }

  _spawnEnemies() {
    for (let i = 0; i < 14; i++) {
      const spot = this._validSpot(22, 170);
      if (!spot) continue;
      const kind = Math.random() < 0.65 ? 'chu' : 'moblin';
      const e = new Enemy(kind, spot.x, spot.z, this.terrain);
      this.enemies.push(e);
      this.group.add(e.mesh);
    }
  }

  _spawnLoot() {
    // Scattered rupees.
    for (let i = 0; i < 16; i++) {
      const spot = this._validSpot(14, 170);
      if (!spot) continue;
      const y = this.terrain.getHeightAt(spot.x, spot.z) + 0.6;
      const roll = Math.random();
      const color = roll < 0.7 ? 'green' : roll < 0.95 ? 'blue' : 'red';
      const value = color === 'green' ? 1 : color === 'blue' ? 5 : 20;
      const p = new Pickup('rupee', spot.x, y, spot.z, { color, value });
      this.pickups.push(p);
      this.group.add(p.mesh);
    }

    // Overworld chests: a shield, a bow, and a bomb bag.
    const chestDefs = [
      { dx: -24, dz: 18, reward: { itemId: 'shield', count: 1 } },
      { dx: 20, dz: 40, reward: { itemId: 'bow', count: 1 } },
      { dx: -40, dz: -20, reward: { itemId: 'bomb', count: 5 } },
    ];
    chestDefs.forEach((c, i) => {
      let { dx, dz } = c;
      if (this.terrain.isUnderwater(dx, dz)) { dx *= 0.4; dz *= 0.4; }
      const chest = new Chest(`ow-chest-${i}`, dx, dz, this.terrain, c.reward);
      this.chests.push(chest);
      this.group.add(chest.group);
      this.interactables.push({
        position: chest.group.position,
        range: 2.6,
        getPrompt: () => (chest.opened ? null : '[E] Open chest'),
        interact: (game) => game.openChest(chest),
      });
    });
  }

  update(dt, elapsed) {
    // Animate the portal shimmer and water.
    if (this.entrance?.userData.portal) {
      const p = this.entrance.userData.portal;
      p.material.opacity = 0.4 + Math.sin(elapsed * 3) * 0.18;
      p.rotation.z += dt * 0.5;
    }
    if (this.water) {
      this.water.position.y = this.terrain.seaLevel + Math.sin(elapsed * 0.8) * 0.08;
    }
    // Keep the sun shadow frustum centered on the action.
    if (this.sun && this._followTarget) {
      this.sun.position.set(this._followTarget.x + 60, 90, this._followTarget.z + 30);
      this.sun.target.position.copy(this._followTarget);
    }
    for (const c of this.chests) c.update(dt);
  }

  setShadowFocus(pos) { this._followTarget = pos; }
}
