// Brindlemere: a cozy hand-laid village — timbered houses, a stone well,
// market stall, lanterns that wake at dusk, chimney smoke, and six villagers.

import * as THREE from 'three';
import { toonMaterial, addOutline, PALETTE } from '../gfx/Toon.js';
import { clamp01, damp, lerp } from '../util/math.js';
import { SITES } from './layout.js';
import { NPC } from '../entities/NPC.js';

const V = SITES.village; // {x: 60, z: -20, r: 95}

export class Village {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this._windowMats = [];
    this._lanterns = [];
    this._chimneys = [];
    this._smokeT = 0;
    this._nightGlow = 0;

    this._build();
    game.scene.add(this.group);
    this._spawnNPCs();
  }

  // -------------------------------------------------------------------------
  _h(x, z) { return this.game.terrain.heightAt(x, z); }

  _build() {
    // Houses: [x, z, facing, width, depth, roofColor, chimney]
    const houses = [
      { x: 60, z: -66, yaw: 0, w: 7.5, d: 6, roof: 0x8a5a40, chimney: true, tall: true }, // Maren's hall
      { x: 22, z: -48, yaw: 0.9, w: 5, d: 4.4, roof: PALETTE.thatch, chimney: true },     // Nyla
      { x: 98, z: -46, yaw: -0.7, w: 5.4, d: 4.6, roof: 0x7a8a52, chimney: false },       // Rho
      { x: 26, z: 6, yaw: 2.3, w: 4.6, d: 4.2, roof: PALETTE.thatch, chimney: true },     // Pip's family
      { x: 95, z: 8, yaw: -2.2, w: 5.8, d: 4.8, roof: 0x6a6f7a, chimney: false },         // Bram's barracks
    ];
    for (const h of houses) this._house(h);

    this._well(58, -22);
    this._stall(76, -12);

    // Lantern posts around the square (4 point lights total).
    this._lantern(48, -32);
    this._lantern(72, -30);
    this._lantern(52, -6);
    this._lantern(84, -2);

    // Fences along the north path + near fields.
    this._fenceRun(34, -60, 46, -70, 4);
    this._fenceRun(74, -62, 88, -56, 4);
    this._fenceRun(104, -2, 112, 14, 4);

    // Crates and barrels near the stall.
    const crateMat = toonMaterial({ color: 0x9a7a4e });
    const barrelMat = toonMaterial({ color: 0x7a5a3a });
    const clutter = [
      [80, -8, 'crate'], [81.2, -9.4, 'crate'], [80.4, -8.6, 'crateTop'],
      [71, -16, 'barrel'], [72.4, -16.6, 'barrel'],
    ];
    for (const [x, z, kind] of clutter) {
      const y = this._h(x, z);
      let m;
      if (kind === 'barrel') {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10), barrelMat);
        m.position.set(x, y + 0.45, z);
      } else {
        m = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), crateMat);
        m.position.set(x, y + (kind === 'crateTop' ? 1.28 : 0.43), z);
        m.rotation.y = Math.random() * 1.5;
      }
      m.castShadow = true;
      this.group.add(m);
      if (kind !== 'crateTop') this.game.colliders.add({ x, z, r: 0.6 });
    }

    // Banner poles at the village entrance (south).
    this._banner(44, 16);
    this._banner(76, 20);

    // Dirt path decals: entrance → well → hall.
    const pathMat = toonMaterial({ color: 0x8a6f4c });
    const path = [
      [52, 24, 60, -2], [58, -4, 59, -20], [59, -24, 60, -58],
    ];
    for (const [x1, z1, x2, z2] of path) {
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, len + 2), pathMat);
      strip.position.set(cx, this._h(cx, cz) + 0.05, cz);
      strip.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      strip.receiveShadow = true;
      this.group.add(strip);
    }
  }

  _house({ x, z, yaw, w, d, roof, chimney, tall }) {
    const g = this.game;
    const y = this._h(x, z);
    const hg = new THREE.Group();
    hg.position.set(x, y, z);
    hg.rotation.y = yaw;

    const wallH = tall ? 3.4 : 2.6;
    const plaster = toonMaterial({ color: PALETTE.plaster });
    const timber = toonMaterial({ color: 0x4e3a28 });
    const roofMat = toonMaterial({ color: roof, cache: false });

    // Walls.
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), plaster);
    walls.position.y = wallH / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    hg.add(walls);

    // Timber frame: corner posts + belt.
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, wallH, 0.22), timber);
      post.position.set(sx * (w / 2 - 0.08), wallH / 2, sz * (d / 2 - 0.08));
      hg.add(post);
    }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.16, d + 0.06), timber);
    belt.position.y = wallH * 0.55;
    hg.add(belt);

    // Hip roof: 4-sided cone scaled to the footprint, with overhang.
    const roofH = tall ? 2.6 : 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1, roofH, 4), roofMat);
    cone.scale.set((w / 2 + 0.7) * 1.35, 1, (d / 2 + 0.7) * 1.35);
    cone.rotation.y = Math.PI / 4;
    cone.position.y = wallH + roofH / 2 - 0.05;
    cone.castShadow = true;
    hg.add(cone);

    // Door (front = +z side) with round top.
    const doorMat = toonMaterial({ color: PALETTE.woodDark });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.7, 0.12), doorMat);
    door.position.set(0, 0.85, d / 2 + 0.04);
    hg.add(door);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.12, 10, 1, false, 0, Math.PI), doorMat);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = Math.PI / 2;
    arch.position.set(0, 1.7, d / 2 + 0.04);
    hg.add(arch);

    // Windows: warm emissive at night (collected for the day/night fade).
    const winMat = new THREE.MeshToonMaterial({ color: 0x2c2c38, emissive: 0xffb45c, emissiveIntensity: 0 });
    this._windowMats.push(winMat);
    for (const sx of [-w / 4 - 0.3, w / 4 + 0.3]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.1), winMat);
      win.position.set(sx, 1.55, d / 2 + 0.03);
      hg.add(win);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.2), timber);
      sill.position.set(sx, 1.1, d / 2 + 0.08);
      hg.add(sill);
      // Window box flowers.
      const flow = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.16),
        toonMaterial({ color: [0xd9527a, 0xe8b64c, 0x8a5cc9][(Math.abs(x * 3 + sx * 7) | 0) % 3], cache: false }));
      flow.position.set(sx, 1.18, d / 2 + 0.14);
      hg.add(flow);
    }

    // Chimney.
    if (chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.55, roofH + 1.2, 0.55), toonMaterial({ color: PALETTE.stoneDark }));
      ch.position.set(w / 4, wallH + roofH / 2 + 0.3, -d / 5);
      ch.castShadow = true;
      hg.add(ch);
      const top = new THREE.Vector3(x, 0, z);
      // World-space chimney mouth (approximate — yaw-rotate the local offset).
      const lx = w / 4, lz = -d / 5;
      top.x += lx * Math.cos(yaw) + lz * Math.sin(yaw);
      top.z += -lx * Math.sin(yaw) + lz * Math.cos(yaw);
      top.y = y + wallH + roofH + 1;
      this._chimneys.push(top);
    }

    addOutline(hg, 0.008);
    this.group.add(hg);

    // Colliders: two circles along the long axis.
    const r = Math.min(w, d) / 2 + 0.35;
    const along = w >= d ? [[-w / 4, 0], [w / 4, 0]] : [[0, -d / 4], [0, d / 4]];
    for (const [lx, lz] of along) {
      g.colliders.add({
        x: x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
        z: z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
        r,
      });
    }
  }

  _well(x, z) {
    const g = this.game;
    const y = this._h(x, z);
    const wg = new THREE.Group();
    wg.position.set(x, y, z);
    const stone = toonMaterial({ color: PALETTE.stone });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 12, 1, true), stone);
    ring.position.y = 0.45;
    ring.castShadow = true;
    wg.add(ring);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 12),
      new THREE.MeshBasicMaterial({ color: 0x1d4a66 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.55;
    wg.add(water);
    // Posts + little roof.
    const wood = toonMaterial({ color: PALETTE.woodDark });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), wood);
      post.position.set(s * 1.05, 1.1, 0);
      wg.add(post);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 4), toonMaterial({ color: 0x8a5a40 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.55;
    roof.scale.z = 0.8;
    roof.castShadow = true;
    wg.add(roof);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 8), wood);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = 1.9;
    wg.add(axle);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.24, 8), wood);
    bucket.position.set(0, 1.2, 0);
    wg.add(bucket);
    addOutline(wg, 0.015);
    this.group.add(wg);
    g.colliders.add({ x, z, r: 1.5 });

    g.interact.register({
      position: new THREE.Vector3(x, y + 1, z),
      radius: 2.6,
      prompt: 'Drink',
      onInteract: (game) => {
        game.state.stamina = game.state.maxStamina;
        game.events.emit('toast', { text: 'The well water is sweet — stamina restored.' });
        game.events.emit('player:heal', { hp: game.state.hp });
      },
    });
  }

  _stall(x, z) {
    const g = this.game;
    const y = this._h(x, z);
    const sg = new THREE.Group();
    sg.position.set(x, y, z);
    sg.rotation.y = -0.5;
    const wood = toonMaterial({ color: PALETTE.wood });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.1), wood);
    counter.position.y = 0.5;
    counter.castShadow = true;
    sg.add(counter);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.14), wood);
      post.position.set(s * 1.4, 1.25, -0.4);
      sg.add(post);
    }
    // Striped awning: alternating colored slats.
    for (let i = 0; i < 6; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 1.9),
        toonMaterial({ color: i % 2 ? 0xe8dcc2 : 0xc9564c }));
      slat.position.set(-1.3 + i * 0.52, 2.42 - 0.12 * 0, 0.1);
      slat.rotation.x = -0.35;
      slat.castShadow = true;
      sg.add(slat);
    }
    // Wares: little potion bottles + gem pile.
    const potion = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      toonMaterial({ color: 0xd9527a, emissive: 0x581a2e, emissiveIntensity: 0.5 }));
    potion.position.set(-0.7, 1.15, 0.1);
    sg.add(potion);
    const potion2 = potion.clone();
    potion2.position.set(-0.4, 1.15, -0.15);
    sg.add(potion2);
    const gems = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({ color: PALETTE.gemGreen, toneMapped: false }));
    gems.position.set(0.6, 1.12, 0);
    sg.add(gems);
    addOutline(sg, 0.012);
    this.group.add(sg);
    g.colliders.add({ x, z, r: 1.7 });
  }

  _lantern(x, z) {
    const g = this.game;
    const y = this._h(x, z);
    const lg = new THREE.Group();
    lg.position.set(x, y, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 7), toonMaterial({ color: 0x3f3244 }));
    post.position.y = 1.3;
    post.castShadow = true;
    lg.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.07), toonMaterial({ color: 0x3f3244 }));
    arm.position.set(0.2, 2.55, 0);
    lg.add(arm);
    const glassMat = new THREE.MeshToonMaterial({ color: 0x584a2c, emissive: 0xffc46a, emissiveIntensity: 0 });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), glassMat);
    glass.position.set(0.42, 2.35, 0);
    lg.add(glass);
    const light = new THREE.PointLight(0xffb45c, 0, 16, 1.6);
    light.position.set(0.42, 2.3, 0);
    lg.add(light);
    this._lanterns.push({ light, glassMat, phase: Math.random() * 10 });
    this.group.add(lg);
    g.colliders.add({ x, z, r: 0.28 });
  }

  _fenceRun(x1, z1, x2, z2, posts) {
    const g = this.game;
    const wood = toonMaterial({ color: 0x8a6a44 });
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const x = lerp(x1, x2, t), z = lerp(z1, z2, t);
      const y = this._h(x, z);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), wood);
      post.position.set(x, y + 0.55, z);
      post.castShadow = true;
      this.group.add(post);
      if (i < posts - 1) {
        const nt = (i + 1) / (posts - 1);
        const nx = lerp(x1, x2, nt), nz = lerp(z1, z2, nt);
        const ny = this._h(nx, nz);
        for (const railH of [0.45, 0.85]) {
          const len = Math.hypot(nx - x, nz - z);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, len), wood);
          rail.position.set((x + nx) / 2, (y + ny) / 2 + railH, (z + nz) / 2);
          rail.rotation.y = Math.atan2(nx - x, nz - z);
          rail.rotation.x = Math.atan2(ny - y, len) * 0; // keep level, posts absorb slope
          this.group.add(rail);
        }
      }
    }
  }

  _banner(x, z) {
    const y = this._h(x, z);
    const bg = new THREE.Group();
    bg.position.set(x, y, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 7), toonMaterial({ color: PALETTE.woodDark }));
    pole.position.y = 2.1;
    pole.castShadow = true;
    bg.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6),
      new THREE.MeshToonMaterial({ color: 0x2e8b6c, side: THREE.DoubleSide }));
    cloth.position.set(0.48, 3.2, 0);
    bg.add(cloth);
    const sigil = new THREE.Mesh(new THREE.CircleGeometry(0.18, 8),
      new THREE.MeshBasicMaterial({ color: PALETTE.gold, side: THREE.DoubleSide, toneMapped: false }));
    sigil.position.set(0.48, 3.3, 0.01);
    bg.add(sigil);
    this._banners = this._banners || [];
    this._banners.push(cloth);
    this.group.add(bg);
    this.game.colliders.add({ x, z, r: 0.25 });
  }

  // -------------------------------------------------------------------------
  _spawnNPCs() {
    const g = this.game;
    this.npcs = [
      new NPC(g, {
        name: 'Elder Maren', dialogueId: 'maren', variant: 'elder',
        pos: { x: 60, z: -58 }, speed: 1.1,
        waypoints: [{ x: 60, z: -58 }, { x: 52, z: -50 }, { x: 66, z: -48 }],
        colors: { robe: 0x8a5c78, trim: 0x5c3a52, hair: 0xd8d2c8 }, hat: 'hood',
        quest: (gm) => {
          const st = gm.quests.stage('shattered-star');
          return st === 0 ? 'offer' : st === 1 ? 'progress' : st === 2 ? 'ready' : null;
        },
      }),
      new NPC(g, {
        name: 'Healer Nyla', dialogueId: 'nyla', variant: 'healer',
        pos: { x: 26, z: -44 }, speed: 1.5,
        waypoints: [{ x: 26, z: -44 }, { x: 42, z: -32 }, { x: 54, z: -24 }],
        colors: { robe: 0x5c8a72, trim: 0x3a5c4a, hair: 0x8a4a2e }, apron: true,
        quest: (gm) => {
          const st = gm.quests.stage('mushroom-medicine');
          if (st === 0) return 'offer';
          if (st === 1) return gm.quests.canTurnInShrooms() ? 'ready' : 'progress';
          return null;
        },
      }),
      new NPC(g, {
        name: 'Captain Bram', dialogueId: 'bram', variant: 'guard',
        pos: { x: 92, z: 4 }, speed: 2,
        waypoints: [{ x: 92, z: 4 }, { x: 70, z: 16 }, { x: 44, z: 12 }, { x: 48, z: -18 }, { x: 84, z: -22 }],
        colors: { robe: 0x6a6f7a, trim: 0x4a4e58, hair: 0x3c3228 }, scale: 1.12,
        quest: (gm) => {
          const st = gm.quests.stage('thin-the-horde');
          if (st === 0) return 'offer';
          if (st === 1) return gm.quests.canTurnInHorde() ? 'ready' : 'progress';
          return null;
        },
      }),
      new NPC(g, {
        name: 'Shopkeep Tam', dialogueId: 'tam', variant: 'merchant',
        pos: { x: 75, z: -10 }, speed: 1.2,
        waypoints: [{ x: 75, z: -10 }, { x: 77, z: -13 }],
        colors: { robe: 0xa8703e, trim: 0x6e4826, hair: 0x2c2018 }, apron: true,
      }),
      new NPC(g, {
        name: 'Pip', dialogueId: 'pip', variant: 'kid',
        pos: { x: 56, z: -14 }, speed: 3,
        waypoints: [{ x: 56, z: -14 }, { x: 70, z: -24 }, { x: 62, z: -34 }, { x: 46, z: -26 }],
        colors: { robe: 0xc9784a, trim: 0x8a4e2e, hair: 0xd9a441 }, scale: 0.62,
      }),
      new NPC(g, {
        name: 'Farmer Rho', dialogueId: 'rho', variant: 'farmer',
        pos: { x: 102, z: -40 }, speed: 1.3,
        waypoints: [{ x: 102, z: -40 }, { x: 112, z: -24 }, { x: 108, z: -8 }],
        colors: { robe: 0x7a8a52, trim: 0x565e3a, hair: 0x5c4632 }, hat: 'straw',
      }),
    ];
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    for (const npc of this.npcs) npc.update(dt);

    // Lanterns + windows wake at dusk.
    const isNight = g.sky?.isNight || (g.sky && (g.sky.timeOfDay > 0.73 || g.sky.timeOfDay < 0.26));
    this._nightGlow = damp(this._nightGlow, isNight ? 1 : 0, 1.5, dt);
    const t = performance.now() * 0.001;
    for (const l of this._lanterns) {
      const flicker = 1 + Math.sin(t * 9 + l.phase) * 0.06 + Math.sin(t * 23 + l.phase * 2) * 0.04;
      l.light.intensity = this._nightGlow * 40 * flicker;
      l.glassMat.emissiveIntensity = this._nightGlow * 1.3 * flicker;
    }
    for (const w of this._windowMats) {
      w.emissiveIntensity = this._nightGlow * 0.9;
    }

    // Banners sway.
    if (this._banners) {
      for (let i = 0; i < this._banners.length; i++) {
        this._banners[i].rotation.y = Math.sin(t * 1.4 + i * 2) * 0.22;
      }
    }

    // Chimney smoke.
    this._smokeT -= dt;
    if (this._smokeT <= 0 && this._chimneys.length && g.particles) {
      this._smokeT = 0.55;
      const c = this._chimneys[(Math.random() * this._chimneys.length) | 0];
      g.particles.emit('poof', c, { color: 0x9aa0ab });
    }
  }
}
