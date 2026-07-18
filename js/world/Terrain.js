// The overworld heightfield: an analytic, deterministic height function plus
// the rendered terrain mesh (vertex-colored, cel-shaded). Everything that
// stands on the ground — player, enemies, trees, grass, water shoreline —
// samples this one class.

import * as THREE from 'three';
import { fbm2, ridged2, warped2, noise2 } from '../util/noise.js';
import { clamp, clamp01, smoothstep, lerp } from '../util/math.js';
import { toonMaterial, PALETTE } from '../gfx/Toon.js';
import { WORLD, SITES, LAKE, BADLANDS, FOREST_BAND } from './layout.js';

const SITE_LIST = Object.values(SITES);

export class Terrain {
  constructor(scene) {
    this.size = WORLD.size;
    this.waterLevel = WORLD.waterLevel;
    this.mesh = this._buildMesh();
    scene.add(this.mesh);
    this.heightTexture = this._buildHeightTexture(256);
  }

  // -------------------------------------------------------------------------
  // Height function — pure math, fast enough to call thousands of times/frame.
  // -------------------------------------------------------------------------
  heightAt(x, z) {
    // Broad rolling base.
    let h = 8
      + fbm2(x * 0.0038, z * 0.0038, 4) * 11
      + fbm2(x * 0.016, z * 0.016, 3) * 2.6;

    // Hill clusters — squared so plains stay flat and hills feel deliberate.
    const hills = clamp01(fbm2(x * 0.006 + 40, z * 0.006 - 25, 3) * 0.5 + 0.5);
    h += hills * hills * 24;

    // Cinder Flats: stepped mesas in the southeast.
    const bd = 1 - smoothstep(BADLANDS.r * 0.55, BADLANDS.r, dist(x, z, BADLANDS));
    if (bd > 0) {
      const mesa = Math.floor((h + warped2(x * 0.012, z * 0.012, 3) * 8) / 7) * 7 + 4;
      h = lerp(h, mesa, bd * 0.85);
    }

    // Mirrowmere basin, carved below water level with a beach lip.
    const ld = dist(x, z, LAKE);
    const lake = 1 - smoothstep(LAKE.r * 0.45, LAKE.r, ld);
    if (lake > 0) h = lerp(h, -8.5 + fbm2(x * 0.02, z * 0.02, 2) * 1.5, lake);

    // Rim mountains sealing the valley.
    const d = Math.sqrt(x * x + z * z);
    const rim = smoothstep(WORLD.playRadius - 40, WORLD.playRadius + 190, d);
    if (rim > 0) {
      h += rim * (95 + ridged2(x * 0.008, z * 0.008, 4) * 90);
    }

    // Flatten authored build sites (village, shrine, camps...).
    for (const s of SITE_LIST) {
      const sd = dist(x, z, s);
      if (sd < s.r) h = lerp(s.h, h, smoothstep(s.r * 0.55, s.r, sd));
    }

    // Soften shorelines so beaches slope gently into the water.
    if (h > -2.5 && h < 2.5) h *= 0.55 + 0.45 * Math.abs(h) / 2.5;

    return h;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.6;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  slopeAt(x, z) {
    const e = 0.8;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(dx * dx + dz * dz); // rise over run
  }

  // -------------------------------------------------------------------------
  // Biomes — density fields for vegetation + palette hints.
  // id: meadow | forest | badland | beach | lakebed | peak
  // -------------------------------------------------------------------------
  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    const slope = this.slopeAt(x, z);
    const inBadland = 1 - smoothstep(BADLANDS.r * 0.55, BADLANDS.r, dist(x, z, BADLANDS));
    const inForestBand = z < FOREST_BAND.z && z > FOREST_BAND.z - FOREST_BAND.depth ? 1 : 0;
    const forestNoise = clamp01(fbm2(x * 0.005 + 90, z * 0.005 + 7, 3) * 0.5 + 0.5);
    let forest = clamp01(inForestBand * 0.85 + (forestNoise - 0.58) * 2.2);
    if (h < 1.5 || h > 46 || slope > 0.75 || inBadland > 0.3) forest = 0;
    for (const s of SITE_LIST) if (dist(x, z, s) < s.r * 0.9) forest = 0;

    let grass = clamp01(1 - slope * 1.6) * smoothstep(0.6, 2.0, h) * (1 - smoothstep(38, 50, h));
    grass *= 1 - inBadland * 0.85;

    let id = 'meadow';
    if (h < this.waterLevel - 1.2) id = 'lakebed';
    else if (h < 1.6) id = 'beach';
    else if (inBadland > 0.5) id = 'badland';
    else if (forest > 0.45) id = 'forest';
    else if (h > 48) id = 'peak';

    return { id, forest, grass, height: h, slope };
  }

