import * as THREE from 'three';
import { Terrain } from './Terrain.js?v=3';
import { makeTree, makeRock, makeBush, makeRuin, makeFlowers, makeDungeonEntrance } from './Props.js?v=3';
import { Enemy } from '../entities/Enemy.js?v=3';
import { Pickup } from '../entities/Pickup.js?v=3';
import { Chest } from '../entities/Chest.js?v=3';
import { SkyEnv } from '../gfx/SkyEnv.js?v=3';
import { Grass } from '../gfx/Grass.js?v=3';
import { Fireflies, Clouds } from '../gfx/Particles.js?v=3';
import { waterNormal } from '../gfx/Textures.js?v=3';

// Builds and owns the open overworld: atmospheric sky, terrain, water, lush
// grass, scattered props, enemies, pickups, chests, and the dungeon entrance.
export class World {
  constructor(renderer, quality = {}) {
    this.name = 'overworld';
    this.quality = {
      grass: 16000, shadowMap: 4096, propScale: 1, fireflies: 200, ...quality,
    };
    this.terrain = new Terrain({ size: 400, segments: 320, maxHeight: 22, seed: 7 });
    this.group = new THREE.Group();
    this.enemies = [];
    this.pickups = [];
    this.chests = [];
    this.colliders = [];          // overworld is open; props are non-blocking
    this.interactables = [];
    this.swayables = [];          // tree crowns that bend in the wind

    // ---- Sky, light, environment ----
    this.sky = new SkyEnv(renderer, { elevationDeg: 22, azimuthDeg: 125, shadowMapSize: this.quality.shadowMap });
    this.environment = this.sky.environment;
    this.background = this.sky.fogColor.clone();
    this.fog = new THREE.FogExp2(this.sky.fogColor.getHex(), 0.0026);
    this.group.add(this.sky.mesh, this.sky.sun, this.sky.sun.target, this.sky.hemi, this.sky.fill);

    this.spawn = new THREE.Vector3(0, this.terrain.getHeightAt(0, 0), 0);

    this.group.add(this.terrain.mesh);
    this._buildWater();
    this._buildGrass();
    this._scatterProps();
    this._buildClouds();
    this._buildFireflies();
    this._buildDungeonEntrance();
    this._spawnEnemies();
    this._spawnLoot();
  }

