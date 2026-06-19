import * as THREE from 'three';

// Shared 3-band gradient used by all toon (cel-shaded) materials so the whole
// cast has a consistent, hand-drawn Zelda look.
let _gradient = null;
export function toonGradient() {
  if (_gradient) return _gradient;
  const data = new Uint8Array([60, 128, 210, 255]); // 4 shading bands
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

// Convert a standard/lambert material to a cel-shaded toon material, preserving
// colour, emissive, and transparency.
function toToon(mat) {
  const m = new THREE.MeshToonMaterial({
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    gradientMap: toonGradient(),
    transparent: !!mat.transparent,
    opacity: mat.opacity != null ? mat.opacity : 1,
  });
  if (mat.emissive) {
    m.emissive.copy(mat.emissive);
    m.emissiveIntensity = mat.emissiveIntensity != null ? mat.emissiveIntensity : 1;
  }
  return m;
}

// Cel-shade every mesh in a character group and give it a crisp dark silhouette
// via the classic inverted-hull outline (a slightly larger back-faced clone).
export function stylizeCharacter(group, { outline = true, outlineColor = 0x0a160f, thickness = 0.06 } = {}) {
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });

  for (const mesh of meshes) {
    mesh.material = toToon(mesh.material);
    mesh.castShadow = true;

    if (outline) {
      const outlineMesh = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide })
      );
      outlineMesh.scale.setScalar(1 + thickness);
      outlineMesh.castShadow = false;
      outlineMesh.receiveShadow = false;
      outlineMesh.renderOrder = -1;
      mesh.add(outlineMesh);
    }
  }
}
