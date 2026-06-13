import * as THREE from 'three';

// Factory functions that build low-poly props from primitives. Each returns a
// THREE.Group already positioned on the ground via terrain.getHeightAt.

export function makeTree(x, z, terrain) {
  const g = new THREE.Group();
  const trunkH = 2.4 + Math.random() * 1.6;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.32, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const foliageColor = new THREE.Color().setHSL(0.32, 0.55, 0.32 + Math.random() * 0.1);
  for (let i = 0; i < 3; i++) {
    const r = 1.6 - i * 0.4;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, 1.6, 7),
      new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.9, flatShading: true })
    );
    cone.position.y = trunkH + i * 0.9;
    cone.castShadow = true;
    g.add(cone);
  }

  g.position.set(x, terrain.getHeightAt(x, z), z);
  g.rotation.y = Math.random() * Math.PI * 2;
  return g;
}

export function makeRock(x, z, terrain) {
  const s = 0.6 + Math.random() * 1.4;
  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(s, 0),
    new THREE.MeshStandardMaterial({ color: 0x7d7f86, roughness: 1, flatShading: true })
  );
  rock.position.set(x, terrain.getHeightAt(x, z) + s * 0.4, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

export function makeBush(x, z, terrain) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 3; i++) {
    const blob = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.3, 0), mat);
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
