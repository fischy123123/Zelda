import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Loads the rigged + animated BOTW Link FBX, auto-fits it to the hero height,
// and plays its skeletal animation through an AnimationMixer. If the FBX has
// named idle/walk/run clips they are cross-faded by movement; if it has a single
// clip it just plays continuously. Falls back gracefully on any failure.
const BASE = 'assets/linkanim/';
const TARGET_HEIGHT = 1.95;

export class AnimatedHero {
  constructor(onReady, { yawOffset = 0 } = {}) {
    this.ready = false;
    this.single = false;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.root = new THREE.Group();
    this.root.rotation.y = yawOffset;

    const fail = (e) => { console.warn('[AnimatedHero] load failed, using fallback:', e); onReady?.(null); };
    try {
      const loader = new FBXLoader();
      loader.setResourcePath(BASE);
      loader.setPath(BASE);
      loader.load('link.fbx',
        (obj) => { try { this._setup(obj); onReady?.(this); } catch (e) { fail(e); } },
        undefined, fail);
    } catch (e) { fail(e); }
  }

  _setup(fbx) {
    // Auto-fit (FBX is often in centimetres / a different up axis).
    fbx.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(fbx);
    let h = box.max.y - box.min.y || 1;
    if (!isFinite(h) || h < 0.2 || h > 1e6) h = 170;
    fbx.scale.multiplyScalar(TARGET_HEIGHT / h);
    fbx.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(fbx);
    fbx.position.y -= box.min.y;
    fbx.position.x -= (box.min.x + box.max.x) / 2;
    fbx.position.z -= (box.min.z + box.max.z) / 2;

    fbx.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;
      c.frustumCulled = false;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) {
        if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 8; }
        if (m.emissive) m.emissive.setScalar(0);
      }
    });

    this.root.add(fbx);

    const clips = fbx.animations || [];
    if (clips.length) {
      this.mixer = new THREE.AnimationMixer(fbx);
      const byName = {};
      for (const c of clips) byName[c.name.toLowerCase()] = c;
      const pick = (...names) => {
        for (const n of names) {
          const k = Object.keys(byName).find((key) => key.includes(n));
          if (k) return byName[k];
        }
        return clips[0];
      };
      this.single = clips.length === 1;
      this.actions.idle = this.mixer.clipAction(pick('idle', 'stand', 'take'));
      this.actions.walk = this.mixer.clipAction(pick('walk', 'run', 'take'));
      this.actions.run = this.mixer.clipAction(pick('run', 'walk', 'take'));
      for (const a of Object.values(this.actions)) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
      this.actions.idle.setEffectiveWeight(1);
      this.current = this.actions.idle;
    }
    this.ready = true;
  }

  setState(name) {
    if (this.single || !this.mixer) return;
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    if (this.current) this.current.fadeOut(0.2);
    this.current = next;
  }

  update(dt) { this.mixer?.update(dt); }
}
