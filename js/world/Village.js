import * as THREE from 'three';
import { stylizeCharacter } from '../gfx/Materials.js?v=14';

// Hylia Village: a cluster of houses, a well, torch posts, and two NPCs near the
// spawn meadow. Houses/well are solid (AABB colliders); NPCs are talkable.
export class Village {
  constructor(terrain, { lights = true } = {}) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.colliders = [];
    this.npcs = [];
    this.interactables = [];
    this.flickers = [];

    this._house(-13, 7, 0xc9b28a, 0xa5502e);
    this._house(12, 9, 0xbfae90, 0x7a4a86);
    this._house(5, -14, 0xd0bd93, 0x3f6f9e);
    this._well(-6, -7);
    this._torch(-2, 10, lights);
    this._torch(8, -4, lights);
    this._sign(0, 4);

    this._npc({
      id: 'elder', name: 'Elder Maru', x: 1.5, z: 8,
      robe: 0x7a4a2e, hair: 0xdfe3e8, staff: true,
    });
    this._npc({
      id: 'lin', name: 'Lin', x: 9.5, z: 6,
      robe: 0xc4506a, hair: 0x6e4a28, staff: false,
    });
  }

  _house(x, z, wallColor, roofColor) {
    const y = this.terrain.getHeightAt(x, z);
    const g = new THREE.Group();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...o });

    const walls = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.6, 3.4), mat(wallColor));
    walls.position.y = 1.3;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.8, 4), mat(roofColor));
    roof.position.y = 3.4;
    roof.rotation.y = Math.PI / 4;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.1), mat(0x5b3a22));
    door.position.set(0, 0.78, 1.72);
    // Warm windows that read at dusk.
    const winMat = new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xcc8a30, emissiveIntensity: 0.9 });
    for (const sx of [-1.1, 1.1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.08), winMat);
      w.position.set(sx, 1.6, 1.72);
      g.add(w);
    }
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.45), mat(0x8b8676));
    chimney.position.set(1.2, 3.6, -0.8);
    g.add(walls, roof, door, chimney);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, y, z);
    this.group.add(g);

    this.colliders.push({ minX: x - 2.0, maxX: x + 2.0, minZ: z - 1.85, maxZ: z + 1.85 });
  }

  _well(x, z) {
    const y = this.terrain.getHeightAt(x, z);
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8d92, roughness: 1, flatShading: true });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.9, 12, 1, true), stone);
    ring.position.y = 0.45;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.82, 14),
      new THREE.MeshStandardMaterial({ color: 0x2b86c5, roughness: 0.15 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.55;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    for (const sx of [-0.85, 0.85]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), postMat);
      post.position.set(sx, 1.2, 0);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x9e5f38, flatShading: true }));
    roof.position.y = 2.25;
    roof.rotation.y = Math.PI / 4;
    g.add(ring, water, roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(x, y, z);
    this.group.add(g);
    this.colliders.push({ minX: x - 1.1, maxX: x + 1.1, minZ: z - 1.1, maxZ: z + 1.1 });
  }

  _torch(x, z, lights) {
    const y = this.terrain.getHeightAt(x, z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }));
    post.position.y = 1.1;
    post.castShadow = true;
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffc26a }));
    flame.scale.y = 1.5;
    flame.position.y = 2.35;
    g.add(post, flame);
    let light = null;
    if (lights) {
      light = new THREE.PointLight(0xffa54f, 3, 12, 1.8);
      light.position.y = 2.4;
      g.add(light);
    }
    g.position.set(x, y, z);
    this.group.add(g);
    this.flickers.push({ flame, light, phase: Math.random() * Math.PI * 2 });
  }

  _sign(x, z) {
    const y = this.terrain.getHeightAt(x, z);
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6038, roughness: 1 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), wood);
    post.position.y = 0.6;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.08), wood);
    board.position.y = 1.15;
    g.add(post, board);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(x, y, z);
    this.group.add(g);
  }

  _npc({ id, name, x, z, robe, hair, staff }) {
    const y = this.terrain.getHeightAt(x, z);
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 12), mat(robe));
    body.position.y = 0.68;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), mat(0xf2c79a));
    head.position.y = 1.55;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), mat(hair));
    hairCap.position.y = 1.62;
    hairCap.scale.set(1, 0.7, 1);
    g.add(body, head, hairCap);
    if (staff) {
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), mat(0x6b4a2b));
      stick.position.set(0.45, 0.8, 0.1);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x6fe3c4, emissive: 0x2a8a70, emissiveIntensity: 0.8 }));
      knob.position.set(0.45, 1.62, 0.1);
      g.add(stick, knob);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    stylizeCharacter(g, { thickness: 0.045 });
    g.position.set(x, y, z);
    this.group.add(g);

    const npc = { id, name, group: g, baseY: y, phase: Math.random() * Math.PI * 2 };
    this.npcs.push(npc);
    this.interactables.push({
      position: g.position,
      range: 2.8,
      getPrompt: () => `[E] Talk to ${name}`,
      interact: (game) => game.talkTo(id),
    });
  }

  update(dt, elapsed) {
    // Gentle idle sway so villagers feel alive; torch flames flicker.
    for (const n of this.npcs) {
      n.group.position.y = n.baseY + Math.sin(elapsed * 1.6 + n.phase) * 0.02;
      n.group.rotation.y = Math.sin(elapsed * 0.5 + n.phase) * 0.25;
    }
    for (const f of this.flickers) {
      const k = 1 + Math.sin(elapsed * 11 + f.phase) * 0.16;
      f.flame.scale.set(k, 1.5 * k, k);
      if (f.light) f.light.intensity = 2.6 + Math.sin(elapsed * 13 + f.phase) * 0.9;
    }
  }
}
