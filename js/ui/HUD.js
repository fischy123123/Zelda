// HUD — hearts, stamina wheel, counters, prompts, objective, region splash,
// boss bar, toasts, sign panel and the day sun-dial. Pure DOM; all values are
// change-detected so per-frame work is near zero when nothing moves.

import { el, svgEl } from './UI.js';
import { clamp, clamp01 } from '../util/math.js';

const HEART_PATH =
  'M50 88 C22 66 6 48 6 30 C6 15 17 6 29 6 C38 6 46 11 50 20 ' +
  'C54 11 62 6 71 6 C83 6 94 15 94 30 C94 48 78 66 50 88 Z';
const STAMINA_R = 28;
const STAMINA_C = 2 * Math.PI * STAMINA_R;

let heartUid = 0;

export class HUD {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;

    const root = this.rootEl = el('div', 'hud', ui.root);

    // --- top-left: hearts + counters ---------------------------------------
    const tl = el('div', 'hud-tl', root);
    this.heartsEl = el('div', 'hearts', tl);
    this._hearts = [];
    const counters = el('div', 'counters', tl);
    const gemC = el('div', 'counter gems', counters);
    el('span', 'c-icon c-gem', gemC);
    this.gemText = el('span', 'c-num', gemC, '0');
    const keyC = el('div', 'counter keys', counters);
    el('span', 'c-icon c-key', keyC);
    this.keyText = el('span', 'c-num', keyC, '0');

    // --- stamina wheel (appears near the hero when spending) ----------------
    const stam = this.stamEl = svgEl('svg', { viewBox: '0 0 72 72', class: 'stamina' });
    root.appendChild(stam);
    svgEl('circle', { cx: 36, cy: 36, r: STAMINA_R, class: 'st-bg' }, stam);
    this.stamFg = svgEl('circle', {
      cx: 36, cy: 36, r: STAMINA_R, class: 'st-fg',
      'stroke-dasharray': STAMINA_C.toFixed(2),
    }, stam);

    // --- top-right: objective + sun-dial ------------------------------------
    const tr = el('div', 'hud-tr', root);
    this.objEl = el('div', 'objective', tr);
    this.objTitle = el('div', 'obj-title', this.objEl);
    this.objText = el('div', 'obj-text', this.objEl);
    const dialWrap = el('div', 'sundial-wrap', tr);
    const dial = el('div', 'sundial', dialWrap);
    this.dialDisc = el('div', 'dial-disc', dial);
    el('span', 'dial-sun', this.dialDisc);
    el('span', 'dial-moon', this.dialDisc);
    el('div', 'dial-ground', dial);
    this.dayLabel = el('div', 'day-label', dialWrap, 'Day 1');

    // --- boss bar ------------------------------------------------------------
    this.bossEl = el('div', 'boss', root);
    this.bossName = el('div', 'boss-name', this.bossEl);
    const track = el('div', 'boss-track', this.bossEl);
    this.bossGhost = el('div', 'boss-ghost', track);
    this.bossFill = el('div', 'boss-fill', track);
    el('div', 'boss-segs', track);

    // --- quest banner + region splash + toasts ------------------------------
    this.questBanner = el('div', 'quest-banner', root);
    this.qbKicker = el('div', 'qb-kicker', this.questBanner);
    this.qbTitle = el('div', 'qb-title', this.questBanner);
    this.regionEl = el('div', 'region-splash', root);
    this.regionName = el('h2', null, this.regionEl);
    el('div', 'rs-line', this.regionEl);
    this.toastWrap = el('div', 'toasts', root);

    // --- prompt chip ---------------------------------------------------------
    this.promptEl = el('div', 'prompt-chip', root);
    this.promptKey = el('kbd', 'pc-key', this.promptEl, 'E');
    this.promptLabel = el('span', 'pc-label', this.promptEl);

