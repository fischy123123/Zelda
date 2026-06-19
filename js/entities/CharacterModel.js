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
    this._linkify(model);

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

  // Best-effort "Link" pass on a generic human: tint the outfit green and add
  // the iconic pointed green cap (tracked to the head so it moves naturally).
  _linkify(model) {
    // Recolour the whole figure to a tunic green (kills the camo/military read)
    // and grab the head + hips bones so we can attach Link-shaped clothing.
    const green = new THREE.Color(0x4e9e3f);
    model.traverse((o) => {
      if ((o.isMesh || o.isSkinnedMesh) && o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        const recol = list.map((m) => {
          const c = m.clone();
          if (c.color) c.color.copy(green);
          c.roughness = 0.85;
          c.metalness = 0.0;
          c.envMapIntensity = 0.5;
          return c;
        });
        o.material = Array.isArray(o.material) ? recol : recol[0];
      }
      if (o.isBone) {
        if (!this.headBone && /head/i.test(o.name)) this.headBone = o;
        if (!this.hipsBone && /hips|pelvis/i.test(o.name)) this.hipsBone = o;
      }
    });
    this._tmp = new THREE.Vector3();

    const tunicMat = new THREE.MeshStandardMaterial({ color: 0x3f9140, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1f, roughness: 0.9 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xe5c23a, metalness: 0.4, roughness: 0.4 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2f8f3e, roughness: 0.8, flatShading: true });

    // Iconic pointed cap.
    this.hat = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 12), capMat);
    cap.position.y = 0.2;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 16), capMat);
    brim.rotation.x = Math.PI / 2;
    this.hat.add(cap, brim);
    this.hat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(this.hat);
    if (!this.headBone) this.hat.position.set(0, TARGET_HEIGHT * 0.9, 0);

    // Flared tunic skirt + belt to reshape the military silhouette into Link's.
    this.tunic = new THREE.Group();
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.6, 18, 1, true), tunicMat);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 20), beltMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.26;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.05), goldMat);
    buckle.position.set(0, 0.26, 0.3);
    this.tunic.add(skirt, belt, buckle);
    this.tunic.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.add(this.tunic);
    if (!this.hipsBone) this.tunic.position.set(0, TARGET_HEIGHT * 0.5, 0);
  }

  // Smoothly cross-fade to a locomotion state: 'idle' | 'walk' | 'run'.
  setState(name) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(0.18).play();
    if (this.current) this.current.fadeOut(0.18);
    this.current = next;
  }

  update(dt) {
    this.mixer?.update(dt);
    // Keep the cap on the head and the tunic at the hips as they move.
    if (this.hat && this.headBone) {
      this.headBone.getWorldPosition(this._tmp);
      this.root.worldToLocal(this._tmp);
      this.hat.position.set(this._tmp.x, this._tmp.y + 0.16, this._tmp.z);
    }
    if (this.tunic && this.hipsBone) {
      this.hipsBone.getWorldPosition(this._tmp);
      this.root.worldToLocal(this._tmp);
      this.tunic.position.set(this._tmp.x, this._tmp.y - 0.02, this._tmp.z);
    }
  }
}
