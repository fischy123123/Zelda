// UI — the orchestrator for every DOM layer of Aurelia: HUD, menus, dialogue,
// minimap and touch controls. Owns styles.css. Everything lives inside
// #ui-root (pointer-events: none — interactive elements opt back in).

import { HUD } from './HUD.js';
import { Menus } from './Menus.js';
import { Dialogue } from './Dialogue.js';
import { Minimap } from './Minimap.js';
import { Touch } from './Touch.js';

const UI_STORE = 'aurelia-ui-v1';

/** Tiny DOM helper shared by every UI file. */
export function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/** SVG element helper (hearts, stamina wheel). */
export function svgEl(tag, attrs, parent) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.root.innerHTML = '';

    // Persisted UI preferences (audio volumes persist in the audio engine).
    this.prefs = { invertY: false };
    try {
      const saved = JSON.parse(localStorage.getItem(UI_STORE) || 'null');
      if (saved && typeof saved === 'object') Object.assign(this.prefs, saved);
    } catch (e) { /* private mode — defaults are fine */ }

    this._installInvertY();

    // Layers (z-order handled in CSS; construction order groups DOM sensibly).
    this.hud = new HUD(game, this);
    this.minimap = new Minimap(game, this);
    this.dialogue = new Dialogue(game, this);
    this.touch = new Touch(game, this);
    this.menus = new Menus(game, this);

    // Fullscreen fade overlay — topmost, used by fadeTo().
    this._fadeEl = el('div', 'ui-fade', this.root);
    this._fading = false;
    this._fadeT1 = 0;
    this._fadeT2 = 0;

    // Any modal opening should free the mouse cursor.
    game.events.on('modal', (p) => { if (p && p.open) game.input.exitPointerLock(); });
  }

  // -------------------------------------------------------------------------
  savePrefs() {
    try { localStorage.setItem(UI_STORE, JSON.stringify(this.prefs)); } catch (e) { /* ignore */ }
  }

  /** Menu blip shorthand — routed through the event bus to the AudioEngine. */
  sfx(name) { this.game.events.emit('ui:sfx', { name }); }

  /**
   * Fade to black, run cb at full darkness, fade back. Bulletproof: the
   * overlay is always released even if cb throws, and nested calls simply run
   * their callback immediately rather than wedging the screen.
   */
  fadeTo(cb, ms = 400) {
    const f = this._fadeEl;
    const run = () => {
      try { if (cb) cb(); }
      catch (err) { console.error('[ui] fadeTo callback threw', err); }
    };
    if (this._fading) { run(); return; }
    this._fading = true;
    clearTimeout(this._fadeT1);
    clearTimeout(this._fadeT2);
    f.style.transitionDuration = `${ms}ms`;
    f.classList.add('on');
    this._fadeT1 = setTimeout(() => {
      try { run(); }
      finally {
        f.classList.remove('on');
        this._fadeT2 = setTimeout(() => { this._fading = false; }, ms + 80);
      }
    }, ms + 30);
  }

  // -------------------------------------------------------------------------
  // Invert-Y support: the core camera does not read a flag, so we define
  // `cameraRig.invertY` (as allowed by the contract) and wrap its update to
  // flip the vertical look delta before the rig consumes it.
  _installInvertY() {
    const rig = this.game.cameraRig;
    rig.invertY = !!this.prefs.invertY;
    const orig = rig.update;
    rig.update = function (dt, input, player, timeScale) {
      if (this.invertY && input && input.look) input.look.dy = -input.look.dy;
      return orig.call(this, dt, input, player, timeScale);
    };
  }

  // -------------------------------------------------------------------------
  update(rawDt) {
    this.hud.update(rawDt);
    this.minimap.update(rawDt);
    this.dialogue.update(rawDt);
    this.menus.update(rawDt);
    this.touch.update(rawDt);
  }
}