    // --- sign panel ----------------------------------------------------------
    this.signEl = el('div', 'sign-panel', root);
    el('div', 'sp-orn', this.signEl, '✦');
    this.signText = el('div', 'sp-text', this.signEl);
    this.signHint = el('div', 'sp-hint', this.signEl, 'E — close');
    this.signEl.addEventListener('click', () => this._closeSign());

    // --- state ---------------------------------------------------------------
    this._lastHp = -1;
    this._lastMaxHp = -1;
    this._gemDisp = 0;
    this._keyDisp = 0;
    this._stamHide = 0;
    this._stamEmpty = false;
    this._stamVisible = false;
    this._objKey = null;
    this._objPoll = 0;
    this._dialRot = null;
    this._lastDay = 0;
    this._bossOn = false;
    this._bossTarget = 1;
    this._bossDisp = 1;
    this._bossGhostV = 1;
    this._signOpen = false;
    this._signAt = 0;
    this._visible = null;
    this._dimmed = null;
    this._promptOn = false;

    this._wireEvents();
  }

  // -------------------------------------------------------------------------
  _wireEvents() {
    const ev = this.game.events;

    ev.on('player:damage', () => {
      this.heartsEl.classList.remove('hurt');
      void this.heartsEl.offsetWidth;
      this.heartsEl.classList.add('hurt');
    });
    ev.on('player:heal', () => {
      this.heartsEl.classList.remove('healed');
      void this.heartsEl.offsetWidth;
      this.heartsEl.classList.add('healed');
    });

    ev.on('gems', () => this._pop(this.gemText));
    ev.on('keys', () => this._pop(this.keyText));

    ev.on('prompt', (text) => this._setPrompt(text));

    ev.on('region:enter', (p) => {
      if (!p || !p.name || this.game.mode !== 'playing') return;
      this.regionName.textContent = p.name;
      this.regionEl.classList.remove('show');
      void this.regionEl.offsetWidth;
      this.regionEl.classList.add('show');
    });

    ev.on('toast', (p) => { if (p && p.text) this.toast(p.text); });
    ev.on('item:added', (p) => {
      if (p) this.toast(`✦ ${p.name || this._pretty(p.id)} acquired`);
    });
    ev.on('chest:locked', () => this.toast('Locked tight — it needs a key.'));
    ev.on('quest:updated', (p) => {
      if (p) this.toast(`${p.title || 'Quest'} — ${p.text || 'updated'}`);
    });
    ev.on('quest:started', (p) => this._questBanner('Quest Begun', p && p.title));
    ev.on('quest:completed', (p) => this._questBanner('Quest Complete', p && p.title));

    ev.on('boss:start', (p) => {
      this._bossOn = true;
      this._bossTarget = this._bossDisp = this._bossGhostV = 1;
      this.bossName.textContent = (p && p.name) || 'Ancient Horror';
      this.bossEl.classList.remove('victory');
      this.bossEl.classList.add('on');
    });
    ev.on('boss:hp', (p) => {
      if (p && typeof p.frac === 'number') this._bossTarget = clamp01(p.frac);
    });
    ev.on('boss:end', (p) => {
      this._bossOn = false;
      if (p && p.victory) {
        this.bossEl.classList.add('victory');
        setTimeout(() => this.bossEl.classList.remove('on'), 900);
      } else {
        this.bossEl.classList.remove('on');
      }
    });
    ev.on('dungeon:exit', () => { this._bossOn = false; this.bossEl.classList.remove('on'); });
    ev.on('game:start', () => {
      // Snap counters so continue-game doesn't count up from zero.
      this._gemDisp = this.game.state.gems;
      this._keyDisp = this.game.state.keys;
      this._bossOn = false;
      this.bossEl.classList.remove('on');
      this._closeSign();
      this._objKey = null;
      this._objPoll = 0;
    });

    ev.on('sign:read', (p) => {
      if (!p || !p.text) return;
      this.signText.textContent = p.text;
      this.signEl.classList.add('on');
      this._signOpen = true;
      this._signAt = performance.now();
    });
  }

  _pop(node) {
    const parent = node.parentNode;
    parent.classList.remove('pop');
    void parent.offsetWidth;
    parent.classList.add('pop');
  }

  _pretty(id) {
    if (!id) return 'Something';
    const s = String(id).replace(/[-_]/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  _questBanner(kicker, title) {
    this.qbKicker.textContent = kicker;
    this.qbTitle.textContent = title || '';
    this.questBanner.classList.remove('on');
    void this.questBanner.offsetWidth;
    this.questBanner.classList.add('on');
    clearTimeout(this._qbTimer);
    this._qbTimer = setTimeout(() => this.questBanner.classList.remove('on'), 3400);
  }

  toast(text) {
    const wrap = this.toastWrap;
    while (wrap.children.length >= 4) wrap.removeChild(wrap.firstChild);
    const t = el('div', 'toast', wrap, text);
    void t.offsetWidth;
    t.classList.add('in');
    setTimeout(() => t.classList.add('out'), 3400);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 3800);
  }

  _setPrompt(text) {
    const on = !!text;
    if (on) this.promptLabel.textContent = text;
    if (on !== this._promptOn) {
      this._promptOn = on;
      this.promptEl.classList.toggle('on', on);
    }
  }

  _closeSign() {
    if (!this._signOpen) return;
    this._signOpen = false;
    this.signEl.classList.remove('on');
  }

  // -------------------------------------------------------------------------
  update(rawDt) {
    const g = this.game;
    const s = g.state;

    const visible = g.mode === 'playing';
    if (visible !== this._visible) {
      this._visible = visible;
      this.rootEl.classList.toggle('on', visible);
    }
    if (!visible) return;

    const dimmed = g.modals.size > 0;
    if (dimmed !== this._dimmed) {
      this._dimmed = dimmed;
      this.rootEl.classList.toggle('dimmed', dimmed);
    }

    this._updateHearts(s);
    this._updateStamina(s, rawDt);
    this._updateCounters(s, rawDt);
    this._updateObjective(rawDt);
    this._updateSundial();
    this._updateBoss(rawDt);
    this._updateSign();
  }

  _updateHearts(s) {
    if (s.maxHp !== this._lastMaxHp) {
      this._lastMaxHp = s.maxHp;
      const n = Math.ceil(s.maxHp / 4);
      while (this._hearts.length < n) this._hearts.push(this._makeHeart());
      while (this._hearts.length > n) {
        const h = this._hearts.pop();
        h.svg.remove();
      }
      this._lastHp = -1;
    }
    if (s.hp !== this._lastHp) {
      this._lastHp = s.hp;
      for (let i = 0; i < this._hearts.length; i++) {
        const q = clamp(s.hp - i * 4, 0, 4);
        const h = this._hearts[i];
        if (h.q !== q) {
          h.q = q;
          h.rect.setAttribute('width', q * 25);
          h.svg.classList.toggle('drained', q === 0);
        }
      }
      this.heartsEl.classList.toggle('low', s.hp <= 4 && s.hp > 0);
    }
  }

  _makeHeart() {
    const id = `hq${heartUid++}`;
    const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'heart' });
    const defs = svgEl('defs', null, svg);
    const clip = svgEl('clipPath', { id }, defs);
    const rect = svgEl('rect', { x: 0, y: 0, width: 100, height: 100 }, clip);
    svgEl('path', { d: HEART_PATH, class: 'h-bg' }, svg);
    svgEl('path', { d: HEART_PATH, class: 'h-fill', 'clip-path': `url(#${id})` }, svg);
    this.heartsEl.appendChild(svg);
    return { svg, rect, q: -1 };
  }

  _updateStamina(s, rawDt) {
    const frac = clamp01(s.stamina / s.maxStamina);
    const spending = frac < 0.995;
    if (spending) this._stamHide = 0.45;
    else this._stamHide = Math.max(0, this._stamHide - rawDt);
    const show = spending || this._stamHide > 0;
    if (show !== this._stamVisible) {
      this._stamVisible = show;
      this.stamEl.classList.toggle('show', show);
    }
    if (show) {
      this.stamFg.style.strokeDashoffset = (STAMINA_C * (1 - frac)).toFixed(2);
      if (s.stamina <= 0.5 && !this._stamEmpty) {
        this._stamEmpty = true;
        this.stamEl.classList.add('empty');
      } else if (this._stamEmpty && s.stamina > 22) {
        this._stamEmpty = false;
        this.stamEl.classList.remove('empty');
      }
      this.stamEl.classList.toggle('low', frac < 0.3 && !this._stamEmpty);
    }
  }

  _updateCounters(s, rawDt) {
    this._gemDisp = this._countUp(this._gemDisp, s.gems, rawDt);
    this._keyDisp = this._countUp(this._keyDisp, s.keys, rawDt);
    const gTxt = String(Math.round(this._gemDisp));
    if (this.gemText.textContent !== gTxt) this.gemText.textContent = gTxt;
    const kTxt = String(Math.round(this._keyDisp));
    if (this.keyText.textContent !== kTxt) this.keyText.textContent = kTxt;
  }

  _countUp(cur, target, dt) {
    if (cur === target) return cur;
    const d = target - cur;
    if (Math.abs(d) < 0.6) return target;
    return cur + d * Math.min(1, dt * 9);
  }

  _updateObjective(rawDt) {
    this._objPoll -= rawDt;
    if (this._objPoll > 0) return;
    this._objPoll = 0.5;
    let obj = null;
    try {
      const q = this.game.quests;
      if (q && typeof q.activeObjective === 'function') obj = q.activeObjective();
    } catch (e) { obj = null; }
    const key = obj ? `${obj.title}|${obj.text}` : null;
    if (key === this._objKey) return;
    this._objKey = key;
    if (obj) {
      this.objTitle.textContent = obj.title || 'Objective';
      this.objText.textContent = obj.text || '';
      this.objEl.classList.remove('show');
      void this.objEl.offsetWidth;
      this.objEl.classList.add('show');
    } else {
      this.objEl.classList.remove('show');
    }
  }

  _updateSundial() {
    const sky = this.game.sky;
    if (!sky) return;
    const t = typeof sky.timeOfDay === 'number' ? sky.timeOfDay : 0.5;
    const rot = Math.round((t - 0.5) * 360);
    if (rot !== this._dialRot) {
      this._dialRot = rot;
      this.dialDisc.style.transform = `rotate(${rot}deg)`;
    }
    const day = this.game.state.day;
    if (day !== this._lastDay) {
      this._lastDay = day;
      this.dayLabel.textContent = `Day ${day}`;
    }
  }

  _updateBoss(rawDt) {
    if (!this._bossOn && this._bossDisp <= 0.001) return;
    const k = Math.min(1, rawDt * 7);
    this._bossDisp += (this._bossTarget - this._bossDisp) * k;
    this._bossGhostV += (this._bossTarget - this._bossGhostV) * Math.min(1, rawDt * 1.8);
    this.bossFill.style.width = `${(this._bossDisp * 100).toFixed(1)}%`;
    this.bossGhost.style.width = `${(this._bossGhostV * 100).toFixed(1)}%`;
  }

  _updateSign() {
    if (!this._signOpen) return;
    const g = this.game;
    const input = g.input;
    const aged = performance.now() - this._signAt > 300;
    if (aged && (input.pressed('interact') || input.pressed('attack') ||
        input.pressed('jump') || input.pressed('roll') || input.pressed('pause'))) {
      this._closeSign();
      return;
    }
    if (g.player.horizontalSpeed > 3.2 || g.uiBlocked) this._closeSign();
  }
}
