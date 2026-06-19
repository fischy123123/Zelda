import * as THREE from 'three';
import { rockTexture, barkTexture } from '../gfx/Textures.js?v=5';

// Factory functions that build low-poly props from primitives. Each returns a
// THREE.Group already positioned on the ground via terrain.getHeightAt.

export function makeTree(x, z, terrain) {
  const g = new THREE.Group();
  const trunkH = 2.6 + Math.random() * 1.8;

  const bark = barkTexture();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.36, trunkH, 10),
    new THREE.MeshStandardMaterial({
      color: 0x8a6038, map: bark.map, normalMap: bark.normal,
      normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95,
    })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  // A rounded, stylized canopy made of clustered low-poly spheres. The canopy
  // sits in its own pivot group so the whole crown can sway in the wind.
  const crown = new THREE.Group();
  crown.position.y = trunkH;
  const hue = 0.27 + Math.random() * 0.07;
  const baseLight = 0.3 + Math.random() * 0.08;
  const blobs = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 1.0 + Math.random() * 0.7;
    const col = new THREE.Color().setHSL(hue, 0.5, baseLight + Math.random() * 0.1);
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 2),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, flatShading: false })
    );
    const a = (i / blobs) * Math.PI * 2;
    blob.position.set(Math.cos(a) * 0.7, 0.4 + Math.random() * 0.8, Math.sin(a) * 0.7);
    blob.castShadow = true;
    crown.add(blob);
  }
  g.add(crown);

  g.position.set(x, terrain.getHeightAt(x, z), z);
  g.rotation.y = Math.random() * Math.PI * 2;

  // Tag for wind animation in World.update.
  g.userData.sway = { crown, phase: Math.random() * Math.PI * 2, amp: 0.04 + Math.random() * 0.03 };
  return g;
}

// A small cluster of bright flowers for colour accents in the meadow.
export function makeFlowers(x, z, terrain) {
  const g = new THREE.Group();
  const palette = [0xff5d8f, 0xffd23f, 0xffffff, 0x8a6cff, 0xff8a3d];
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x3f7e3a })
    );
    const color = palette[(Math.random() * palette.length) | 0];
    const head = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 0),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, flatShading: true })
    );
    head.position.y = 0.25;
    const f = new THREE.Group();
    f.add(stem, head);
    f.position.set((Math.random() - 0.5) * 0.8, 0.2, (Math.random() - 0.5) * 0.8);
    g.add(f);
  }
  g.position.set(x, terrain.getHeightAt(x, z), z);
  return g;
}

export function makeRock(x, z, terrain) {
  const s = 0.6 + Math.random() * 1.4;
  const rt = rockTexture();
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(s, 1),
    new THREE.MeshStandardMaterial({
      color: 0x9a9b9e, map: rt.map, normalMap: rt.normal,
      normalScale: new THREE.Vector2(1.0, 1.0), roughness: 1, flatShading: true,
    })
  );
  rock.position.set(x, terrain.getHeightAt(x, z) + s * 0.4, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

export function makeBush(x, z, terrain) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.9, flatShading: false });
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.3, 2), mat);
    blob.position.set((Math.random() - 0.5) * 0.8, 0.4, (Math.random() - 0.5) * 0.8);
    blob.castShadow = true;
    g.add(blob);
  }
  g.position.set(x, terrain.getHeightAt(x, z), z);
  return g;
}

// A simple stone arch / ruin to act as a landmark.
export function makeRuin(x, z, terrain) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b8676, roughness: 1, flatShading: true });
  const pillarGeo = new THREE.BoxGeometry(0.8, 4, 0.8);
  const left = new THREE.Mesh(pillarGeo, mat);
  left.position.set(-1.5, 2, 0);
  const right = new THREE.Mesh(pillarGeo, mat);
  right.position.set(1.5, 2, 0);
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.7, 0.9), mat);
  top.position.set(0, 4.2, 0);
  [left, right, top].forEach((m) => { m.castShadow = true; g.add(m); });
  g.position.set(x, terrain.getHeightAt(x, z), z);
  g.rotation.y = Math.random() * Math.PI;
  return g;
}

// A glowing portal marking the dungeon entrance.
export function makeDungeonEntrance(x, z, terrain) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x44484f, roughness: 1, flatShading: true });

  const frame = new THREE.Mesh(new THREE.TorusGeometry(2, 0.5, 8, 16), stone);
  frame.position.y = 2.2;
  frame.castShadow = true;
  g.add(frame);

  const portal = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 24),
    new THREE.MeshBasicMaterial({ color: 0x6fe3c4, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  portal.position.y = 2.2;
  g.add(portal);
  g.userData.portal = portal; // animated by the world update

  const light = new THREE.PointLight(0x6fe3c4, 8, 12);
  light.position.y = 2.2;
  g.add(light);

  g.position.set(x, terrain.getHeightAt(x, z), z);
  return g;
}
