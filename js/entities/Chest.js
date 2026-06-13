import * as THREE from 'three';

// An openable container. When opened it yields a configured reward and the lid
// flips up. Each chest has a stable id so the save system can track it.
export class Chest {
  constructor(id, x, z, terrain, reward) {
    this.id = id;
    this.reward = reward;          // { itemId, count } or { rupees } etc.
    this.opened = false;
    this.lidAngle = 0;

    this.group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a33, roughness: 0.9, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.5, roughness: 0.4 });

    this.base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.9), wood);
    this.base.position.y = 0.35;
    this.base.castShadow = true;

    this.lid = new THREE.Group();
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.9), wood);
    lidBox.position.y = 0.2;
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.08), trim);
    lock.position.set(0, 0.1, 0.46);
    this.lid.add(lidBox, lock);
    this.lid.position.set(0, 0.7, -0.45); // hinge at the back edge
    this.lid.traverse((o) => { o.castShadow = true; });

    this.group.add(this.base, this.lid);
    const y = terrain ? terrain.getHeightAt(x, z) : 0;
    this.group.position.set(x, y, z);
  }

  open() {
    if (this.opened) return false;
    this.opened = true;
    return true;
  }

  update(dt) {
    // Animate the lid swinging open.
    const target = this.opened ? -Math.PI * 0.6 : 0;
    this.lidAngle += (target - this.lidAngle) * Math.min(1, dt * 6);
    this.lid.rotation.x = this.lidAngle;
  }
}
