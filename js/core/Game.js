// The orchestrator: owns the renderer, scene, module lifecycle and the main
// loop. Every subsystem hangs off this object — `game` is the shared context
// passed to all module constructors (see docs/CONTRACTS.md).

import * as THREE from 'three';
import { Emitter } from '../util/events.js';
import { clamp, damp } from '../util/math.js';
import { windUniforms } from '../gfx/Toon.js';
import { Input } from './Input.js';
import { Colliders } from './Colliders.js';
import { Save } from './Save.js';
import { Terrain } from '../world/Terrain.js';
import { World } from '../world/World.js';
import { SPAWN, SITES, WORLD } from '../world/layout.js';
import { Player } from '../entities/Player.js';
import { ThirdPersonCamera } from '../systems/Camera.js';
import { Combat } from '../systems/Combat.js';
import { Interact } from '../systems/Interact.js';
// Module teams (built against docs/CONTRACTS.md):
import { Sky } from '../gfx/Sky.js';
import { Water } from '../gfx/Water.js';
import { Vegetation } from '../gfx/Vegetation.js';
import { Particles } from '../gfx/Particles.js';
import { PostFX } from '../gfx/PostFX.js';
import { HeroModel } from '../entities/HeroModel.js';
import { Voice } from './Voice.js';
import { Village } from '../world/Village.js';
import { Dungeon } from '../world/Dungeon.js';
import { Quests } from '../systems/Quests.js';
import { AudioEngine } from './AudioEngine.js';
import { UI } from '../ui/UI.js';

