// Populates the overworld: enemy camps, treasure chests, quest collectibles,
// signposts, the Skywatch Ruins, the lake dock, and ambient night spawns.
// The village and dungeon are their own modules; this covers everything else.

import * as THREE from 'three';
import { RNG } from '../util/rng.js';
import { toonMaterial, PALETTE, addOutline } from '../gfx/Toon.js';
import { SITES, LAKE, SPAWN, WORLD, regionAt } from './layout.js';
import { Chest } from '../entities/Chest.js';
import { Pickup } from '../entities/Pickup.js';
import { createEnemy } from '../entities/Enemy.js';

const CAMPS = [
  { site: SITES.camp1, enemies: ['boglin', 'boglin', 'boglin'] },
  { site: SITES.camp2, enemies: ['boglin', 'boglin', 'skitter'] },
  { site: SITES.camp3, enemies: ['boglin', 'boglin_brute'] },
  { site: SITES.camp4, enemies: ['boglin', 'boglin', 'boglin_brute'] },
  { site: SITES.camp5, enemies: ['boglin', 'skitter', 'skitter'] },
];

export class World {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(WORLD.seed).fork('world');
    this._wisps = [];
    this._campState = CAMPS.map(() => ({ cleared: false, clearedDay: 0, spawned: false }));
    this._lastRegion = null;
    this._regionTimer = 0;

