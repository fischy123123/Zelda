import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// Loads the textured BOTW Link OBJ (a static mesh — no skeleton/animation),
// auto-fits it to the hero height, and exposes it as `.root`. If anything fails
// the caller keeps the procedural Link, so the game never breaks.
const BASE = 'assets/link/';
const TARGET_HEIGHT = 1.95;

export class HeroModel {
  constructor(onReady, { yawOffset = 0 } = {}) {
    this.ready = false;
    this.root = new THREE.Group();
    this.root.rotation.y = yawOffset; // OBJ faces -Z; turn to face travel direction

    const fail = (e) => { console.warn('[HeroModel] load failed, using fallback:', e); onReady?.(null); };
    try {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath(BASE);
      mtlLoader.load('Link.mtl', (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath(BASE);
        objLoader.load('Link.obj',
          (obj) => { try { this._setup(obj); onReady?.(this); } catch (e) { fail(e); } },
          undefined, fail);
      }, undefined, fail);
    } catch (e) { fail(e); }
  }

  _setup(obj) {
    // Auto-fit height, drop feet to y=0, centre horizontally.
    obj.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(obj);
    let h = box.max.y - box.min.y || 1;
    if (!isFinite(h) || h < 0.2 || h > 1000) h = 1.7;
    obj.scale.setScalar(TARGET_HEIGHT / h);
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box.min.y;
    obj.position.x -= (box.min.x + box.max.x) / 2;
    obj.position.z -= (box.min.z + box.max.z) / 2;

    obj.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;
      c.frustumCulled = false;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) {
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 8; }
        m.shininess = 12;
        // Alpha cutout for hair/eyelash cards.
        const n = (m.name || '').toLowerCase();
        if (n.includes('hair') || n.includes('eyelash')) { m.transparent = true; m.alphaTest = 0.5; }
      }
    });

    this.root.add(obj);
    this.ready = true;
  }

  update() { /* static mesh — nothing to animate */ }
}