  _buildWater() {
    // A rippling, reflective water plane. Waves are injected into the vertex
    // shader; reflections come from the scene environment map.
    const geo = new THREE.PlaneGeometry(this.terrain.size, this.terrain.size, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const wnorm = waterNormal();
    wnorm.repeat.set(14, 14);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2b86c5,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.0,
      envMapIntensity: 1.2,
      normalMap: wnorm,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });
    this.waterNormalTex = wnorm;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      mat.userData.shader = shader;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */`
        #include <begin_vertex>
        float w = sin(position.x * 0.25 + uTime * 1.3)
                + sin(position.z * 0.32 + uTime * 1.7) * 0.7
                + sin((position.x + position.z) * 0.15 + uTime) * 0.5;
        transformed.y += w * 0.18;
        `
      );
    };
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = this.terrain.seaLevel;
    this.water.receiveShadow = true;
    this.group.add(this.water);
  }

  _buildGrass() {
    this.grass = new Grass(this.terrain, { count: this.quality.grass, radius: 135 });
    this.group.add(this.grass.mesh);
  }

  _buildClouds() {
    this.clouds = new Clouds({ count: 16 });
    this.group.add(this.clouds.group);
  }

  _buildFireflies() {
    this.fireflies = new Fireflies({ count: this.quality.fireflies, radius: 55 });
    this.group.add(this.fireflies.points);
  }

  // Reject spots that are underwater or too close to the spawn meadow.
  _validSpot(minR = 18, maxR = 185) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.terrain.isUnderwater(x, z)) return { x, z };
    }
    return null;
  }

  _scatterProps() {
    const propCount = Math.round(300 * this.quality.propScale);
    for (let i = 0; i < propCount; i++) {
      const spot = this._validSpot(12);
      if (!spot) continue;
      const h = this.terrain.getHeightAt(spot.x, spot.z);
      let prop;
      if (h > this.terrain.maxHeight * 0.72) prop = makeRock(spot.x, spot.z, this.terrain);
      else {
        const roll = Math.random();
        if (roll < 0.55) prop = makeTree(spot.x, spot.z, this.terrain);
        else if (roll < 0.78) prop = makeRock(spot.x, spot.z, this.terrain);
        else prop = makeBush(spot.x, spot.z, this.terrain);
      }
      if (prop.userData.sway) this.swayables.push(prop.userData.sway);
      this.group.add(prop);
    }
    // Colourful flower clusters in the meadow.
    for (let i = 0; i < 60; i++) {
      const spot = this._validSpot(8, 120);
      if (spot && this.terrain.getHeightAt(spot.x, spot.z) < this.terrain.maxHeight * 0.45) {
        this.group.add(makeFlowers(spot.x, spot.z, this.terrain));
      }
    }
    // A few ruin landmarks.
    for (let i = 0; i < 5; i++) {
      const spot = this._validSpot(30, 160);
      if (spot) this.group.add(makeRuin(spot.x, spot.z, this.terrain));
    }
  }

  _buildDungeonEntrance() {
    // Place the entrance at a fixed, reachable spot on dry land.
    let x = 48, z = -34;
    if (this.terrain.isUnderwater(x, z)) { x = 30; z = 30; }
    this.entrancePos = new THREE.Vector3(x, this.terrain.getHeightAt(x, z), z);
    this.entrance = makeDungeonEntrance(x, z, this.terrain);
    this.group.add(this.entrance);

    this.interactables.push({
      position: this.entrancePos,
      range: 4.5,
      getPrompt: () => '[E] Enter the dungeon',
      interact: (game) => game.enterDungeon(),
    });
  }

  _spawnEnemies() {
    for (let i = 0; i < 14; i++) {
      const spot = this._validSpot(22, 170);
      if (!spot) continue;
      const kind = Math.random() < 0.65 ? 'chu' : 'moblin';
      const e = new Enemy(kind, spot.x, spot.z, this.terrain);
      this.enemies.push(e);
      this.group.add(e.mesh);
    }
  }

  _spawnLoot() {
    for (let i = 0; i < 16; i++) {
      const spot = this._validSpot(14, 170);
      if (!spot) continue;
      const y = this.terrain.getHeightAt(spot.x, spot.z) + 0.6;
      const roll = Math.random();
      const color = roll < 0.7 ? 'green' : roll < 0.95 ? 'blue' : 'red';
      const value = color === 'green' ? 1 : color === 'blue' ? 5 : 20;
      const p = new Pickup('rupee', spot.x, y, spot.z, { color, value });
      this.pickups.push(p);
      this.group.add(p.mesh);
    }

    const chestDefs = [
      { dx: -24, dz: 18, reward: { itemId: 'shield', count: 1 } },
      { dx: 20, dz: 40, reward: { itemId: 'bow', count: 1 } },
      { dx: -40, dz: -20, reward: { itemId: 'bomb', count: 5 } },
    ];
    chestDefs.forEach((c, i) => {
      let { dx, dz } = c;
      if (this.terrain.isUnderwater(dx, dz)) { dx *= 0.4; dz *= 0.4; }
      const chest = new Chest(`ow-chest-${i}`, dx, dz, this.terrain, c.reward);
      this.chests.push(chest);
      this.group.add(chest.group);
      this.interactables.push({
        position: chest.group.position,
        range: 2.6,
        getPrompt: () => (chest.opened ? null : '[E] Open chest'),
        interact: (game) => game.openChest(chest),
      });
    });
  }

  update(dt, elapsed) {
    const focus = this._followTarget;

    // Portal shimmer.
    if (this.entrance?.userData.portal) {
      const p = this.entrance.userData.portal;
      p.material.opacity = 0.4 + Math.sin(elapsed * 3) * 0.18;
      p.rotation.z += dt * 0.5;
    }

    // Animated water + grass + clouds + fireflies.
    if (this.water?.material.userData.shader) {
      this.water.material.userData.shader.uniforms.uTime.value = elapsed;
    }
    if (this.waterNormalTex) {
      this.waterNormalTex.offset.x = elapsed * 0.03;
      this.waterNormalTex.offset.y = elapsed * 0.02;
    }
    this.grass?.update(elapsed);
    this.clouds?.update(dt);
    this.fireflies?.update(elapsed, focus);

    // Wind sway on tree crowns.
    for (const s of this.swayables) {
      s.crown.rotation.x = Math.sin(elapsed * 1.2 + s.phase) * s.amp;
      s.crown.rotation.z = Math.cos(elapsed * 0.9 + s.phase) * s.amp;
    }

    // Keep the sky dome and sun shadow frustum centered on the viewer.
    if (focus) this.sky.follow(focus);

    for (const c of this.chests) c.update(dt);
  }

  setShadowFocus(pos) { this._followTarget = pos; }
}
