import * as THREE from 'three';

// Collectible that bobs, spins, gets vacuumed toward a nearby player, and is
// collected on contact. Types: 'rupee', 'heart', 'key', 'item'.
const RUPEE_COLORS = { green: 0x46d36a, blue: 0x4aa8ff, red: 0xff5a5a };

export class Pickup {
  constructor(type, x, y, z, opts = {}) {
    this.type = type;
    this.value = opts.value ?? 1;
    this.itemId = opts.itemId ?? null;   // for type 'item'
    this.collected = false;
    this.baseY = y;
    this.bobPhase = Math.random() * Math.PI * 2;

    this.mesh = this._buildMesh(opts);
    this.mesh.position.set(x, y, z);
  }

  _buildMesh(opts) {
    if (this.type === 'rupee') {
      const color = RUPEE_COLORS[opts.color || 'green'] || RUPEE_COLORS.green;
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.4, 0),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.3 })
      );
      m.scale.set(0.7, 1.2, 0.7);
      m.castShadow = true;
      return m;
    }
    if (this.type === 'heart') {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xff4d5e, emissive: 0xff4d5e, emissiveIntensity: 0.5 })
      );
      m.castShadow = true;
      return m;
    }
    if (this.type === 'key') {
      const g = new THREE.Group();
      const gold = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x916b00, metalness: 0.6, roughness: 0.3 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 14), gold);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), gold);
      shaft.position.y = -0.35;
      g.add(ring, shaft);
      g.traverse((o) => { o.castShadow = true; });
      return g;
    }
    // generic item pickup — a glowing gem
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0xffba3a, emissiveIntensity: 0.6, flatShading: true })
    );
    m.castShadow = true;
    return m;
  }

  update(dt, playerPos) {
    if (this.collected) return;
    this.bobPhase += dt * 3;
    this.mesh.rotation.y += dt * 2;
    this.mesh.position.y = this.baseY + Math.sin(this.bobPhase) * 0.18;

    // Vacuum toward player when close, collect when very close.
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.4) {
      const pull = (1 - dist / 2.4) * dt * 8;
      this.mesh.position.x += dx * pull;
      this.mesh.position.z += dz * pull;
    }
    if (dist < 0.8) this.collected = true;
  }

  dispose() {
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
