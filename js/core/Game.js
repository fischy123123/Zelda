import * as THREE from 'three';
import { Input } from './Input.js?v=14';
import { SaveManager } from './SaveManager.js?v=14';
import { AudioSys } from './Audio.js?v=14';
import { World } from '../world/World.js?v=14';
import { Dungeon } from '../world/Dungeon.js?v=14';
import { Player } from '../entities/Player.js?v=14';
import { ThirdPersonCamera } from '../systems/ThirdPersonCamera.js?v=14';
import { Inventory } from '../systems/Inventory.js?v=14';
import { Combat } from '../systems/Combat.js?v=14';
import { QUESTS } from '../systems/Quests.js?v=14';
import { Pickup } from '../entities/Pickup.js?v=14';
import { Particles, Shake } from '../gfx/Effects.js?v=14';
import { HUD } from '../ui/HUD.js?v=14';
import { InventoryUI } from '../ui/InventoryUI.js?v=14';
import { Menu } from '../ui/Menu.js?v=14';
import { Dialogue } from '../ui/Dialogue.js?v=14';
import { Minimap } from '../ui/Minimap.js?v=14';
import { TouchControls } from '../ui/TouchControls.js?v=14';
import { createComposer } from '../gfx/PostFX.js?v=14';

const STATE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', INVENTORY: 'inventory', DIALOGUE: 'dialogue' };
const PLAYER_RADIUS = 0.5;
const AUTOSAVE_INTERVAL = 12; // seconds

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = STATE.TITLE;
    this.autosaveTimer = 0;
    this.openedChestIds = new Set();
    this.quest = 0;
    this.lockEnemy = null;
    this.hitstop = 0;
    this._region = null;

    // ---- Device / quality detection (mobile-first performance) ----
    const coarse = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
      || (navigator.maxTouchPoints || 0) > 0;
    this.isMobile = coarse && Math.min(window.innerWidth, window.innerHeight) < 1100;
    this.quality = this.isMobile
      ? { pixelRatio: 1.35, samples: 0, ao: false, smaa: false, grass: 4200, shadowMap: 1024, propScale: 0.5, fireflies: 70, lights: false, particles: 40 }
      : { pixelRatio: 2, samples: 4, ao: true, smaa: true, grass: 16000, shadowMap: 4096, propScale: 1, fireflies: 200, lights: true, particles: 90 };

    // ---- Renderer / scene / camera ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.clock = new THREE.Clock();

    const fx = createComposer(this.renderer, this.scene, this.camera, this.quality);
    this.composer = fx.composer;
    this.bloom = fx.bloom;

    // ---- Systems / UI ----
    this.input = new Input(canvas);
    this.audio = new AudioSys();
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    this.inventory = new Inventory();
    this.hud = new HUD();
    this.dialogue = new Dialogue();
    this.minimap = new Minimap();
    this.inventoryUI = new InventoryUI(this.inventory, () => this.applyEquipment());
    this.menu = new Menu({
      onNewGame: () => { this.audio.sfx('click'); this.newGame(); },
      onContinue: () => { this.audio.sfx('click'); this.onContinue(); },
    });
    this.touch = this.input.isTouch ? new TouchControls(this.input) : null;

    // Combat feedback: sparks + camera shake + Z-target reticle.
    this.particles = new Particles(this.scene, this.quality.particles);
    this.shake = new Shake();
    this.reticle = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false })
    );
    this.reticle.renderOrder = 999;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

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
    this.inventory.add('sword');
    this.inventoryUI.inventory = this.inventory;

    this._buildAreas();
    this._resetPlayer();
    this.cameraController = new ThirdPersonCamera(this.camera, this.areas.overworld.terrain, { autoFollow: this.input.isTouch });

    this.applyEquipment();
    this.setActiveArea(this.areas.overworld, this.areas.overworld.spawn);
    this.setQuest(0, { silent: true });
    this.minimap.init(this.areas.overworld);
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
    if (data.dungeon?.unlocked) this.areas.dungeon.unlock();
    this.areas.dungeon.cleared = !!data.dungeon?.cleared;
    if (typeof data.timeOfDay === 'number') this.areas.overworld.dayTime = data.timeOfDay;
    this._applyChestState();

    this._resetPlayer();
    this.player.maxHealth = data.player?.maxHealth ?? 6;
    this.player.health = data.player?.health ?? this.player.maxHealth;
    this.cameraController = new ThirdPersonCamera(this.camera, this.areas.overworld.terrain, { autoFollow: this.input.isTouch });
    this.applyEquipment();

    const area = data.area === 'dungeon' ? this.areas.dungeon : this.areas.overworld;
    const pos = data.player
      ? new THREE.Vector3(data.player.x, data.player.y, data.player.z)
      : area.spawn;
    this.setActiveArea(area, pos);
    this.setQuest(data.quest ?? 0, { silent: true });
    this.minimap.init(this.areas.overworld);
    this.startPlaying();
    this.hud.toast('Welcome back, hero.');
  }

  _buildAreas() {
    for (const a of Object.values(this.areas)) {
      if (a.group.parent) this.scene.remove(a.group);
    }
    this.areas = { overworld: new World(this.renderer, this.quality), dungeon: new Dungeon(this.renderer) };
  }

  _resetPlayer() {
    if (this.player) this.scene.remove(this.player.group);
    this.player = new Player(this.areas.overworld.terrain);
    this.scene.add(this.player.group);
    this._wasRolling = false;
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

  // ---------- quest line ----------
  setQuest(i, { silent = false } = {}) {
    this.quest = i;
    this.hud.setObjective(QUESTS[i]?.objective || null);
    if (!silent) {
      this.audio.sfx('quest');
      this.hud.toast('Objective updated');
    }
  }

  // One-way progression for world-event milestones.
  milestone(n) { if (this.quest < n) this.setQuest(n); }

  talkTo(id) {
    let name = '???', lines = ['...'], after = null;
    if (id === 'elder') {
      name = 'Elder Maru';
      if (this.quest === 0) {
        lines = [
          'Ah… a traveler, at last. Our realm withers under a shadow.',
          'A dark power festers in the Sunken Vault — the glowing arch beyond the north-east hills.',
          'Bring back the Shard of Power sealed within, and the Verdant Realm may yet bloom again.',
        ];
        after = () => this.setQuest(1);
      } else if (this.quest === 5) {
        lines = [
          'The Shard! By the old light… you truly did it, hero.',
          'The realm owes you everything. Take these rupees — and our gratitude, always.',
        ];
        after = () => {
          this.inventory.addRupees(100);
          this.audio.sfx('fanfare');
          this.hud.toast('+100 rupees!');
          this.setQuest(6);
          this.save();
        };
      } else if (this.quest === 6) {
        lines = ['The realm breathes easy again. Rest, hero — you have earned it.'];
      } else {
        lines = [
          'The vault lies to the north-east — follow the glowing arch on your map.',
          'Its inner gate answers only to a small key. One of the brutes inside carries it.',
        ];
      }
    } else if (id === 'lin') {
      name = 'Lin';
      lines = this.areas.overworld.isNight
        ? ['The fireflies come out after dusk… aren\'t they pretty?', 'Papa says the moblins get bolder at night. Be careful!']
        : ['I saw a BLUE rupee hiding in the tall grass once. Really!', 'If you hold your shield up, the moblins can\'t hurt you. Papa taught me that.'];
    }
    this.audio.sfx('talk');
    this.state = STATE.DIALOGUE;
    this.hud.setPrompt(null);
    this.dialogue.show(name, lines, () => {
      this.state = STATE.PLAYING;
      after && after();
    });
  }

  // ---------- area switching ----------
  setActiveArea(area, spawnPos) {
    this._clearLock();
    if (this.activeArea) this.scene.remove(this.activeArea.group);
    this.activeArea = area;
    this.scene.add(area.group);
    this.scene.background = area.background;
    this.scene.fog = area.fog;
    this.scene.environment = area.environment ?? null;
    const bloomScale = this.isMobile ? 0.8 : 1;
    if (this.bloom) this.bloom.strength = (area.name === 'dungeon' ? 0.95 : 0.6) * bloomScale;

    this.player.terrain = area.terrain;
    this.cameraController.terrain = area.terrain;
    this.player.group.position.copy(spawnPos);
    this.player.velocityY = 0;
    this.player.grounded = true;
    this.cameraController.snap(this.player);
    this.minimap.setVisible(area.name === 'overworld');
  }

  enterDungeon() {
    this.setActiveArea(this.areas.dungeon, this.areas.dungeon.spawn);
    this.audio.sfx('portal');
    this.hud.splashRegion('The Sunken Vault');
    this.milestone(2);
    this.save();
  }

  exitDungeon() {
    const ow = this.areas.overworld;
    const exitPos = ow.entrancePos.clone();
    exitPos.z += 6;
    exitPos.y = ow.terrain.getHeightAt(exitPos.x, exitPos.z);
    this.setActiveArea(ow, exitPos);
    this.audio.sfx('portal');
    this._region = null; // re-splash the region name
    this.save();
  }

  // ---------- interactions ----------
  openChest(chest) {
    if (!chest.open()) return;
    this.openedChestIds.add(chest.id);
    this.audio.sfx('chest');
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
      this.audio.sfx('fanfare');
      this.hud.toast('You claimed the Shard of Power!');
      this.milestone(5);
    }
    this.save();
  }

  tryUnlockGate(dungeon) {
    if (dungeon.unlocked) return;
    if (this.inventory.useKey()) {
      dungeon.unlock();
      this.audio.sfx('unlock');
      this.hud.toast('The golden gate rises!');
      this.save();
    } else {
      this.audio.sfx('click');
      this.hud.toast('It is locked. A key must be near…');
    }
  }

  applyEquipment() {
    if (!this.player) return;
    this.player.hasShield = this.inventory.equipped.offhand === 'shield';
    this.player.swordDamage = 1;
  }

  // ---------- per-frame update ----------
  update() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();
    // Hit-stop: freeze-frame flavor on sword impact.
    let dt = rawDt;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      dt = rawDt * 0.12;
    }

    if (this.state === STATE.PLAYING) {
      this._handleGlobalKeys();
      this._updatePlaying(dt, elapsed);
    } else if (this.state === STATE.DIALOGUE) {
      this.dialogue.tick(rawDt, this.input);
    } else if (this.state === STATE.INVENTORY) {
      if (this.input.wasPressed('KeyI') || this.input.wasPressed('Escape')) {
        this.inventoryUI.close();
        this.state = STATE.PLAYING;
      }
    } else if (this.state === STATE.PAUSED) {
      if (this.input.wasPressed('Escape')) this.resume();
    }

    this.input.endFrame();
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
    const pp = this.player.group.position;

    // Attack input.
    if ((this.input.consumeClick() || this.input.wasPressed('KeyF')) && !this.player.attacking) {
      this.player.startAttack();
      this.audio.sfx('swing');
    }

    // Z-target lock-on.
    if (this.input.wasPressed('Tab')) this._toggleLock(area);
    if (this.lockEnemy && (this.lockEnemy.dead || this.lockEnemy.mesh.position.distanceTo(pp) > 26)) {
      this._clearLock();
    }

    this.cameraController.updateFromInput(this.input, dt);
    this.player.update(dt, this.input, this.cameraController);
    this._resolveCollisions(pp, area.colliders);

    // Roll feedback (sound + dust).
    if (this.player.justRolled) {
      this.player.justRolled = false;
      this.audio.sfx('roll');
      this.particles.burst(pp.clone(), 0xcbb48a, 6, 2.5, 0.4, 0.26);
    }

    // ---- Combat with feedback events ----
    const ev = Combat.resolve(this.player, area.enemies, dt);
    for (const h of ev.hits) {
      this.audio.sfx('hit');
      this.particles.burst(h.position, 0xffe08a, 8, 5, 0.4);
      this.hitstop = Math.max(this.hitstop, 0.055);
      this.shake.add(0.22);
    }
    for (const k of ev.kills) {
      const at = k.position.clone();
      at.y += 1;
      this.particles.burst(at, 0xcfe8ff, 16, 6, 0.6);
      this._spawnDrops(area, k);
      if (k.isBoss) {
        this.audio.sfx('fanfare');
        this.hud.toast('Gorlok the Vault-Keeper is vanquished!');
        this.shake.add(0.65);
        this.milestone(4);
        this.save();
      }
    }
    if (ev.playerHit) {
      this.audio.sfx('hurt');
      this.shake.add(0.45);
      const at = pp.clone();
      at.y += 1.2;
      this.particles.burst(at, 0xff6a5a, 10, 4, 0.5);
    }
    if (ev.blocked) {
      this.audio.sfx('block');
      const at = pp.clone();
      at.y += 1.1;
      this.particles.burst(at, 0x9ecbff, 8, 4, 0.35);
      this.shake.add(0.12);
    }
    this._removeDeadEnemies(area);

    // Pickups.
    this._updatePickups(area, dt);

    // Ambient world + shadow focus.
    area.setShadowFocus(pp);
    area.update(dt, elapsed);

    // Interactions.
    this._updateInteractions(area);

    // Camera, shake, reticle.
    this.cameraController.follow(this.player, dt);
    this.shake.update(dt, this.camera);
    if (this.lockEnemy) {
      const em = this.lockEnemy.mesh;
      this.reticle.position.copy(em.position);
      this.reticle.position.y += 2.3 * em.scale.y;
      this.reticle.quaternion.copy(this.camera.quaternion);
      const pulse = 1 + Math.sin(elapsed * 7) * 0.12;
      this.reticle.scale.setScalar(pulse);
    }

    // FX + HUD.
    this.particles.update(dt);
    this.hud.update(this.player, this.inventory);
    this._updateBossBar(area, pp);
    if (area.name === 'overworld') {
      this.minimap.draw(area, pp, this.player.facing, area.enemies);
      const rn = area.regionAt(pp);
      if (rn !== this._region) {
        this._region = rn;
        this.hud.splashRegion(rn);
      }
    }
    this._syncMood();

    // Death — forgiving respawn.
    if (this.player.health <= 0) this._onDeath();

    // Autosave.
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
      this.autosaveTimer = 0;
      this.save();
    }
  }

  _updateBossBar(area, pp) {
    let boss = null;
    for (const e of area.enemies) {
      if (e.isBoss && !e.dead) { boss = e; break; }
    }
    if (boss && boss.mesh.position.distanceTo(pp) < 26) {
      this.hud.setBoss(boss.displayName || 'Boss', boss.hp / boss.maxHp);
    } else {
      this.hud.setBoss(null);
    }
  }

  _syncMood() {
    const target = this.activeArea.name === 'dungeon'
      ? 'dungeon'
      : (this.areas.overworld.dayFactor > 0.4 ? 'day' : 'night');
    if (this.audio.mood !== target) this.audio.setMood(target);
  }

  _toggleLock(area) {
    if (this.lockEnemy) { this._clearLock(); return; }
    const pp = this.player.group.position;
    let best = null, bestD = 20;
    for (const e of area.enemies) {
      if (e.dead) continue;
      const d = e.mesh.position.distanceTo(pp);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      this.lockEnemy = best;
      this.player.lockTarget = best;
      this.cameraController.lockTarget = best;
      this.reticle.visible = true;
      this.audio.sfx('lock');
    }
  }

  _clearLock() {
    this.lockEnemy = null;
    if (this.player) this.player.lockTarget = null;
    if (this.cameraController) this.cameraController.lockTarget = null;
    if (this.reticle) this.reticle.visible = false;
  }

  _spawnDrops(area, drop) {
    if (drop.dropsKey) {
      const p = new Pickup('key', drop.position.x, drop.position.y + 0.6, drop.position.z);
      area.pickups.push(p);
      area.group.add(p.mesh);
    }
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
        if (e === this.lockEnemy) this._clearLock();
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
      this.audio.sfx('rupee');
      this.hud.toast(`+${p.value} rupee${p.value > 1 ? 's' : ''}`);
    } else if (p.type === 'heart') {
      this.player.heal(2);
      this.audio.sfx('heart');
      this.hud.toast('Recovered a heart');
    } else if (p.type === 'key') {
      this.inventory.add('key', 1);
      this.audio.sfx('key');
      this.hud.toast('Found a Small Key!');
      this.milestone(3);
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
    this.audio.sfx('die');
    this._clearLock();
    this.player.health = this.player.maxHealth;
    const spawn = this.activeArea.spawn.clone();
    spawn.y = this.activeArea.terrain.getHeightAt(spawn.x, spawn.z);
    this.player.group.position.copy(spawn);
    this.player.knockback.set(0, 0, 0);
    this.player.invuln = 1.5;
    this.cameraController.snap(this.player);
    this.hud.toast('You fell… and awoke back at the village.');
    this.save();
  }

  // ---------- persistence ----------
  snapshot() {
    const pp = this.player.group.position;
    return {
      area: this.activeArea.name,
      quest: this.quest,
      timeOfDay: this.areas.overworld.dayTime,
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
