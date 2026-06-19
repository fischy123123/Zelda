import * as THREE from 'three';
import { Input } from './Input.js?v=3';
import { SaveManager } from './SaveManager.js?v=3';
import { World } from '../world/World.js?v=3';
import { Dungeon } from '../world/Dungeon.js?v=3';
import { Player } from '../entities/Player.js?v=3';
import { ThirdPersonCamera } from '../systems/ThirdPersonCamera.js?v=3';
import { Inventory } from '../systems/Inventory.js?v=3';
import { Combat } from '../systems/Combat.js?v=3';
import { Pickup } from '../entities/Pickup.js?v=3';
import { HUD } from '../ui/HUD.js?v=3';
import { InventoryUI } from '../ui/InventoryUI.js?v=3';
import { Menu } from '../ui/Menu.js?v=3';
import { TouchControls } from '../ui/TouchControls.js?v=3';
import { createComposer } from '../gfx/PostFX.js?v=3';

const STATE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', INVENTORY: 'inventory' };
const PLAYER_RADIUS = 0.5;
const AUTOSAVE_INTERVAL = 12; // seconds

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = STATE.TITLE;
    this.autosaveTimer = 0;
    this.openedChestIds = new Set();

    // ---- Device / quality detection ----
    const coarse = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
      || (navigator.maxTouchPoints || 0) > 0;
    this.isMobile = coarse && Math.min(window.innerWidth, window.innerHeight) < 1100;
    this.quality = this.isMobile
      ? { pixelRatio: 1.5, samples: 0, ao: false, grass: 5000, shadowMap: 1024, propScale: 0.55, fireflies: 90 }
      : { pixelRatio: 2, samples: 4, ao: true, grass: 16000, shadowMap: 4096, propScale: 1, fireflies: 200 };

    // ---- Renderer / scene / camera ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Cinematic colour grading: filmic tone mapping in linear-sRGB.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.clock = new THREE.Clock();

    // Post-processing pipeline (bloom + anti-aliasing + tone-mapped output).
    const fx = createComposer(this.renderer, this.scene, this.camera, this.quality);
    this.composer = fx.composer;
    this.bloom = fx.bloom;

    // ---- Systems / UI ----
    this.input = new Input(canvas);
    this.inventory = new Inventory();
    this.hud = new HUD();
    this.inventoryUI = new InventoryUI(this.inventory, () => this.applyEquipment());
    this.menu = new Menu({
      onNewGame: () => this.newGame(),
      onContinue: () => this.onContinue(),
    });
    // On-screen controls for touch devices.
    this.touch = this.input.isTouch ? new TouchControls(this.input) : null;

    this.activeArea = null;
    this.areas = {};

    window.addEventListener('resize', () => this.onResize());
    this.menu.show('title', SaveManager.has());
  }

  // ---------- lifecycle ----------
  onContinue() {
    if (this.state === STATE.PAUSED) { this.resume(); return; }
    this.loadGame();
  }

  newGame() {
    SaveManager.clear();
    this.openedChestIds = new Set();
    this.inventory = new Inventory();
    this.inventory.add('sword'); // start with the hero sword
    this.inventoryUI.inventory = this.inventory;

    this._buildAreas();
    this._resetPlayer();
    this.cameraController = new ThirdPersonCamera(this.camera, this.areas.overworld.terrain);

    this.applyEquipment();
    this.setActiveArea(this.areas.overworld, this.areas.overworld.spawn);
    this.startPlaying();
    this.hud.toast('Welcome to the Verdant Realm!');
  }

  loadGame() {
    const data = SaveManager.load();
    if (!data) { this.newGame(); return; }

    this.openedChestIds = new Set(data.openedChestIds || []);
    this.inventory = new Inventory();
    this.inventory.fromJSON(data.inventory);
    this.inventoryUI.inventory = this.inventory;

    this._buildAreas();
    // Restore dungeon progress.
    if (data.dungeon?.unlocked) this.areas.dungeon.unlock();
    this.areas.dungeon.cleared = !!data.dungeon?.cleared;
    this._applyChestState();

    this._resetPlayer();
    this.player.maxHealth = data.player?.maxHealth ?? 6;
    this.player.health = data.player?.health ?? this.player.maxHealth;
    this.cameraController = new ThirdPersonCamera(this.camera, this.areas.overworld.terrain);
    this.applyEquipment();

    const area = data.area === 'dungeon' ? this.areas.dungeon : this.areas.overworld;
    const pos = data.player
      ? new THREE.Vector3(data.player.x, data.player.y, data.player.z)
      : area.spawn;
    this.setActiveArea(area, pos);
    this.startPlaying();
    this.hud.toast('Welcome back, hero.');
  }

  _buildAreas() {
    // Dispose any previous area groups.
    for (const a of Object.values(this.areas)) {
      if (a.group.parent) this.scene.remove(a.group);
    }
    this.areas = { overworld: new World(this.renderer, this.quality), dungeon: new Dungeon(this.renderer) };
  }

  // Replace any existing hero (e.g. on restart) and add a fresh one to the scene.
  _resetPlayer() {
    if (this.player) this.scene.remove(this.player.group);
    this.player = new Player(this.areas.overworld.terrain);
    this.scene.add(this.player.group);
  }

  _applyChestState() {
    for (const area of Object.values(this.areas)) {
      for (const chest of area.chests) {
        if (this.openedChestIds.has(chest.id)) {
          chest.opened = true;
          chest.lidAngle = -Math.PI * 0.6;
          chest.lid.rotation.x = chest.lidAngle;
        }
      }
    }
  }

  startPlaying() {
    this.state = STATE.PLAYING;
    this.menu.hide();
    this.inventoryUI.close();
    this.hud.show();
    this.touch?.show();
    document.getElementById('loading').classList.add('hidden');
  }

  pause() {
    this.state = STATE.PAUSED;
    this.input.releaseLock();
    this.menu.show('pause', true);
  }

  resume() {
    this.state = STATE.PLAYING;
    this.menu.hide();
  }

  // ---------- area switching ----------
  setActiveArea(area, spawnPos) {
    if (this.activeArea) this.scene.remove(this.activeArea.group);
    this.activeArea = area;
    this.scene.add(area.group);
    this.scene.background = area.background;
    this.scene.fog = area.fog;
    this.scene.environment = area.environment ?? null;
    // Stronger bloom in the dark dungeon, gentler in daylight.
    if (this.bloom) this.bloom.strength = area.name === 'dungeon' ? 0.95 : 0.6;

    // Point the persistent player + camera at this area's ground model.
    this.player.terrain = area.terrain;
    this.cameraController.terrain = area.terrain;
    this.player.group.position.copy(spawnPos);
    this.player.velocityY = 0;
    this.player.grounded = true;
    this.cameraController.snap(this.player);
  }

  enterDungeon() {
    this.setActiveArea(this.areas.dungeon, this.areas.dungeon.spawn);
    this.hud.toast('You step into the dungeon…');
    this.save();
  }

  exitDungeon() {
    const ow = this.areas.overworld;
    const exitPos = ow.entrancePos.clone();
    exitPos.z += 6; // step out in front of the portal
    exitPos.y = ow.terrain.getHeightAt(exitPos.x, exitPos.z);
    this.setActiveArea(ow, exitPos);
    this.hud.toast('Back to the open world.');
    this.save();
  }

  // ---------- interactions ----------
  openChest(chest) {
    if (!chest.open()) return;
    this.openedChestIds.add(chest.id);
    const r = chest.reward;
    if (r.rupees) {
      this.inventory.addRupees(r.rupees);
      this.hud.toast(`Found ${r.rupees} rupees!`);
    }
    if (r.itemId) {
      this.inventory.add(r.itemId, r.count || 1);
      const def = this.inventory.list().find((x) => x.def.id === r.itemId)?.def;
      this.hud.toast(`Got ${def ? def.name : r.itemId}!`);
      this.applyEquipment();
    }
    if (r.alsoHeart) {
      this.player.maxHealth += 2;
      this.player.health = this.player.maxHealth;
      this.hud.toast('Heart Container — max health up!');
    }
    if (chest === this.areas.dungeon.rewardChest) {
      this.areas.dungeon.cleared = true;
      this.hud.toast('The dungeon is cleared!');
    }
    this.save();
  }

  tryUnlockGate(dungeon) {
    if (dungeon.unlocked) return;
    if (this.inventory.useKey()) {
      dungeon.unlock();
      this.hud.toast('The golden gate rises!');
      this.save();
    } else {
      this.hud.toast('It is locked. A key must be near…');
    }
  }

  applyEquipment() {
    if (!this.player) return;
    this.player.hasShield = this.inventory.equipped.offhand === 'shield';
    // All current weapons keep base sword damage; hook for future upgrades.
    this.player.swordDamage = 1;
  }

  // ---------- per-frame update ----------
  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();

    if (this.state === STATE.PLAYING) {
      this._handleGlobalKeys();
      this._updatePlaying(dt, elapsed);
    } else if (this.state === STATE.INVENTORY) {
      if (this.input.wasPressed('KeyI') || this.input.wasPressed('Escape')) {
        this.inventoryUI.close();
        this.state = STATE.PLAYING;
      }
    } else if (this.state === STATE.PAUSED) {
      if (this.input.wasPressed('Escape')) this.resume();
    }

    this.input.endFrame();
    // Render through the post pipeline; if any effect fails at runtime, fall
    // back to a plain render so the game never black-screens.
    if (this.composerBroken) {
      this.renderer.render(this.scene, this.camera);
    } else {
      try {
        this.composer.render();
      } catch (e) {
        console.error('[Game] post-processing failed, falling back to direct render:', e);
        this.composerBroken = true;
        this.renderer.render(this.scene, this.camera);
      }
    }
  }

  _handleGlobalKeys() {
    if (this.input.wasPressed('Escape')) { this.pause(); return; }
    if (this.input.wasPressed('KeyI')) {
      this.state = STATE.INVENTORY;
      this.input.releaseLock();
      this.inventoryUI.show();
    }
  }

  _updatePlaying(dt, elapsed) {
    const area = this.activeArea;

    // Attack input (mouse click or F) before the player updates so the swing animates this frame.
    if (this.input.consumeClick() || this.input.wasPressed('KeyF')) {
      this.player.startAttack();
    }

    this.cameraController.updateFromInput(this.input);
    this.player.update(dt, this.input, this.cameraController);
    this._resolveCollisions(this.player.group.position, area.colliders);

    // Combat: sword hits + enemy contact + movement.
    const drops = Combat.resolve(this.player, area.enemies, dt);
    for (const d of drops) this._spawnDrops(area, d);
    this._removeDeadEnemies(area);

    // Pickups.
    this._updatePickups(area, dt);

    // Ambient area animation + shadow focus.
    area.setShadowFocus(this.player.group.position);
    area.update(dt, elapsed);

    // Interaction prompt + activation.
    this._updateInteractions(area);

    this.cameraController.follow(this.player, dt);
    this.hud.update(this.player, this.inventory);

    // Death handling — forgiving respawn.
    if (this.player.health <= 0) this._onDeath();

    // Autosave.
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0;
      this.save();
    }
  }

  _spawnDrops(area, drop) {
    if (drop.dropsKey) {
      const p = new Pickup('key', drop.position.x, drop.position.y + 0.6, drop.position.z);
      area.pickups.push(p);
      area.group.add(p.mesh);
    }
    // Small chance of a heart, otherwise rupees.
    if (Math.random() < 0.3) {
      const p = new Pickup('heart', drop.position.x + 0.4, drop.position.y + 0.6, drop.position.z);
      area.pickups.push(p);
      area.group.add(p.mesh);
    } else {
      const p = new Pickup('rupee', drop.position.x, drop.position.y + 0.6, drop.position.z, {
        color: drop.rupeeColor, value: drop.rupeeValue,
      });
      area.pickups.push(p);
      area.group.add(p.mesh);
    }
  }

  _removeDeadEnemies(area) {
    for (let i = area.enemies.length - 1; i >= 0; i--) {
      const e = area.enemies[i];
      if (e.dead) {
        area.group.remove(e.mesh);
        e.dispose();
        area.enemies.splice(i, 1);
      }
    }
  }

  _updatePickups(area, dt) {
    for (let i = area.pickups.length - 1; i >= 0; i--) {
      const p = area.pickups[i];
      p.update(dt, this.player.group.position);
      if (p.collected) {
        this._collect(p);
        area.group.remove(p.mesh);
        p.dispose();
        area.pickups.splice(i, 1);
      }
    }
  }

  _collect(p) {
    if (p.type === 'rupee') {
      this.inventory.addRupees(p.value);
      this.hud.toast(`+${p.value} rupee${p.value > 1 ? 's' : ''}`);
    } else if (p.type === 'heart') {
      this.player.heal(2);
      this.hud.toast('Recovered a heart');
    } else if (p.type === 'key') {
      this.inventory.add('key', 1);
      this.hud.toast('Found a Small Key!');
    } else if (p.type === 'item' && p.itemId) {
      this.inventory.add(p.itemId);
      this.hud.toast(`Got ${p.itemId}!`);
    }
  }

  _updateInteractions(area) {
    let nearest = null;
    let nearestDist = Infinity;
    const pp = this.player.group.position;
    for (const it of area.interactables) {
      const prompt = it.getPrompt(this);
      if (!prompt) continue;
      const d = pp.distanceTo(it.position);
      if (d <= it.range && d < nearestDist) {
        nearest = it;
        nearestDist = d;
      }
    }
    this.hud.setPrompt(nearest ? nearest.getPrompt(this) : null);
    if (nearest && this.input.wasPressed('KeyE')) {
      nearest.interact(this);
    }
  }

  _onDeath() {
    this.player.health = this.player.maxHealth;
    const spawn = this.activeArea.spawn.clone();
    spawn.y = this.activeArea.terrain.getHeightAt(spawn.x, spawn.z);
    this.player.group.position.copy(spawn);
    this.player.knockback.set(0, 0, 0);
    this.player.invuln = 1.5;
    this.cameraController.snap(this.player);
    this.hud.toast('You fell… and were revived at the start.');
    this.save();
  }

  // ---------- persistence ----------
  snapshot() {
    const pp = this.player.group.position;
    return {
      area: this.activeArea.name,
      player: {
        x: pp.x, y: pp.y, z: pp.z,
        health: this.player.health,
        maxHealth: this.player.maxHealth,
      },
      inventory: this.inventory.toJSON(),
      openedChestIds: [...this.openedChestIds],
      dungeon: {
        unlocked: this.areas.dungeon.unlocked,
        cleared: this.areas.dungeon.cleared,
      },
    };
  }

  save() {
    if (!this.player) return;
    SaveManager.save(this.snapshot());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- collision ----------
  _resolveCollisions(pos, colliders) {
    if (!colliders || colliders.length === 0) return;
    for (const c of colliders) {
      const cx = THREE.MathUtils.clamp(pos.x, c.minX, c.maxX);
      const cz = THREE.MathUtils.clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < PLAYER_RADIUS * PLAYER_RADIUS) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = PLAYER_RADIUS - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // Center is inside the box: eject along the nearest face.
          const left = pos.x - c.minX, right = c.maxX - pos.x;
          const front = pos.z - c.minZ, back = c.maxZ - pos.z;
          const min = Math.min(left, right, front, back);
          if (min === left) pos.x = c.minX - PLAYER_RADIUS;
          else if (min === right) pos.x = c.maxX + PLAYER_RADIUS;
          else if (min === front) pos.z = c.minZ - PLAYER_RADIUS;
          else pos.z = c.maxZ + PLAYER_RADIUS;
        }
      }
    }
  }
}