  // -------------------------------------------------------------------------
  // Mesh
  // -------------------------------------------------------------------------
  _buildMesh() {
    const segs = 240;
    const geo = new THREE.PlaneGeometry(this.size, this.size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const cGrassLo = new THREE.Color(PALETTE.grassLow);
    const cGrassHi = new THREE.Color(PALETTE.grassHigh);
    const cDry = new THREE.Color(PALETTE.meadowDry);
    const cForest = new THREE.Color(PALETTE.forestFloor);
    const cDirt = new THREE.Color(PALETTE.dirt);
    const cSand = new THREE.Color(PALETTE.sand);
    const cRock = new THREE.Color(PALETTE.rock);
    const cRockD = new THREE.Color(PALETTE.rockDark);
    const cSnow = new THREE.Color(PALETTE.snow);
    const cBad = new THREE.Color(PALETTE.badland);
    const cBadD = new THREE.Color(PALETTE.badlandDark);
    const cBed = new THREE.Color(PALETTE.waterDeep).lerp(new THREE.Color(PALETTE.sand), 0.45);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);

      const slope = this.slopeAt(x, z);
      const b = this.biomeAt(x, z);
      // Base grass gradient with large-scale mottling so fields aren't flat green.
      const mottle = fbm2(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
      col.copy(cGrassLo).lerp(cGrassHi, clamp01(mottle * 1.2));
      col.lerp(cDry, clamp01(fbm2(x * 0.008 + 300, z * 0.008, 2) * 0.9));
      if (b.forest > 0.2) col.lerp(cForest, clamp01(b.forest));
      if (b.id === 'badland') {
        col.copy(cBad).lerp(cBadD, clamp01((noise2(x * 0.05, z * 0.05) * 0.5 + 0.5) * 0.8 + (Math.floor(h / 7) % 2) * 0.25));
      }
      // Beaches and lakebed.
      col.lerp(cSand, 1 - smoothstep(0.6, 2.2, h));
      if (h < this.waterLevel - 0.5) col.lerp(cBed, smoothstep(-0.5, -5, h));
      // Rock on slopes, snow on peaks.
      col.lerp(cRock, smoothstep(0.55, 0.95, slope));
      col.lerp(cRockD, smoothstep(1.0, 1.6, slope) * 0.7);
      if (h > 60) col.lerp(cSnow, smoothstep(60, 95, h + fbm2(x * 0.05, z * 0.05, 2) * 8));
      // Bare dirt paths around the village entrance and sites.
      for (const s of SITE_LIST) {
        const sd = dist(x, z, s);
        if (sd < s.r * 0.5) col.lerp(cDirt, 0.25 * (1 - sd / (s.r * 0.5)));
      }
      // Subtle per-vertex dither hides banding.
      const dith = (noise2(x * 0.7, z * 0.7)) * 0.03;
      colors[i * 3] = clamp01(col.r + dith);
      colors[i * 3 + 1] = clamp01(col.g + dith);
      colors[i * 3 + 2] = clamp01(col.b + dith);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = toonMaterial({ vertexColors: true, color: 0xffffff, steps: 5, cache: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  // R16F-style height texture (RGBA8 packed as normalized height) for shaders
  // (water shoreline foam, grass tinting). Maps world ±size/2 → uv 0..1.
  _buildHeightTexture(res) {
    const data = new Uint8Array(res * res * 4);
    const hMin = -12, hMax = 120;
    for (let iy = 0; iy < res; iy++) {
      for (let ix = 0; ix < res; ix++) {
        const x = (ix / (res - 1) - 0.5) * this.size;
        const z = (iy / (res - 1) - 0.5) * this.size;
        const h = this.heightAt(x, z);
        const n = Math.round(clamp01((h - hMin) / (hMax - hMin)) * 255);
        const o = (iy * res + ix) * 4;
        data[o] = n; data[o + 1] = n; data[o + 2] = n; data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    // Shader helper values: height = texel * heightSpan + heightMin.
    tex.userData = { heightMin: hMin, heightSpan: hMax - hMin, worldSize: this.size };
    return tex;
  }
}

function dist(x, z, p) { const dx = x - p.x, dz = z - p.z; return Math.sqrt(dx * dx + dz * dz); }
