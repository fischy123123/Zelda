// The Hollow Shrine — the game's dungeon. An overworld facade (a weathered
// doorway carved into a rock face) teleports the player into an interior hall
// system built far outside the overworld at DUNGEON_ORIGIN: entry hall →
// brazier puzzle → skitter corridor → key chest → locked boss door → the
// Bonewrought Colossus → Sunblade treasure + return portal.
//
// The Dungeon is its own ground provider (stepped stone floors), owns all
// interior lights (≤6 flickering PointLights), doors, puzzle logic and the
// boss fight lifecycle.

import * as THREE from 'three';
import { toonMaterial, PALETTE, addOutline } from '../gfx/Toon.js';
import { RNG } from '../util/rng.js';
import { clamp01, lerp, ease, angleDelta, TAU } from '../util/math.js';
import { SITES, WORLD, DUNGEON_ORIGIN } from './layout.js';
import { Chest } from '../entities/Chest.js';
import { PICKUP_DEFS } from '../entities/Pickup.js';
import { createEnemy } from '../entities/Enemy.js';
import { Boss } from '../entities/Boss.js';

const OX = DUNGEON_ORIGIN.x, OZ = DUNGEON_ORIGIN.z;
const ARENA_Z = -128, ARENA_R = 21;
const _v = new THREE.Vector3();

// Interior floor heights by local z — broad stepped levels, each deeper room
// a little higher, climbing toward the arena like a processional way.
function floorY(lz) {
  if (lz >= -34) return 0;
  if (lz >= -38) return lerp(0, 1.2, (-34 - lz) / 4);
  if (lz >= -62) return 1.2;
  if (lz >= -66) return lerp(1.2, 2.4, (-62 - lz) / 4);
  if (lz >= -102) return 2.4;
  if (lz >= -106) return lerp(2.4, 3.6, (-102 - lz) / 4);
  if (lz >= -147) return 3.6;
  if (lz >= -151) return lerp(3.6, 4.4, (-147 - lz) / 4);
  return 4.4;
}

export class Dungeon {
  constructor(game) {
    this.game = game;
    this.waterLevel = -999;
    this.rng = new RNG(WORLD.seed).fork('dungeon');

    this._inside = false;
    this._bossFight = false;
    this._bossInArray = false;
    this._victory = false;
    this._victoryTimer = 0;
    this._puzzleTimer = 0;
    this._strikeTimer = 0;
    this._emberTimer = 0;
    this._time = 0;
    this._skitters = [null, null, null];
    this._biome = { id: 'stone', grass: 0, forest: 0, slope: 0, height: 0 };

    // Shared interior materials.
    this.mStone = toonMaterial({ color: PALETTE.stone });
    this.mStoneDark = toonMaterial({ color: PALETTE.stoneDark });
    this.mStoneDeep = toonMaterial({ color: 0x4a463e });
    this.mMoss = toonMaterial({ color: 0x5d7a4a });
    this.mGold = toonMaterial({ color: PALETTE.gold, emissive: 0x3a2a08, emissiveIntensity: 0.6 });

    this._flames = [];        // {group, phase, world:Vector3, lit:()=>bool}
    this._lights = [];        // {light, base}
    this._doors = {};
    this._braziers = [];
    this._godRays = [];

    // Interior root: offset to DUNGEON_ORIGIN, hidden until entered.
    this.inner = new THREE.Group();
    this.inner.position.set(OX, 0, OZ);
    this.inner.visible = false;
    game.scene.add(this.inner);

    this._buildFacade();
    this._buildInterior();
    this._buildBoss();
    this._buildPortal();
    this._wireEvents();
    this._syncFromFlags();
  }

  // -------------------------------------------------------------------------
  // Ground-provider API (terrain-like) for the interior.
  // -------------------------------------------------------------------------
  heightAt(x, z) { return floorY(z - OZ); }
  normalAt(x, z, out = new THREE.Vector3()) { return out.set(0, 1, 0); }
  slopeAt(x, z) { return 0; }
  biomeAt(x, z) {
    const b = this._biome;
    b.height = this.heightAt(x, z);
    return b;
  }

