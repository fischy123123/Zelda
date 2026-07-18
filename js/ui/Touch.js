// Touch controls — floating left stick (writes input.virtual.x/z), drag-look
// on the right half (virtual.lookDx/dy), and a cluster of ≥56px buttons:
// attack (hold to charge), jump, roll, guard (hold), lock-on, a contextual
// interact pill, plus pause/inventory up top. Shown only for coarse pointers
// or once a touch is seen, and only while actually playing.

import { el } from './UI.js';

const STICK_RADIUS = 52;
const LOOK_SENS = 2.3;

export class Touch {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.coarse = matchMedia('(pointer: coarse)').matches;

    const layer = this.layer = el('div', 'touch', ui.root);
    layer.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- left stick ----------------------------------------------------------
    this.stickZone = el('div', 't-stick-zone', layer);
    this.stickBase = el('div', 't-stick-base', this.stickZone);
    this.stickKnob = el('div', 't-stick-knob', this.stickBase);
    this._stickId = null;
    this._stickOx = 0;
    this._stickOy = 0;

    this.stickZone.addEventListener('pointerdown', (e) => this._stickDown(e));
    this.stickZone.addEventListener('pointermove', (e) => this._stickMove(e));
    this.stickZone.addEventListener('pointerup', (e) => this._stickUp(e));
    this.stickZone.addEventListener('pointercancel', (e) => this._stickUp(e));

    // --- right-half look drag ------------------------------------------------
    this.lookZone = el('div', 't-look-zone', layer);
    this._lookId = null;
    this._lookX = 0;
    this._lookY = 0;
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this._lookId !== null) return;
      this._lookId = e.pointerId;
      this._lookX = e.clientX;
      this._lookY = e.clientY;
      this.lookZone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId) return;
      const v = this.game.input.virtual;
      v.lookDx += (e.clientX - this._lookX) * LOOK_SENS;
      v.lookDy += (e.clientY - this._lookY) * LOOK_SENS;
      this._lookX = e.clientX;
      this._lookY = e.clientY;
    });
    const lookEnd = (e) => { if (e.pointerId === this._lookId) this._lookId = null; };
    this.lookZone.addEventListener('pointerup', lookEnd);
    this.lookZone.addEventListener('pointercancel', lookEnd);

    // --- action buttons ------------------------------------------------------
    this.btnAttack = this._mkBtn('t-btn tb-attack', '⚔', 'attack', { hold: true });
    this.btnGuard = this._mkBtn('t-btn tb-guard', 'GUARD', 'guard', { hold: true });
    this.btnJump = this._mkBtn('t-btn tb-jump', 'JUMP', 'jump');
    this.btnRoll = this._mkBtn('t-btn tb-roll', 'ROLL', 'roll');
    this.btnLock = this._mkBtn('t-btn tb-lock', '◎', 'lockon');

    // Contextual interact pill — label follows the interaction prompt.
    this.btnInteract = this._mkBtn('t-btn tb-interact', 'Interact', 'interact');
    game.events.on('prompt', (text) => {
      if (text) this.btnInteract.textContent = text;
      this.btnInteract.classList.toggle('ctx', !!text);
    });

    // --- system buttons (top edge) ------------------------------------------
    const top = el('div', 't-top', layer);
    this.btnPause = this._mkBtn('t-btn tb-sys', '❚❚', 'pause', { parent: top });
    this.btnInv = this._mkBtn('t-btn tb-sys', '▤', 'inventory', { parent: top });

    this._enabled = null;
    this._shown = null;
  }

  // -------------------------------------------------------------------------
  _mkBtn(cls, label, action, opts = {}) {
    const b = el('div', cls, opts.parent || this.layer, label);
    const input = this.game.input;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('pressed');
      input.virtualPress(action);
      if (opts.hold) input.virtual.held.add(action);
    });
    const up = (e) => {
      if (e) e.preventDefault();
      b.classList.remove('pressed');
      if (opts.hold) input.virtual.held.delete(action);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  }

  // --- stick ----------------------------------------------------------------
  _stickDown(e) {
    if (this._stickId !== null) return;
    this._stickId = e.pointerId;
    this.stickZone.setPointerCapture(e.pointerId);
    const zr = this.stickZone.getBoundingClientRect();
    const bx = Math.max(70, Math.min(zr.width - 70, e.clientX - zr.left));
    const by = Math.max(70, Math.min(zr.height - 70, e.clientY - zr.top));
    this._stickOx = zr.left + bx;
    this._stickOy = zr.top + by;
    this.stickBase.style.left = `${bx}px`;
    this.stickBase.style.top = `${by}px`;
    this.stickBase.classList.add('live');
    this._applyStick(e.clientX, e.clientY);
    e.preventDefault();
  }

  _stickMove(e) {
    if (e.pointerId !== this._stickId) return;
    this._applyStick(e.clientX, e.clientY);
  }

  _applyStick(cx, cy) {
    let dx = cx - this._stickOx;
    let dy = cy - this._stickOy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    this.stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const v = this.game.input.virtual;
    v.x = dx / STICK_RADIUS;
    v.z = dy / STICK_RADIUS;
    // Pushed hard to the rim → sprint.
    if (len / STICK_RADIUS > 0.94) v.held.add('sprint');
    else v.held.delete('sprint');
    this.game.input.usingTouch = true;
  }

  _stickUp(e) {
    if (e.pointerId !== this._stickId) return;
    this._stickId = null;
    const v = this.game.input.virtual;
    v.x = 0;
    v.z = 0;
    v.held.delete('sprint');
    this.stickKnob.style.transform = 'translate(0px, 0px)';
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.stickBase.classList.remove('live');
  }

  _releaseAll() {
    const v = this.game.input.virtual;
    v.x = 0;
    v.z = 0;
    v.held.delete('sprint');
    v.held.delete('attack');
    v.held.delete('guard');
    this._stickId = null;
    this._lookId = null;
    this.stickKnob.style.transform = 'translate(0px, 0px)';
    this.stickBase.classList.remove('live');
    this.btnAttack.classList.remove('pressed');
    this.btnGuard.classList.remove('pressed');
  }

  // -------------------------------------------------------------------------
  update() {
    const g = this.game;
    const enabled = g.input.usingTouch || this.coarse;
    if (enabled !== this._enabled) {
      this._enabled = enabled;
      document.body.classList.toggle('touch-mode', enabled);
    }
    const show = enabled && g.mode === 'playing' && !g.uiBlocked;
    if (show !== this._shown) {
      this._shown = show;
      this.layer.classList.toggle('on', show);
      if (!show) this._releaseAll();
    }
  }
}