function freshState() {
  return {
    hp: 12, maxHp: 12,             // quarter-hearts (12 = 3 hearts)
    stamina: 100, maxStamina: 100,
    gems: 0, keys: 0,
    sword: 'bronze',
    items: { potion: 1 },
    quests: {},
    flags: {},
    day: 1,
    playTime: 0,
  };
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.events = new Emitter();
    this.state = freshState();
    this.mode = 'title';            // title | playing | dead
    this.modals = new Set();        // 'pause' | 'dialogue' | 'inventory' | ...
    this.inDungeon = false;
    this.enemies = [];
    this.pickups = [];
    this.timeScale = 1;
    this._hitstop = 0;
    this.quality = this._detectQuality();
    this.debug = new URLSearchParams(location.search).has('debug');

    // --- renderer -----------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2200);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // --- core systems -------------------------------------------------------
    this.input = new Input(canvas);
    this.colliders = new Colliders();
    this.terrain = new Terrain(this.scene);
    this.player = new Player(this);
    this.cameraRig = new ThirdPersonCamera(this.camera, this.terrain);
    this.combat = new Combat(this);
    this.interact = new Interact(this);

    // --- module teams -------------------------------------------------------
    this.sky = new Sky(this);
    this.water = new Water(this);
    this.vegetation = new Vegetation(this);
    this.particles = new Particles(this);
    this.audio = new AudioEngine(this);
    this.voice = new Voice(this);
    this.world = new World(this);
    this.village = new Village(this);
    this.dungeon = new Dungeon(this);
    this.quests = new Quests(this);

    this.hero = new HeroModel(this);
    this.player.model = this.hero;
    this.scene.add(this.hero.group);

    this.postfx = new PostFX(this);
    this.ui = new UI(this);

    // --- spawn --------------------------------------------------------------
    this.player.respawn(SPAWN.x, SPAWN.z, Math.PI);
    this.cameraRig.snapBehind(this.player, 0.3);

    // Audio unlock. Mobile browsers (iOS Safari especially) routinely ignore
    // the first attempt, and a context that started fine can be suspended
    // again by backgrounding the tab or an incoming call — so keep retrying on
    // every gesture until sound is genuinely running, and re-check on return.
    const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'];
    const unlock = () => {
      this.audio.resume?.();
      if (this.audio.running) {
        for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, unlock);
      }
    };
    for (const ev of UNLOCK_EVENTS) {
      window.addEventListener(ev, unlock, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.audio.resume?.();
    });
    window.addEventListener('pageshow', () => this.audio.resume?.());

    this._wireEvents();

    this._clock = new THREE.Clock();
    this._accumSave = 0;
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // -------------------------------------------------------------------------
  get uiBlocked() { return this.mode !== 'playing' || this.modals.size > 0; }
  get paused() { return this.modals.has('pause'); }

  pushModal(name) { this.modals.add(name); this.events.emit('modal', { name, open: true }); }
  popModal(name) { this.modals.delete(name); this.events.emit('modal', { name, open: false }); }

  hitstop(seconds) { this._hitstop = Math.max(this._hitstop, seconds); }

  setGroundProvider(p) { this.player.groundProvider = p || this.terrain; }

  // --- game flow ------------------------------------------------------------
  newGame() {
    Save.clear();
    this.state = freshState();
    this.mode = 'playing';
    this.inDungeon = false;
    this.setGroundProvider(this.terrain);
    this.sky.setTimeOfDay?.(0.33);
    this.player.respawn(SPAWN.x, SPAWN.z, Math.PI);
    this.hero.setSword?.('bronze');
    this.cameraRig.snapBehind(this.player, 0.3);
    this.events.emit('game:start', { fresh: true });
  }

  continueGame() {
    const data = Save.read();
    if (!data) { this.newGame(); return; }
    this.state = { ...freshState(), ...data.state };
    this.mode = 'playing';
    this.inDungeon = false;
    this.setGroundProvider(this.terrain);
    this.sky.setTimeOfDay?.(data.timeOfDay ?? 0.33);
    const px = data.player?.x ?? SPAWN.x, pz = data.player?.z ?? SPAWN.z;
    this.player.respawn(px, pz, data.player?.yaw ?? 0);
    this.hero.setSword?.(this.state.sword);
    this.cameraRig.snapBehind(this.player);
    this.quests.restore?.();
    this.events.emit('game:start', { fresh: false });
  }

  save() { return Save.write(this); }
  hasSave() { return Save.exists(); }

  respawnPlayer() {
    // After death: back to the village with most hearts restored.
    this.mode = 'playing';
    if (this.inDungeon) this.dungeon.exit?.(true);
    this.state.hp = Math.max(8, Math.floor(this.state.maxHp * 0.75));
    this.state.stamina = this.state.maxStamina;
    this.player.respawn(SPAWN.x, SPAWN.z, Math.PI);
    this.cameraRig.snapBehind(this.player, 0.3);
  }

  useItem(id) {
    const s = this.state;
    if (!s.items[id]) return false;
    if (id === 'potion') {
      if (s.hp >= s.maxHp) { this.events.emit('toast', { text: 'Hearts are already full!' }); return false; }
      s.items.potion--;
      this.player.heal(12);
      this.events.emit('item:used', { id });
      return true;
    }
    return false;
  }

  addMaxHeart() {
    this.state.maxHp += 4;
    this.state.hp = this.state.maxHp;
    this.events.emit('player:heal', { hp: this.state.hp, container: true });
  }

  _wireEvents() {
    this.events.on('player:death', () => {
      this.mode = 'dead';
      this.cameraRig.shake(0.5);
    });
  }

  // -------------------------------------------------------------------------
  _frame() {
    const rawDt = Math.min(this._clock.getDelta(), 0.05);

    // Hitstop: world time briefly crawls for impact.
    if (this._hitstop > 0) {
      this._hitstop -= rawDt;
      this.timeScale = damp(this.timeScale, 0.08, 30, rawDt);
    } else {
      this.timeScale = damp(this.timeScale, 1, 14, rawDt);
    }

    const frozen = this.paused || this.modals.has('dialogue') || this.modals.has('inventory');
    const dt = frozen ? 0 : rawDt * this.timeScale;

    this.input.poll();
    windUniforms.time.value += dt;

    if (this.mode === 'playing') this._playFrame(dt, rawDt);
    else if (this.mode === 'title') this._titleFrame(rawDt);
    else if (this.mode === 'dead') this._deadFrame(rawDt);

    // Systems that always tick (visuals stay alive behind menus).
    this.sky.update(dt || rawDt * 0.15, this.player.position);
    this.water.update(dt || rawDt, this.camera);
    this.vegetation.update(dt || rawDt, this.player.position);
    this.particles.update(rawDt);
    this.audio.update(rawDt);
    this.ui.update(rawDt);

    this.postfx.render(rawDt);
    this.input.endFrame();
  }

  _playFrame(dt, rawDt) {
    const s = this.state;
    s.playTime += dt;

    // Global input handling.
    if (this.input.pressed('pause')) {
      if (this.modals.has('pause')) this.popModal('pause');
      else if (this.modals.size === 0) this.pushModal('pause');
    }
    if (!this.uiBlocked) {
      if (this.input.pressed('inventory')) this.pushModal('inventory');
      if (this.input.pressed('lockon')) this.combat.toggleLockOn();
      if (this.input.pointerLocked === false && !this.input.usingTouch && !this.input.usingGamepad) {
        // Click to (re)capture the mouse during play.
        if (this.input.pressed('attack')) this.input.requestPointerLock();
      }
    }

    if (dt > 0) {
      this.player.update(dt);
      this.player.noteDryLand();

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        e.update(dt, this);
        if (e.removed) this.enemies.splice(i, 1);
      }

      this.combat.update(dt);
      this.world.update(dt);
      this.world.updateChests(dt);
      this.village.update(dt);
      this.dungeon.update(dt);
      this.quests.update?.(dt);

      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i];
        p.update(dt);
        if (!p.alive) this.pickups.splice(i, 1);
      }

      this.interact.update();

      // Day counter driven by the sky's clock.
      if (this.sky.dayRolledOver) {
        s.day += 1;
        this.events.emit('day', { day: s.day });
      }

      // Periodic autosave near the village.
      this._accumSave += dt;
      if (this._accumSave > 20) {
        this._accumSave = 0;
        const dv = Math.hypot(this.player.position.x - SITES.village.x, this.player.position.z - SITES.village.z);
        if (dv < SITES.village.r && this.player.alive && !this.inDungeon) this.save();
      }
    }

    this.cameraRig.update(rawDt, this.input, this.player, this.timeScale);
  }

  _titleFrame(rawDt) {
    // Attract mode: slow aerial drift over the valley.
    const t = performance.now() * 0.001;
    const a = t * 0.03;
    const r = 150;
    this.camera.position.set(
      SITES.village.x + Math.sin(a) * r,
      this.terrain.heightAt(SITES.village.x + Math.sin(a) * r, SITES.village.z + Math.cos(a) * r) + 45,
      SITES.village.z + Math.cos(a) * r
    );
    this.camera.lookAt(SITES.village.x, 18, SITES.village.z);
    this.camera.fov = damp(this.camera.fov, 50, 2, rawDt);
    this.camera.updateProjectionMatrix();
    // Let the world simulate lightly so the vista is alive.
    for (const e of this.enemies) e.update(rawDt * 0.5, this);
  }

  _deadFrame(rawDt) {
    // Slow orbit around the fallen hero while the UI shows the death screen.
    this.player.update(rawDt * 0.2);
    this.cameraRig.update(rawDt, { look: { dx: 6, dy: 0 }, wheel: 0, pressed: () => false, held: () => false }, this.player);
  }

  // -------------------------------------------------------------------------
  _detectQuality() {
    const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);
    const smallScreen = Math.min(screen.width, screen.height) < 500;
    return mobile || smallScreen ? 'low' : 'high';
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = clamp(window.devicePixelRatio || 1, 1, this.quality === 'low' ? 1.6 : 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx?.setSize(w, h);
  }
}