  // -------------------------------------------------------------------------
  // Overworld facade at SITES.shrine — doorway set into a rock mound.
  // -------------------------------------------------------------------------
  _buildFacade() {
    const g = this.game;
    const sx = SITES.shrine.x, base = SITES.shrine.h, dz = SITES.shrine.z - 10;
    const grp = new THREE.Group();
    this.facade = grp;

    // The rock face: a mound of huge weathered boulders swallowing the door.
    const rocks = [
      { ox: 0, oz: -9, r: 9 }, { ox: -9, oz: -6.5, r: 6.5 }, { ox: 9, oz: -7, r: 7 },
      { ox: -16, oz: -11, r: 5.5 }, { ox: 16, oz: -12, r: 6 }, { ox: 0, oz: -6, r: 4.6 },
    ];
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r, 0),
        i % 2 ? this.mStone : toonMaterial({ color: PALETTE.cliff }));
      rock.position.set(sx + r.ox, base + r.r * 0.35, dz + r.oz);
      rock.scale.set(1, 0.72, 0.9);
      rock.rotation.y = this.rng.angle();
      rock.castShadow = true;
      grp.add(rock);
      g.colliders.add({ x: sx + r.ox, z: dz + r.oz, r: r.r * 0.78 });
    }
    // Moss creeping over the stones.
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(this.rng.range(1.2, 2.4), 7, 5), this.mMoss);
      m.position.set(sx + this.rng.range(-12, 12), base + this.rng.range(2.5, 7), dz + this.rng.range(-8, -2));
      m.scale.y = 0.4;
      grp.add(m);
    }

    // Carved pillars + lintel framing the doorway.
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.85, 6.6, 9), this.mStone);
      pil.position.set(sx + s * 3.1, base + 3.3, dz);
      pil.castShadow = true;
      grp.add(pil);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.14, 6, 12), this.mStoneDark);
      ring.position.set(sx + s * 3.1, base + 4.9, dz);
      ring.rotation.x = Math.PI / 2;
      grp.add(ring);
      g.colliders.add({ x: sx + s * 3.1, z: dz, r: 1.0 });
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(9, 1.5, 2.1), this.mStoneDark);
    lintel.position.set(sx, base + 7.2, dz);
    lintel.castShadow = true;
    grp.add(lintel);

    // The black doorway itself, and the shrine's amber sigil above it.
    const recess = new THREE.Mesh(new THREE.BoxGeometry(4.7, 6.4, 1.2),
      toonMaterial({ color: 0x14111c }));
    recess.position.set(sx, base + 3.2, dz - 0.7);
    grp.add(recess);
    g.colliders.add({ x: sx, z: dz - 1.6, r: 2.4 });

    this._sigilColor = new THREE.Color(0xffb347);
    this._sigilMat = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false });
    const sigil = new THREE.Mesh(new THREE.CircleGeometry(0.65, 16), this._sigilMat);
    sigil.position.set(sx, base + 7.25, dz + 1.08);
    const sigilRing = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 6, 20), this._sigilMat);
    sigilRing.position.copy(sigil.position);
    sigil.userData.noOutline = sigilRing.userData.noOutline = true;
    grp.add(sigil, sigilRing);

    // Broad stone steps up to the threshold (shallow — purely sculptural).
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.22, 2.6), this.mStone);
    step1.position.set(sx, base + 0.11, dz + 3.1);
    const step2 = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.4, 1.7), this.mStoneDark);
    step2.position.set(sx, base + 0.2, dz + 1.7);
    grp.add(step1, step2);

    // Flanking brazier posts with small guttering flames — always burning.
    this._facadeFlames = [];
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.6, 7), this.mStoneDark);
      post.position.set(sx + s * 5.6, base + 0.8, dz + 2.4);
      grp.add(post);
      const fl = this._makeFlame(0.55);
      fl.position.set(sx + s * 5.6, base + 1.75, dz + 2.4);
      grp.add(fl);
      this._facadeFlames.push({ group: fl, phase: s * 2.1 });
      g.colliders.add({ x: sx + s * 5.6, z: dz + 2.4, r: 0.5 });
    }

    addOutline(grp, 0.014);
    g.scene.add(grp);

    g.interact.register({
      position: new THREE.Vector3(sx, base + 1.4, dz + 1.6),
      radius: 3.2,
      prompt: 'Enter',
      enabled: () => !this.game.inDungeon,
      onInteract: () => this.enter(),
    });
  }

  /** Small two-cone stylized flame; caller positions the group. */
  _makeFlame(s) {
    const grp = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.32 * s * 2, 0.9 * s * 2, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.92, toneMapped: false }));
    outer.position.y = 0.35 * s * 2;
    const inn = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s * 2, 0.5 * s * 2, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, toneMapped: false }));
    inn.position.y = 0.28 * s * 2;
    outer.userData.noOutline = inn.userData.noOutline = true;
    grp.add(outer, inn);
    return grp;
  }

  // -------------------------------------------------------------------------
  // Interior construction (local coords, parented to this.inner at ORIGIN).
  // -------------------------------------------------------------------------
  _buildInterior() {
    const g = this.game;
    const inner = this.inner;
    const low = g.quality === 'low';

    // Dim underground fill light (only active while the interior is visible).
    inner.add(new THREE.HemisphereLight(0x4a4360, 0x241c14, 0.55));
    inner.add(new THREE.AmbientLight(0x2a2433, 0.4));

    // --- floors -------------------------------------------------------------
    const bedrock = new THREE.Mesh(new THREE.BoxGeometry(76, 1.2, 210), this.mStoneDeep);
    bedrock.position.set(0, -0.85, -75);
    inner.add(bedrock);
    const floors = [
      [22, 50, 0, -9, 0], [30, 26, 0, -50, 1.2], [14, 40, 0, -82, 2.4],
      [7, 7, 6.5, -87, 2.4], [12, 12, 0, -153.5, 4.4],
    ];
    for (const [w, d, x, z, y] of floors) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), this.mStone);
      f.position.set(x, y - 0.4, z);
      f.receiveShadow = true;
      inner.add(f);
    }
    const arenaFloor = new THREE.Mesh(new THREE.CylinderGeometry(23.5, 23.5, 0.8, 30), this.mStone);
    arenaFloor.position.set(0, 3.2, ARENA_Z);
    inner.add(arenaFloor);
    // Worn ramps between levels (slope matches floorY() exactly).
    const ramps = [[6.4, -36, 0.6, 1.2], [7.5, -64, 1.8, 1.2], [9.5, -104, 3.0, 1.2], [6.2, -149, 4.0, 0.8]];
    for (const [w, z, y, rise] of ramps) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 4.7), this.mStoneDark);
      r.position.set(0, y - 0.1, z);
      r.rotation.x = Math.atan2(rise, 4);
      inner.add(r);
    }

    // --- walls ---------------------------------------------------------------
    const walls = [
      [-11, 14, -11, -32], [11, 14, 11, -32], [-11, 14, 11, 14],
      [-11, -32, -3, -32], [3, -32, 11, -32],
      [-3, -32, -3, -38], [3, -32, 3, -38],
      [-14, -38, -3, -38], [3, -38, 14, -38],
      [-14, -38, -14, -62], [14, -38, 14, -62],
      [-14, -62, -2.5, -62], [2.5, -62, 14, -62],
      [-4, -62, -4, -102],
      [4, -62, 4, -84], [4, -84, 9, -84], [9, -84, 9, -90], [9, -90, 4, -90], [4, -90, 4, -102],
      [-4, -102, -6.5, -108], [4, -102, 6.5, -108],
      [-5, -149, -5, -158], [5, -149, 5, -158], [-5, -158, 5, -158],
      [-8, -149, -2.75, -149], [2.75, -149, 8, -149],
    ];
    for (const w of walls) this._wall(w[0], w[1], w[2], w[3]);

    // Arena ring wall: tangent slabs, with gaps at the entrance and alcove.
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      if (Math.abs(angleDelta(a, 0)) < 0.3) continue;              // south entrance
      if (Math.abs(angleDelta(a, Math.PI)) < 0.26) continue;       // treasure alcove
      const x = Math.sin(a) * 22.5, z = ARENA_Z + Math.cos(a) * 22.5;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12.5, 4.3),
        i % 3 ? this.mStone : this.mStoneDark);
      seg.position.set(x, 3.6 + 5.5, z);
      seg.rotation.y = a + Math.PI / 2;
      inner.add(seg);
      g.colliders.add({ x: OX + x, z: OZ + z, r: 2.3 });
    }

    // --- ceiling + faked god-ray shafts from "cracks" -----------------------
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(70, 1.2, 205), this.mStoneDeep);
    ceil.position.set(0, 12.2, -75);
    inner.add(ceil);
    if (!low) {
      const rays = [[0, -6, 0], [-5, -50, 1.2], [6, -46, 1.2], [-7, -124, 3.6], [7, -132, 3.6]];
      for (const [x, z, fy] of rays) {
        // One material per shaft so each can shimmer independently.
        const rayMat = new THREE.MeshBasicMaterial({
          color: 0xffd9a0, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        });
        const h = 11.6 - fy;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(3.1, h, 10, 1, true), rayMat);
        cone.position.set(x, fy + h / 2, z);
        cone.userData.noOutline = true;
        this._godRays.push(cone);
        inner.add(cone);
      }
    }

    // --- entry hall dressing: carved pillars + fallen columns ---------------
    for (const [px, pz] of [[-6.5, -6], [6.5, -6], [-6.5, -22], [6.5, -22]]) {
      inner.add(this._pillar(px, pz, 0));
      g.colliders.add({ x: OX + px, z: OZ + pz, r: 1.05 });
    }
    const fallen = [[2.5, -19, 0.5], [-3.8, -12, -0.9]];
    for (const [fx, fz, ry] of fallen) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.75, 6.4, 9), this.mStone);
      col.position.set(fx, 0.72, fz);
      col.rotation.set(0, ry, Math.PI / 2 - 0.06);
      inner.add(col);
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.85, 1.1, 9), this.mStoneDark);
      stump.position.set(fx + Math.sin(ry) * 3.6, 0.55, fz + Math.cos(ry) * 3.6);
      inner.add(stump);
      g.colliders.add({ x: OX + fx, z: OZ + fz, r: 1.5 });
    }
    for (const [px, pz] of [[-11, -41], [11, -41], [-11, -59], [11, -59]]) {
      inner.add(this._pillar(px, pz, 1.2));
      g.colliders.add({ x: OX + px, z: OZ + pz, r: 1.05 });
    }

    // Bone piles ringing the arena — remains of those who came before.
    for (let i = 0; i < (low ? 4 : 7); i++) {
      const a = this.rng.angle();
      const r = this.rng.range(14, 19);
      const bx = Math.sin(a) * r, bz = ARENA_Z + Math.cos(a) * r;
      const pile = new THREE.Group();
      const boneMat = toonMaterial({ color: 0xcfc6ab });
      for (let j = 0; j < 3; j++) {
        const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, this.rng.range(0.5, 1.1), 3, 5), boneMat);
        b.position.set(bx + this.rng.gauss() * 0.7, 3.72, bz + this.rng.gauss() * 0.7);
        b.rotation.set(Math.PI / 2, 0, this.rng.angle());
        pile.add(b);
      }
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 6), boneMat);
      skull.position.set(bx, 3.85, bz + 0.4);
      pile.add(skull);
      inner.add(pile);
    }

    // Moss patches — life creeping back into the holy dark.
    for (let i = 0; i < (low ? 8 : 16); i++) {
      const spots = [[0, -9, 10], [0, -50, 13], [0, -82, 3.5], [0, ARENA_Z, 18]];
      const s = spots[this.rng.int(0, spots.length - 1)];
      const mx = s[0] + this.rng.gauss() * s[2], mz = s[1] + this.rng.gauss() * s[2] * 0.8;
      const patch = new THREE.Mesh(new THREE.CircleGeometry(this.rng.range(0.7, 1.9), 9), this.mMoss);
      patch.position.set(mx, floorY(mz) + 0.03, mz);
      patch.rotation.x = -Math.PI / 2;
      patch.userData.noOutline = true;
      inner.add(patch);
    }

    // --- torches + light budget (≤6 PointLights, fewer on low) --------------
    const torches = [
      [-10.2, -4], [10.2, -4], [-10.2, -24], [10.2, -24],
      [-13.2, -44], [13.2, -44], [-13.2, -56], [13.2, -56],
      [-3.3, -70], [3.3, -78], [-3.3, -88], [3.3, -96],
      [-4.2, -152], [4.2, -152],
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5;
      torches.push([Math.sin(a) * 20, ARENA_Z + Math.cos(a) * 20]);
    }
    for (let i = 0; i < torches.length; i++) {
      if (low && i % 2 === 1) continue;
      this._torch(torches[i][0], torches[i][1]);
    }
    const lights = low
      ? [[0, -10, 5, 1.6], [0, -50, 5.5, 1.5], [0, ARENA_Z + 4, 7, 2.2], [0, -153, 6.5, 1.4]]
      : [[0, -10, 5, 1.6], [0, -50, 5.5, 1.5], [0, -84, 5, 1.3],
         [-10, -122, 7, 1.9], [10, -134, 7, 1.9], [0, -153, 6.5, 1.4]];
    for (const [lx, lz, ly, base] of lights) {
      // r160 physical light units: point lights need candela-scale intensity.
      const scaled = base * 30;
      const pt = new THREE.PointLight(0xffa54e, scaled, 34, 1.4);
      pt.position.set(lx, ly, lz);
      inner.add(pt);
      this._lights.push({ light: pt, base: scaled, phase: this.rng.range(0, TAU) });
    }
    this._brazierLight = this._lights[1];

    // --- doors, braziers, chests --------------------------------------------
    this._makeDoor('brazier', 0, -62, 5.4, 7.5, 1.2, [[-1.3, 1.5], [1.3, 1.5]]);
    this._makeDoor('boss', 0, -102, 8.4, 8.8, 2.4, [[-2.7, 1.6], [0, 1.6], [2.7, 1.6]]);
    this._makeDoor('alcove', 0, -149, 5.8, 7.2, 3.6, [[-1.4, 1.6], [1.4, 1.6]]);
    this._doorList = [this._doors.brazier, this._doors.boss, this._doors.alcove];
    this._decorateDoors();
    this._makeBraziers();

    // Shrine Key chest, tucked in the corridor alcove.
    this.keyChest = new Chest(g, 'shrine-key',
      new THREE.Vector3(OX + 6.8, 2.4, OZ - 87), -Math.PI / 2, { key: true });
    // The Sunblade chest, sealed behind the arena until the Colossus falls.
    this.bigChest = new Chest(g, 'shrine-sunblade',
      new THREE.Vector3(OX, 4.4, OZ - 154.5), 0, {
        gems: 45,
        onOpen: (game) => {
          game.state.sword = 'sunblade';
          game.hero?.setSword?.('sunblade');
          game.state.flags.shrineCleared = true;
          game.events.emit('toast', { text: 'The Sunblade! Dawn burns along its edge.' });
        },
      }, { big: true });

    // Way out, back at the entrance.
    g.interact.register({
      position: new THREE.Vector3(OX, 1, OZ + 12),
      radius: 3,
      prompt: 'Leave',
      enabled: () => this.game.inDungeon && !this._bossFight,
      onInteract: () => this.exit(false),
    });
    // The boss door demands the Shrine Key.
    g.interact.register({
      position: new THREE.Vector3(OX, 3.6, OZ - 101),
      radius: 3.2,
      prompt: () => (this.game.state.keys >= 1 ? 'Unlock' : 'Locked'),
      enabled: () => this.game.inDungeon && !this._doors.boss.open && this._doors.boss.target === 0,
      onInteract: () => this._tryUnlockBossDoor(),
    });
  }

  _pillar(x, z, fy) {
    const grp = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 11, 9), this.mStone);
    shaft.position.set(x, fy + 5.5, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 2.1), this.mStoneDark);
    base.position.set(x, fy + 0.35, z);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 2.0), this.mStoneDark);
    cap.position.set(x, fy + 11.1, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.1, 5, 10), this.mStoneDark);
    ring.position.set(x, fy + 2.2, z);
    ring.rotation.x = Math.PI / 2;
    grp.add(shaft, base, cap, ring);
    return grp;
  }

  /** Wall segment (local coords): visible slab + a row of collider circles. */
  _wall(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const fy = Math.min(floorY(z1), floorY(z2));
    const h = 12.4 - fy;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, len + 1.2), this.mStone);
    mesh.position.set(mx, fy + h / 2, mz);
    mesh.rotation.y = Math.atan2(dx, dz);
    this.inner.add(mesh);
    const n = Math.max(1, Math.ceil(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.game.colliders.add({ x: OX + x1 + dx * t, z: OZ + z1 + dz * t, r: 1.1 });
    }
  }

  /** Sliding stone door across a wall gap; colliders removed as it rises. */
  _makeDoor(name, x, z, w, h, fy, colDefs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.1), this.mStoneDark);
    const baseY = fy + h / 2 - 0.35;
    mesh.position.set(x, baseY, z);
    this.inner.add(mesh);
    const cols = colDefs.map(([cx, cr]) => ({ x: OX + x + cx, z: OZ + z, r: cr }));
    for (const c of cols) this.game.colliders.add(c);
    // Lintel sealing the gap between door top and ceiling.
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 5, 1.3), this.mStoneDark);
    lintel.position.set(x, fy + h + 1.8, z);
    this.inner.add(lintel);
    this._doors[name] = {
      name, mesh, baseY, rise: h - 0.7, t: 0, target: 0, open: false,
      cols, colsIn: true, x, z, fy,
    };
  }

  _decorateDoors() {
    // Brazier door: three sigil roundels that kindle as braziers are lit.
    const bd = this._doors.brazier;
    bd.sigilMats = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x3a3630, toneMapped: false });
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), m);
      c.position.set((i - 1) * 1.4, 1.6, 0.58);
      c.userData.noOutline = true;
      bd.mesh.add(c);
      bd.sigilMats.push(m);
    }
    // Boss door: gold bands and a great horned emblem.
    const dd = this._doors.boss;
    for (const y of [-2.6, 0, 2.6]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.5, 1.2), this.mGold);
      band.position.set(0, y, 0);
      dd.mesh.add(band);
    }
    const emblem = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 6, 16), this.mGold);
    emblem.position.set(0, 1.3, 0.6);
    dd.mesh.add(emblem);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.2, 5), this.mGold);
      horn.position.set(s * 1.15, 2.35, 0.6);
      horn.rotation.z = -s * 0.5;
      dd.mesh.add(horn);
    }
  }

  _makeBraziers() {
    const spots = [[-9, -48], [9, -48], [0, -57]];
    for (const [bx, bz] of spots) {
      const grp = new THREE.Group();
      const fy = 1.2;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.66, 1.15, 8), this.mStoneDark);
      ped.position.set(bx, fy + 0.57, bz);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.5, 0.55, 9), this.mStone);
      bowl.position.set(bx, fy + 1.35, bz);
      const coals = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), this.mStoneDeep);
      coals.position.set(bx, fy + 1.55, bz);
      coals.scale.y = 0.45;
      grp.add(ped, bowl, coals);
      const flame = this._makeFlame(0.85);
      flame.position.set(bx, fy + 1.6, bz);
      flame.visible = false;
      grp.add(flame);
      this.inner.add(grp);
      this.game.colliders.add({ x: OX + bx, z: OZ + bz, r: 0.95 });
      const brazier = {
        lit: false, flame,
        world: new THREE.Vector3(OX + bx, fy + 1.4, OZ + bz),
      };
      this._braziers.push(brazier);
      this._flames.push({ group: flame, phase: this.rng.range(0, TAU), world: brazier.world });
    }
  }

  _torch(x, z) {
    const fy = floorY(z);
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.1, 6),
      toonMaterial({ color: PALETTE.woodDark }));
    pole.position.set(x, fy + 2.6, z);
    // Lean torches toward the room center so they read as wall-mounted.
    pole.rotation.z = x > 2 ? 0.22 : x < -2 ? -0.22 : 0;
    grp.add(pole);
    const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), this.mStoneDark);
    sconce.position.set(x, fy + 2.15, z);
    grp.add(sconce);
    const flame = this._makeFlame(0.5);
    flame.position.set(x - (pole.rotation.z * 0.6), fy + 3.2, z);
    grp.add(flame);
    this.inner.add(grp);
    this._flames.push({
      group: flame, phase: this.rng.range(0, TAU),
      world: new THREE.Vector3(OX + x, fy + 3.3, OZ + z),
    });
  }

  // -------------------------------------------------------------------------
  // Boss + treasure
  // -------------------------------------------------------------------------
  _buildBoss() {
    this.boss = new Boss(this.game, { x: OX, z: OZ + ARENA_Z }, {
      ground: this,
      arena: { x: OX, z: OZ + ARENA_Z, r: ARENA_R - 2 },
    });
    // World-space coords, so parent to the scene (culled with distance).
    this.game.scene.add(this.boss.group);
  }

  _buildPortal() {
    const g = this.game;
    const grp = new THREE.Group();
    grp.position.set(OX - 8, floorY(-140), OZ - 140);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 8, 24), ringMat);
    ring.position.y = 2.1;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffc978, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
    disc.position.y = 2.1;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.5, 9), this.mStoneDark);
    plinth.position.y = 0.25;
    ring.userData.noOutline = disc.userData.noOutline = true;
    grp.add(ring, disc, plinth);
    grp.visible = false;
    g.scene.add(grp);
    this.portal = grp;
    this._portalDisc = disc;

    g.interact.register({
      position: new THREE.Vector3(OX - 8, floorY(-140) + 1.5, OZ - 140),
      radius: 2.8,
      prompt: 'Return',
      enabled: () => this._victory && this.game.inDungeon,
      onInteract: () => this.exit(false),
    });
  }

  // -------------------------------------------------------------------------
  // Events / persistence
  // -------------------------------------------------------------------------
  _wireEvents() {
    const g = this.game;
    // Sword strikes light braziers: sample proximity at mid-swing.
    g.events.on('player:attack', () => {
      if (g.inDungeon && !this._doors.brazier.open) this._strikeTimer = 0.16;
    });
    g.events.on('boss:end', ({ victory }) => {
      if (victory && !this._victory) this._victoryTimer = 3.5; // let the crumble land
    });
    g.events.on('game:start', () => {
      // New game / load: Game has already reset inDungeon + ground provider.
      this._setInside(false);
      this._bossFight = false;
      this._victoryTimer = 0;
      this._bossInArray = g.enemies.indexOf(this.boss) !== -1;
      this._syncFromFlags();
      // Chests were built once; re-sync their lids with the (possibly fresh) flags.
      for (const c of [this.keyChest, this.bigChest]) {
        c.opened = !!g.state.flags[`chest:${c.id}`];
        c.openT = c.opened ? 1 : 0;
        c._animT = c.opened ? 1 : 0;
        c.lid.rotation.x = c.opened ? -1.9 : 0;
      }
      // Safety net: a save written mid-dungeon restores an overworld player at
      // interior coordinates — hand them back to the shrine threshold instead.
      const p = g.player;
      if (!g.inDungeon && Math.hypot(p.position.x - OX, p.position.z - OZ) < 400) {
        const sx = SITES.shrine.x, sz = SITES.shrine.z - 4;
        p.position.set(sx, g.terrain.heightAt(sx, sz), sz);
        p.velocity.set(0, 0, 0);
        p.yaw = 0;
        g.cameraRig.snapBehind(p, Math.PI);
      }
    });
  }

  _syncFromFlags() {
    const f = this.game.state.flags;
    const cleared = !!(f['shrine:boss'] || f.shrineCleared);
    this._victory = cleared;
    this._setDoor(this._doors.brazier, !!f['shrine:braziers'] || cleared, true);
    this._setDoor(this._doors.boss, !!f['shrine:bossdoor'] || cleared, true);
    this._setDoor(this._doors.alcove, cleared, true);
    const litAll = !!f['shrine:braziers'] || cleared;
    for (let i = 0; i < this._braziers.length; i++) this._setBrazierLit(i, litAll);
    if (cleared) this.boss.retire();
    else if (!this._bossFight) this.boss.reset();
    this.portal.visible = cleared;
  }

  _setBrazierLit(i, lit) {
    const b = this._braziers[i];
    b.lit = lit;
    b.flame.visible = lit;
    this._doors.brazier.sigilMats[i].color.setHex(lit ? 0xffb347 : 0x3a3630);
  }

  _setDoor(door, open, instant = false) {
    door.target = open ? 1 : 0;
    if (instant) {
      door.t = door.target;
      this._applyDoor(door);
    }
  }

  _applyDoor(door) {
    const k = ease.inOutQuad(clamp01(door.t));
    door.mesh.position.y = door.baseY + door.rise * k;
    door.open = door.target === 1 && door.t >= 1;
    const shouldBlock = door.t < 0.55;
    if (shouldBlock && !door.colsIn) {
      for (const c of door.cols) this.game.colliders.add(c);
      door.colsIn = true;
    } else if (!shouldBlock && door.colsIn) {
      for (const c of door.cols) this.game.colliders.remove(c);
      door.colsIn = false;
    }
  }

  // -------------------------------------------------------------------------
  // Enter / exit
  // -------------------------------------------------------------------------
  enter() {
    const g = this.game;
    if (g.inDungeon) return;
    g.audio?.sfx?.('door');
    const go = () => {
      this._setInside(true);
      g.setGroundProvider(this);
      g.inDungeon = true;
      g.sky?.setUnderground?.(true);
      const p = g.player;
      // Arrive just inside the hall, in the first pool of torchlight.
      p.position.set(OX, this.heightAt(OX, OZ - 5), OZ - 5);
      p.velocity.set(0, 0, 0);
      p.yaw = Math.PI;             // face north, into the dark
      p.attack = p.roll = null;
      g.cameraRig.snapBehind(p, 0);
      this._spawnSkitters();
      g.events.emit('dungeon:enter', {});
    };
    if (g.ui?.fadeTo) g.ui.fadeTo(go); else go();
  }

  /**
   * Leave the shrine. silent=true (death-respawn): no fade, no player
   * placement — Game.respawnPlayer moves the hero itself; just unwind state.
   */
  exit(silent = false) {
    const g = this.game;
    if (!g.inDungeon && !this._inside) return;
    const go = () => {
      this._setInside(false);
      g.setGroundProvider(null);
      g.inDungeon = false;
      g.sky?.setUnderground?.(false);
      if (this._bossFight) {
        // Fight abandoned: the Colossus reassembles, bar comes down.
        this._bossFight = false;
        this.boss.reset();
        g.events.emit('boss:end', { victory: false });
        this._setDoor(this._doors.boss, true, true); // it was unlocked already
      }
      if (!silent) {
        const sx = SITES.shrine.x, sz = SITES.shrine.z - 4;
        const p = g.player;
        p.position.set(sx, g.terrain.heightAt(sx, sz), sz);
        p.velocity.set(0, 0, 0);
        p.yaw = 0;                 // facing away from the door
        g.cameraRig.snapBehind(p, Math.PI);
      }
      g.events.emit('dungeon:exit', {});
    };
    if (silent) { go(); return; }
    g.audio?.sfx?.('portal');
    if (g.ui?.fadeTo) g.ui.fadeTo(go); else go();
  }

  _setInside(on) {
    this._inside = on;
    this.inner.visible = on;
  }

  _spawnSkitters() {
    if (this._victory) return;
    const g = this.game;
    const slots = g.quality === 'low' ? [[0, -72], [2, -95]] : [[0, -72], [-2, -82], [2, -95]];
    for (let i = 0; i < slots.length; i++) {
      const cur = this._skitters[i];
      if (cur && cur.alive) continue;
      const [sx, sz] = slots[i];
      const wx = OX + sx, wz = OZ + sz;
      _v.set(wx, this.heightAt(wx, wz), wz);
      const e = createEnemy(g, 'skitter', _v.clone(), {
        ground: this,
        anchor: { x: wx, z: wz, r: 7 },
      });
      g.enemies.push(e);
      this._skitters[i] = e;
    }
  }

  _tryUnlockBossDoor() {
    const g = this.game;
    if (g.state.keys >= 1) {
      g.state.keys -= 1;
      g.events.emit('keys', { total: g.state.keys });
      g.state.flags['shrine:bossdoor'] = true;
      this._setDoor(this._doors.boss, true);
      g.audio?.sfx?.('door');
      g.cameraRig.shake(0.15);
      g.events.emit('toast', { text: 'The Shrine Key turns. Something colossal stirs beyond…' });
    } else {
      g.events.emit('toast', { text: 'Sealed fast. It hungers for a key.' });
    }
  }

  // -------------------------------------------------------------------------
  // Puzzle / boss flow
  // -------------------------------------------------------------------------
  _checkBrazierStrike() {
    const g = this.game;
    const p = g.player.position;
    let litCount = 0;
    for (let i = 0; i < this._braziers.length; i++) {
      const b = this._braziers[i];
      if (!b.lit) {
        const dx = b.world.x - p.x, dz = b.world.z - p.z;
        if (dx * dx + dz * dz < 3.1 * 3.1) {
          this._setBrazierLit(i, true);
          g.audio?.sfx?.('brazier');
          g.particles?.emit?.('ember', b.world);
          g.particles?.emit?.('sparkle', b.world);
          const n = this._braziers.reduce((s, br) => s + (br.lit ? 1 : 0), 0);
          if (n < 3) g.events.emit('toast', { text: `An ancient flame awakens. (${n}/3)` });
        }
      }
      if (b.lit) litCount++;
    }
    if (litCount === 3 && !g.state.flags['shrine:braziers']) {
      g.state.flags['shrine:braziers'] = true;
      this._puzzleTimer = 0.7; // beat of silence, then the door grinds open
    }
  }

  _updateBossTrigger() {
    const g = this.game;
    if (this._bossFight || this._victory || !this.boss.alive) return;
    if (this.boss.state !== 'dormant') return;
    const p = g.player.position;
    const lx = p.x - OX, lz = p.z - OZ;
    const dz = lz - ARENA_Z;
    if (lx * lx + dz * dz < (ARENA_R - 2.5) * (ARENA_R - 2.5)) {
      this._bossFight = true;
      if (!this._bossInArray) {
        g.enemies.push(this.boss);
        this._bossInArray = true;
      }
      this.boss.activate();
      this._setDoor(this._doors.boss, false); // the way back grinds shut
      g.audio?.sfx?.('door');
      g.cameraRig.shake(0.25);
      g.events.emit('boss:start', { name: 'Bonewrought Colossus', maxHp: this.boss.maxHp });
    }
  }

  _openTreasure() {
    const g = this.game;
    this._victory = true;
    this._bossFight = false;
    g.state.flags['shrine:boss'] = true;
    this._setDoor(this._doors.alcove, true);
    this._setDoor(this._doors.boss, true);
    this.portal.visible = true;
    g.audio?.sfx?.('secret');
    g.cameraRig.shake(0.2);
    g.events.emit('toast', { text: 'The shrine’s heart lies open.' });
    // Heart container rises where the Colossus fell.
    _v.set(OX, floorY(ARENA_Z + 4) + 0.7, OZ + ARENA_Z + 4);
    g.pickups.push(new HeartContainer(g, _v));
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const t = (this._time += dt);

    // Facade sigil pulse + gate flames — cheap, always alive.
    const pulse = 0.72 + 0.28 * Math.sin(t * 2.3) + 0.08 * Math.sin(t * 7.1);
    this._sigilMat.color.copy(this._sigilColor).multiplyScalar(pulse);
    for (const f of this._facadeFlames) {
      const s = 1 + Math.sin(t * 11 + f.phase) * 0.16 + Math.sin(t * 23 + f.phase * 2) * 0.07;
      f.group.scale.set(s, 2 - s, s);
      f.group.rotation.y = t * 1.5 + f.phase;
    }

    // Door slabs keep animating even during the exit fade.
    for (let i = 0; i < this._doorList.length; i++) {
      const door = this._doorList[i];
      if (door.t !== door.target) {
        const dir = door.target > door.t ? 1 : -1;
        door.t = clamp01(door.t + dir * dt / (dir > 0 ? 2.0 : 1.1));
        this._applyDoor(door);
        if (this._inside) {
          if (Math.random() < dt * 8) {
            _v.set(OX + door.x + (Math.random() - 0.5) * 3, door.fy + 0.3, OZ + door.z);
            g.particles?.emit?.('dust', _v);
          }
          g.cameraRig.shake(dt * 0.35); // low grinding rumble
        }
      }
    }
    if (this._victoryTimer > 0) {
      this._victoryTimer -= dt;
      if (this._victoryTimer <= 0) this._openTreasure();
    }

    if (!g.inDungeon) return;

    // ---- interior-only logic, deliberately cheap ---------------------------
    // Torch flicker: flames dance, lights breathe.
    for (let i = 0; i < this._flames.length; i++) {
      const f = this._flames[i];
      if (!f.group.visible) continue;
      const s = 1 + Math.sin(t * 12 + f.phase) * 0.18 + Math.sin(t * 27 + f.phase * 1.7) * 0.08;
      f.group.scale.set(s, 2.05 - s, s);
      f.group.rotation.y = t * 2 + f.phase;
    }
    let litN = 0;
    for (let i = 0; i < this._braziers.length; i++) if (this._braziers[i].lit) litN++;
    for (let i = 0; i < this._lights.length; i++) {
      const L = this._lights[i];
      let base = L.base;
      if (L === this._brazierLight) base += litN * 0.45;
      L.light.intensity = base * (0.86 + 0.1 * Math.sin(t * 9 + L.phase) + 0.06 * Math.sin(t * 23 + L.phase * 2));
    }
    // God-ray shafts shimmer faintly.
    for (let i = 0; i < this._godRays.length; i++) {
      this._godRays[i].material.opacity = 0.045 + 0.018 * Math.sin(t * 0.8 + i * 1.7);
    }
    // Embers drift up from whichever flame is nearest the player.
    this._emberTimer -= dt;
    if (this._emberTimer <= 0) {
      this._emberTimer = 0.24 + Math.random() * 0.2;
      const p = g.player.position;
      const f = this._flames[(Math.random() * this._flames.length) | 0];
      if (f.group.visible) {
        const dx = f.world.x - p.x, dz = f.world.z - p.z;
        if (dx * dx + dz * dz < 900) g.particles?.emit?.('ember', f.world);
      }
    }

    // Brazier strikes (queued from 'player:attack', sampled mid-swing).
    if (this._strikeTimer > 0) {
      this._strikeTimer -= dt;
      if (this._strikeTimer <= 0) this._checkBrazierStrike();
    }
    if (this._puzzleTimer > 0) {
      this._puzzleTimer -= dt;
      if (this._puzzleTimer <= 0) {
        this._setDoor(this._doors.brazier, true);
        g.audio?.sfx?.('secret');
        g.events.emit('toast', { text: 'Deep in the stone, a door grinds open.' });
      }
    }

    this._updateBossTrigger();
    // Keep the dormant Colossus's core smouldering before the fight begins
    // (once pushed into game.enemies, the main loop drives it instead).
    if (!this._bossInArray && this.boss.alive) this.boss.update(dt, g);

    // Chest lids + portal shimmer.
    this.keyChest.update(dt);
    this.bigChest.update(dt);
    if (this._victory && this.portal.visible) {
      this.portal.rotation.y += dt * 0.8;
      this._portalDisc.material.opacity = 0.45 + 0.18 * Math.sin(t * 3.2);
      if (Math.random() < dt * 2.5) {
        _v.setFromMatrixPosition(this.portal.matrixWorld);
        _v.y += 2.1;
        g.particles?.emit?.('sparkle', _v);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Heart Container — the Colossus's reward. Duck-typed like a Pickup so the
// Game's pickups loop drives it.
// ---------------------------------------------------------------------------
class HeartContainer {
  constructor(game, pos) {
    this.game = game;
    this.alive = true;
    this._age = 0;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this._baseY = pos.y;

    const heartMat = toonMaterial({
      color: 0xff5a70, emissive: 0x7a1020, emissiveIntensity: 0.9, cache: false,
    });
    const heart = new THREE.Mesh(PICKUP_DEFS.heart.geo(), heartMat);
    heart.scale.setScalar(2.3);
    heart.position.y = 0.9;
    this._heart = heart;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.09, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0xe8b64c, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff8090, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
    halo.position.y = 0.9;
    heart.userData.noOutline = ring.userData.noOutline = halo.userData.noOutline = true;
    this.group.add(heart, ring, halo);
    game.scene.add(this.group);
  }

  update(dt) {
    if (!this.alive) return;
    this._age += dt;
    this._heart.rotation.y += dt * 1.6;
    this.group.position.y = this._baseY + Math.sin(this._age * 2.2) * 0.15;
    const g = this.game;
    const p = g.player.position;
    const dx = p.x - this.group.position.x;
    const dy = (p.y + 0.9) - this.group.position.y;
    const dz = p.z - this.group.position.z;
    if (dx * dx + dy * dy + dz * dz < 2.1 * 2.1 && g.player.alive) {
      this.alive = false;
      g.scene.remove(this.group);
      g.addMaxHeart();
      g.audio?.sfx?.('heart');
      g.events.emit('pickup', { type: 'heart_container', pos: this.group.position.clone() });
      g.events.emit('toast', { text: 'Heart Container! Your life force swells.' });
    }
  }
}
