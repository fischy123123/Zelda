import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Loads a rigged humanoid glTF with real (motion-captured) skeletal animations
// and drives locomotion states with smooth cross-fades. Auto-fits the model to
// the hero's height and orients its feet to the ground. If loading fails the
// caller keeps using the procedural fallback model, so the game never breaks.
//
// The default model is a license-clear human character hosted by three.js with
// built-in Idle / Walk / Run mocap clips.
const DEFAULT_URL = 'https://threejs.org/examples/models/gltf/Soldier.glb';
const TARGET_HEIGHT = 1.95;

export class CharacterModel {
  constructor(onReady, { url = DEFAULT_URL, yawOffset = Math.PI } = {}) {
    this.ready = false;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.root = new THREE.Group();
    this.root.rotation.y = yawOffset; // align model "forward" with our facing

    try {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => { try { this._setup(gltf); onReady?.(this); } catch (e) { console.warn('[CharacterModel] setup failed:', e); onReady?.(null); } },
        undefined,
        (err) => { console.warn('[CharacterModel] load failed, using fallback:', err); onReady?.(null); }
      );
    } catch (e) {
      console.warn('[CharacterModel] loader unavailable:', e);
      onReady?.(null);
    }
  }

  _setup(gltf) {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) o.material.envMapIntensity = 0.6;
      }
    });

    // Auto-fit to the hero's height and drop feet to y = 0. World matrices must
    // be current before measuring or the box (and thus the scale) is wrong.
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    let h = box.max.y - box.min.y;
    if (!isFinite(h) || h < 0.2 || h > 100) h = 1.8; // sanity fallback
    model.scale.multiplyScalar(TARGET_HEIGHT / h);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    model.position.y -= box.min.y;

    this.root.add(model);

    // Map clips by name (case-insensitive), with sensible fallbacks.
    this.mixer = new THREE.AnimationMixer(model);
    const byName = {};
    for (const clip of gltf.animations) byName[clip.name.toLowerCase()] = clip;
    const pick = (...names) => {
      for (const n of names) {
        const hit = Object.keys(byName).find((k) => k.includes(n));
        if (hit) return byName[hit];
      }
      return gltf.animations[0];
    };
    this.actions.idle = this.mixer.clipAction(pick('idle', 'stand'));
    this.actions.walk = this.mixer.clipAction(pick('walk'));
    this.actions.run = this.mixer.clipAction(pick('run'));
    for (const a of Object.values(this.actions)) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
    this.actions.idle.setEffectiveWeight(1);
    this.current = this.actions.idle;
    this.ready = true;
  }

  // Smoothly cross-fade to a locomotion state: 'idle' | 'walk' | 'run'.
  setState(name) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    if (this.current) this.current.fadeOut(0.18);
    this.current = next;
  }

  update(dt) { this.mixer?.update(dt); }
}
