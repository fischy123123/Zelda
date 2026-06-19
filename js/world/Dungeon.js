import * as THREE from 'three';
import { Enemy } from '../entities/Enemy.js?v=4';
import { Chest } from '../entities/Chest.js?v=4';
import { Pickup } from '../entities/Pickup.js?v=4';

// A flat terrain stand-in so the player/enemies/camera clamp to the stone floor.
const FLAT = {
  size: 60,
  seaLevel: -999,
  maxHeight: 1,
  getHeightAt: () => 0,
  isUnderwater: () => false,
};

// Builds the dungeon interior: two rooms split by a locked gate, torches,
// guards, and a reward chest in the treasure room.
export class Dungeon {
  constructor(_renderer) {
    this.name = 'dungeon';
    this.terrain = FLAT;
    this.group = new THREE.Group();
    this.enemies = [];
    this.pickups = [];
    this.chests = [];
    this.colliders = [];
    this.interactables = [];
    this.unlocked = false;
    this.cleared = false;
    this.environment = null; // dark interior — lit only by torches

    this.background = new THREE.Color(0x05070b);
    this.fog = new THREE.FogExp2(0x05070b, 0.05);
    this.spawn = new THREE.Vector3(0, 0, -16);

    this._buildShell();
    this._buildGate();
    this._buildTorches();
    this._spawnEnemies();
    this._buildReward();
    this._buildExit();

    this.stone = null;
  }

  _wall(x, z, w, d, h = 4) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 1, flatShading: true });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return mesh;
  }

  _buildShell() {
    // Floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 42),
      new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 1 })
    );
    floor.rotateX(-Math.PI / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 42),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1, side: THREE.DoubleSide })
    );
    ceil.rotateX(Math.PI / 2);
    ceil.position.y = 5;
    this.group.add(ceil);

    // Outer walls (room spans x:[-15,15], z:[-21,21]).
    this._wall(0, -21, 30, 1.5);   // south (entry) wall
    this._wall(0, 21, 30, 1.5);    // north (treasure) wall
    this._wall(-15, 0, 1.5, 42);   // west
    this._wall(15, 0, 1.5, 42);    // east

    // Dividing wall at z=0 with a 4-wide gap in the middle for the gate.
    this._wall(-9.25, 0, 11.5, 1.5);
    this._wall(9.25, 0, 11.5, 1.5);
  }

  _buildGate() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.6, roughness: 0.3, emissive: 0x4a3500 });
    this.gate = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.6), mat);
    this.gate.position.set(0, 2, 0);
    this.gate.castShadow = true;
    this.group.add(this.gate);
    this.gateCollider = { minX: -2, maxX: 2, minZ: -0.6, maxZ: 0.6 };
    this.colliders.push(this.gateCollider);

    this.interactables.push({
      position: new THREE.Vector3(0, 0, -1.4),
      range: 2.6,
      getPrompt: (game) => {
        if (this.unlocked) return null;
        return game.inventory.keys > 0 ? '[E] Use Small Key' : '[E] Locked — find a key';
      },
      interact: (game) => game.tryUnlockGate(this),
    });
  }

  unlock() {
    this.unlocked = true;
    // Drop the gate collider and slide the gate up out of the way.
    this.colliders = this.colliders.filter((c) => c !== this.gateCollider);
  }

  _buildTorches() {
    const positions = [
      [-13, -18], [13, -18], [-13, -3], [13, -3], [-13, 18], [13, 18],
    ];
    this.torchLights = [];
    for (const [x, z] of positions) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      post.position.set(x, 1.0, z);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd27a })
      );
      flame.scale.y = 1.4;
      flame.position.set(x, 1.7, z);
      const light = new THREE.PointLight(0xffa54f, 6, 14, 1.6);
      light.position.set(x, 1.9, z);
      this.torchLights.push(light);
      this.group.add(post, flame, light);
    }
    // A dim ambient so the room is navigable.
    this.group.add(new THREE.AmbientLight(0x404858, 0.5));
  }

  _spawnEnemies() {
    // Entry-room guards; one carries the small key.
    const guards = [
      { x: -6, z: -14, kind: 'chu' },
      { x: 6, z: -8, kind: 'chu' },
      { x: 0, z: -12, kind: 'moblin', dropsKey: true },
    ];
    for (const g of guards) {
      const e = new Enemy(g.kind, g.x, g.z, this.terrain, { dropsKey: g.dropsKey });
      this.enemies.push(e);
      this.group.add(e.mesh);
    }
    // Treasure-room boss guard.
    const boss = new Enemy('moblin', 0, 14, this.terrain);
    boss.maxHp = 10; boss.hp = 10; boss.speed = 3.6; boss.mesh.scale.setScalar(1.6);
    this.enemies.push(boss);
    this.group.add(boss.mesh);
  }

  _buildReward() {
    this.rewardChest = new Chest('dungeon-reward', 0, 18, this.terrain, {
      itemId: 'triforce', count: 1, alsoHeart: true,
    });
    this.chests.push(this.rewardChest);
    this.group.add(this.rewardChest.group);
    this.interactables.push({
      position: this.rewardChest.group.position,
      range: 2.6,
      getPrompt: () => (this.rewardChest.opened ? null : '[E] Open the reliquary'),
      interact: (game) => game.openChest(this.rewardChest),
    });
  }

  _buildExit() {
    // Glowing exit pad near the entry, back to the overworld.
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x6fe3c4, transparent: true, opacity: 0.5 })
    );
    pad.rotateX(-Math.PI / 2);
    pad.position.set(0, 0.02, -19);
    this.group.add(pad);
    this.exitPad = pad;
    this.group.add(new THREE.PointLight(0x6fe3c4, 5, 10));

    this.interactables.push({
      position: new THREE.Vector3(0, 0, -19),
      range: 3,
      getPrompt: () => '[E] Leave the dungeon',
      interact: (game) => game.exitDungeon(),
    });
  }

  update(dt, elapsed) {
    // Flicker torches and animate the gate sliding open when unlocked.
    for (const l of this.torchLights) {
      l.intensity = 5 + Math.sin(elapsed * 12 + l.position.x) * 1.5;
    }
    if (this.exitPad) this.exitPad.material.opacity = 0.4 + Math.sin(elapsed * 3) * 0.15;
    if (this.unlocked && this.gate.position.y < 6) {
      this.gate.position.y += dt * 4;
    }
    for (const c of this.chests) c.update(dt);
  }

  setShadowFocus() { /* dungeon uses point lights, no directional shadow focus */ }
}
