import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Loads the rigged BOTW/TP Link FBX, fixes its textures (the shipped FBX binds
// the normal map as the colour map), and — because its single baked clip isn't a
// walk — drives a procedural walk/run cycle directly on the biped leg/arm bones.
const BASE = 'assets/linkanim/';
const TARGET_HEIGHT = 1.95;

export class AnimatedHero {
  constructor(onReady, { yawOffset = 0 } = {}) {
    this.ready = false;
    this.mixer = null;
    this.bones = {};
    this.root = new THREE.Group();
    this.root.rotation.y = yawOffset;
    this._q = new THREE.Quaternion();
    this._axis = new THREE.Vector3(1, 0, 0); // leg/arm swing axis (flexion)

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
    // Auto-fit to hero height; drop feet to ground; centre.
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

    // Match the flipY the FBX expected, then load the *correct* maps:
    // (1).jpg = colour, (1).png = normal, (2).jpg = specular.
    let refFlip = false;
    fbx.traverse((c) => {
      if (c.isMesh) {
        const m = Array.isArray(c.material) ? c.material[0] : c.material;
        if (m && m.map) refFlip = m.map.flipY;
      }
    });
    const tl = new THREE.TextureLoader().setPath(BASE);
    const albedo = tl.load('textures_(1).jpg');
    albedo.colorSpace = THREE.SRGBColorSpace; albedo.flipY = refFlip; albedo.anisotropy = 8;
    const normal = tl.load('textures_(1).png'); normal.flipY = refFlip;
    const spec = tl.load('textures_(2).jpg'); spec.flipY = refFlip;

    fbx.traverse((c) => {
      if (!c.isMesh) return;
      c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) {
        m.map = albedo;
        m.normalMap = normal;
        if ('specularMap' in m) m.specularMap = spec;
        if (m.emissive) m.emissive.setScalar(0);
        if ('shininess' in m) m.shininess = 14;
        m.color && m.color.setScalar(1);
        m.needsUpdate = true;
      }
    });

    this.root.add(fbx);

    // Grab biped leg/arm bones for the procedural walk.
    fbx.traverse((o) => {
      if (!o.isBone) return;
      const n = o.name.toLowerCase();
      const set = (k) => { if (!this.bones[k]) this.bones[k] = o; };
      if (n.endsWith('lthigh')) set('lThigh');
      else if (n.endsWith('rthigh')) set('rThigh');
      else if (n.endsWith('lcalf')) set('lCalf');
      else if (n.endsWith('rcalf')) set('rCalf');
      else if (n.endsWith('lupperarm')) set('lUpper');
      else if (n.endsWith('rupperarm')) set('rUpper');
      else if (n.endsWith('lforearm')) set('lFore');
      else if (n.endsWith('rforearm')) set('rFore');
    });

    // Keep the baked clip playing softly as a base idle pose.
    const clips = fbx.animations || [];
    if (clips.length) {
      this.mixer = new THREE.AnimationMixer(fbx);
      this.mixer.clipAction(clips[0]).play();
    }
    this.ready = true;
  }

  _bend(bone, angle) {
    if (!bone) return;
    this._q.setFromAxisAngle(this._axis, angle);
    bone.quaternion.multiply(this._q);
  }

  // Overlay a walk/run cycle on the leg + arm bones (call after update()).
  walk(phase, intensity = 1) {
    const b = this.bones;
    const s = Math.sin(phase) * 0.7 * intensity;
    this._bend(b.lThigh, s);
    this._bend(b.rThigh, -s);
    // Calves bend on the back-swing.
    this._bend(b.lCalf, Math.max(0, -s) * 0.9);
    this._bend(b.rCalf, Math.max(0, s) * 0.9);
    // Arms counter-swing.
    this._bend(b.lUpper, -s * 0.5);
    this._bend(b.rUpper, s * 0.5);
  }

  // Overlay a sword chop on the right arm. t in [0,1].
  attack(t) {
    const chop = t < 0.5 ? THREE.MathUtils.lerp(-1.4, 1.2, t / 0.5) : THREE.MathUtils.lerp(1.2, 0, (t - 0.5) / 0.5);
    this._bend(this.bones.rUpper, chop);
    this._bend(this.bones.rFore, chop * 0.5);
  }

  update(dt) { this.mixer?.update(dt); }
}