    this._buildRuins();
    this._buildDock();
    this._buildSignposts();
    this._placeChests();
    this._placeGlowshrooms();
    this._spawnCamps();
  }

  // -------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    this._regionCheck(dt);
    this._nightWisps();
    this._campRespawn();

    // Soft world boundary: keep the player inside the rim.
    const p = g.player.position;
    const d = Math.hypot(p.x, p.z);
    const maxR = WORLD.playRadius + 130;
    if (d > maxR) {
      p.x *= maxR / d; p.z *= maxR / d;
    }
  }

  _regionCheck(dt) {
    this._regionTimer -= dt;
    if (this._regionTimer > 0) return;
    this._regionTimer = 0.8;
    const g = this.game;
    const r = regionAt(g.player.position.x, g.player.position.z);
    if (r !== this._lastRegion) {
      this._lastRegion = r;
      g.events.emit('region:enter', { name: r });
    }
  }

  // --- enemy camps ----------------------------------------------------------
  _spawnCamps() {
    const g = this.game;
    for (let i = 0; i < CAMPS.length; i++) {
      const camp = CAMPS[i];
      const st = this._campState[i];
      if (st.spawned) continue;
      st.spawned = true;
      const rng = this.rng.fork(`camp${i}`);
      this._campProps(camp.site, rng);
      for (const type of camp.enemies) {
        const a = rng.angle(), r = rng.range(2, camp.site.r * 0.55);
        const x = camp.site.x + Math.sin(a) * r;
        const z = camp.site.z + Math.cos(a) * r;
        const e = createEnemy(g, type, new THREE.Vector3(x, g.terrain.heightAt(x, z), z), {
          anchor: { x: camp.site.x, z: camp.site.z, r: camp.site.r },
          campIndex: i,
        });
        g.enemies.push(e);
      }
    }
  }

  _campProps(site, rng) {
    const g = this.game;
    const group = new THREE.Group();
    // Crude boglin tents: leaning hide cones + a totem.
    const hide = toonMaterial({ color: 0x8a6248 });
    const pole = toonMaterial({ color: PALETTE.woodDark });
    for (let i = 0; i < 2; i++) {
      const a = rng.angle();
      const x = site.x + Math.sin(a) * site.r * 0.42;
      const z = site.z + Math.cos(a) * site.r * 0.42;
      const y = g.terrain.heightAt(x, z);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.6, 7, 1, true), hide);
      tent.position.set(x, y + 1.25, z);
      tent.rotation.y = rng.angle();
      tent.castShadow = true;
      group.add(tent);
      g.colliders.add({ x, z, r: 1.7 });
    }
    const tx = site.x, tz = site.z;
    const ty = g.terrain.heightAt(tx, tz);
    const totem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 3.2, 7), pole);
    totem.position.set(tx, ty + 1.6, tz);
    totem.castShadow = true;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 7), toonMaterial({ color: 0xd8d2c0 }));
    skull.position.set(tx, ty + 3.5, tz);
    group.add(totem, skull);
    g.colliders.add({ x: tx, z: tz, r: 0.55 });
    // Fire pit ring.
    const ringMat = toonMaterial({ color: PALETTE.stoneDark });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rx = tx + Math.sin(a) * 1.1 + 2.5, rz = tz + Math.cos(a) * 1.1 + 1.5;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), ringMat);
      rock.position.set(rx, g.terrain.heightAt(rx, rz) + 0.15, rz);
      group.add(rock);
    }
    g.scene.add(group);
  }

  _campRespawn() {
    // When a camp is cleared, it repopulates after the next dawn if the player is far away.
    const g = this.game;
    for (let i = 0; i < CAMPS.length; i++) {
      const st = this._campState[i];
      const camp = CAMPS[i];
      const alive = g.enemies.some((e) => e.campIndex === i && e.alive);
      if (!alive && !st.cleared) { st.cleared = true; st.clearedDay = g.state.day; }
      if (st.cleared && g.state.day > st.clearedDay) {
        const d = Math.hypot(g.player.position.x - camp.site.x, g.player.position.z - camp.site.z);
        if (d > 140) {
          st.cleared = false; st.spawned = false;
          this._spawnCamps();
        }
      }
    }
  }

  // --- ambient night wisps --------------------------------------------------
  _nightWisps() {
    const g = this.game;
    if (!g.sky) return;
    const night = g.sky.isNight;
    this._wisps = this._wisps.filter((w) => w.alive);
    if (night && this._wisps.length < 3 && !g.inDungeon) {
      const p = g.player.position;
      // Not near the village — it's a safe haven.
      const dv = Math.hypot(p.x - SITES.village.x, p.z - SITES.village.z);
      if (dv > SITES.village.r + 40) {
        const a = this.rng.angle();
        const r = 28 + this.rng.next() * 20;
        const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
        if (g.terrain.heightAt(x, z) > 1) {
          const w = createEnemy(g, 'wisp', new THREE.Vector3(x, g.terrain.heightAt(x, z) + 2, z), { ephemeral: true });
          g.enemies.push(w);
          this._wisps.push(w);
        }
      }
    }
    if (!night) {
      for (const w of this._wisps) if (w.alive && w.banish) w.banish();
    }
  }

  // --- landmarks ------------------------------------------------------------
  _buildRuins() {
    const g = this.game;
    const site = SITES.ruins;
    const rng = this.rng.fork('ruins');
    const stoneMat = toonMaterial({ color: PALETTE.stone });
    const mossMat = toonMaterial({ color: 0x7a9a6a });
    const group = new THREE.Group();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = site.r * 0.62;
      const x = site.x + Math.sin(a) * r;
      const z = site.z + Math.cos(a) * r;
      const y = g.terrain.heightAt(x, z);
      const broken = rng.chance(0.3);
      const h = broken ? rng.range(1.5, 3) : rng.range(5.5, 7.5);
      const stone = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.1), rng.chance(0.4) ? mossMat : stoneMat);
      stone.position.set(x, y + h / 2 - 0.2, z);
      stone.rotation.y = a + rng.range(-0.2, 0.2);
      stone.rotation.z = rng.range(-0.06, 0.06);
      stone.castShadow = true;
      group.add(stone);
      g.colliders.add({ x, z, r: 1.2 });
      // Lintels across some pairs.
      if (!broken && i % 2 === 0) {
        const a2 = ((i + 1) / n) * Math.PI * 2;
        const x2 = site.x + Math.sin(a2) * r, z2 = site.z + Math.cos(a2) * r;
        const lin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 1.2), stoneMat);
        lin.position.set((x + x2) / 2, y + h + 0.25, (z + z2) / 2);
        lin.rotation.y = Math.atan2(x2 - x, z2 - z) + Math.PI / 2;
        lin.castShadow = true;
        group.add(lin);
      }
    }
    // Central dais.
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 0.8, 9), stoneMat);
    const dy = g.terrain.heightAt(site.x, site.z);
    dais.position.set(site.x, dy + 0.3, site.z);
    dais.receiveShadow = true;
    group.add(dais);
    addOutline(group, 0.012);
    g.scene.add(group);

    g.interact.register({
      position: new THREE.Vector3(site.x, dy + 1, site.z),
      radius: 3.5,
      prompt: 'Examine',
      onInteract: () => {
        g.events.emit('toast', { text: '"When the star fell, the sky wept fire. The blade drank the dawn and slept." ' });
        g.events.emit('lore', { id: 'ruins' });
      },
    });
  }

  _buildDock() {
    const g = this.game;
    const site = SITES.lakeDock;
    const woodMat = toonMaterial({ color: PALETTE.wood });
    const group = new THREE.Group();
    // Planks marching toward the lake center.
    const dirX = (LAKE.x - site.x), dirZ = (LAKE.z - site.z);
    const len = Math.hypot(dirX, dirZ);
    const ux = dirX / len, uz = dirZ / len;
    const yaw = Math.atan2(ux, uz);
    for (let i = 0; i < 7; i++) {
      const px = site.x + ux * (i * 1.35 + 2);
      const pz = site.z + uz * (i * 1.35 + 2);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 1.25), woodMat);
      plank.position.set(px, 1.05 + Math.sin(i * 2.4) * 0.02, pz);
      plank.rotation.y = yaw;
      plank.castShadow = true;
      group.add(plank);
    }
    // Support posts.
    for (let i = 0; i < 4; i++) {
      const px = site.x + ux * (i * 3 + 2.4);
      const pz = site.z + uz * (i * 3 + 2.4);
      for (const side of [-1, 1]) {
        const ox = Math.cos(yaw) * side * 1.1, oz = -Math.sin(yaw) * side * 1.1;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.6, 6), woodMat);
        post.position.set(px + ox, 0.2, pz + oz);
        group.add(post);
      }
    }
    g.scene.add(group);
  }

  _buildSignposts() {
    const g = this.game;
    const signs = [
      { x: SPAWN.x + 8, z: SPAWN.z + 14, text: 'North: Brindlemere Village — safe beds, warm stew.\nFar north: the Elderwood. Travellers vanish there.' },
      { x: SITES.shrine.x + 30, z: SITES.shrine.z + 44, text: 'THE HOLLOW SHRINE\nSealed since the star fell. Turn back.' },
      { x: -160, z: 60, text: 'West: Mirrowmere.\nThe water is lovely. The deep water is not.' },
      { x: 250, z: 240, text: 'South-east: Cinder Flats.\nBring water. Trust nothing that skitters.' },
    ];
    const postMat = toonMaterial({ color: PALETTE.woodDark });
    const boardMat = toonMaterial({ color: PALETTE.wood });
    for (const s of signs) {
      const y = g.terrain.heightAt(s.x, s.z);
      const grp = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.7, 6), postMat);
      post.position.set(s.x, y + 0.85, s.z);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.09), boardMat);
      board.position.set(s.x, y + 1.5, s.z);
      board.rotation.y = Math.atan2(SPAWN.x - s.x, SPAWN.z - s.z);
      board.castShadow = true;
      grp.add(post, board);
      addOutline(grp, 0.02);
      g.scene.add(grp);
      g.colliders.add({ x: s.x, z: s.z, r: 0.3 });
      g.interact.register({
        position: new THREE.Vector3(s.x, y + 1, s.z),
        radius: 2.6,
        prompt: 'Read',
        onInteract: () => g.events.emit('sign:read', { text: s.text }),
      });
    }
  }

  // --- treasure -------------------------------------------------------------
  _placeChests() {
    const g = this.game;
    const spots = [
      { id: 'ruins', x: SITES.ruins.x, z: SITES.ruins.z, loot: { gems: 40, item: 'potion' } },
      { id: 'lake', x: LAKE.x + LAKE.r * 0.86, z: LAKE.z - LAKE.r * 0.5, loot: { gems: 25 } },
      { id: 'forest1', x: -60, z: -430, loot: { gems: 20, hearts: 1 } },
      { id: 'badland', x: 400, z: 330, loot: { gems: 60 } },
      { id: 'camp3', x: SITES.camp3.x + 6, z: SITES.camp3.z + 4, loot: { gems: 30 } },
      { id: 'hill-east', x: 560, z: -80, loot: { gems: 25, item: 'potion' } },
    ];
    this.chests = spots.map((sp) => {
      const y = g.terrain.heightAt(sp.x, sp.z);
      return new Chest(g, sp.id, new THREE.Vector3(sp.x, y, sp.z), this.rng.angle(), sp.loot);
    });
  }

  _placeGlowshrooms() {
    const g = this.game;
    const rng = this.rng.fork('shrooms');
    let placed = 0, tries = 0;
    while (placed < 10 && tries++ < 400) {
      const x = rng.range(-560, 560);
      const z = rng.range(-660, -270);
      const b = g.terrain.biomeAt(x, z);
      if (b.forest < 0.4 || b.slope > 0.5) continue;
      const y = g.terrain.heightAt(x, z) + 0.15;
      g.pickups.push(new Pickup(g, 'glowshroom', new THREE.Vector3(x, y, z)));
      placed++;
    }
  }

  updateChests(dt) {
    if (this.chests) for (const c of this.chests) c.update(dt);
  }
}
