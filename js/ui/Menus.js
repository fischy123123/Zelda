// Menus — title screen (over the live attract vista), pause, settings,
// how-to-play, death screen and the inventory modal. One screen is active at
// a time; keyboard, mouse and touch all drive the same focus model.

import { el } from './UI.js';
import { clamp } from '../util/math.js';

const ITEMS = {
  potion: {
    name: 'Restorative Potion',
    desc: 'A warm red draught brewed by Nyla — mends three hearts.',
    icon: 'icon-potion',
    use: true,
  },
  glowshroom: {
    name: 'Glowshroom',
    desc: 'A softly glowing forest cap, prized by healers of Brindlemere.',
    icon: 'icon-shroom',
  },
};

const QUEST_TITLES = {
  'shattered-star': 'The Shattered Star',
  'mushroom-medicine': 'Mushroom Medicine',
  'thin-the-horde': 'Thin the Horde',
};

const HOWTO_ROWS = [
  ['W A S D', 'Move'],
  ['Mouse / drag', 'Camera'],
  ['LMB / J', 'Attack — hold after a swing to charge a spin'],
  ['RMB / K', 'Guard'],
  ['Space', 'Jump'],
  ['Shift', 'Sprint'],
  ['C / Ctrl', 'Roll (dodge with grace)'],
  ['E', 'Interact'],
  ['Tab / Q', 'Lock-on'],
  ['I', 'Inventory'],
  ['M', 'Map zoom'],
  ['Esc', 'Pause'],
];

export class Menus {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;

    this.layer = el('div', 'menus', ui.root);
    this._screens = {};
    this._current = null;
    this._overlay = null;      // 'settings' | 'howto' overlay over title/pause
    this._openedAt = 0;
    this._focusList = [];
    this._focusIdx = 0;
    this._invSel = null;

    this._buildTitle();
    this._buildPause();
    this._buildSettings();
    this._buildHowto();
    this._buildDeath();
    this._buildInventory();

    window.addEventListener('keydown', (e) => this._onKey(e));

    const ev = game.events;
    ev.on('modal', () => this._sync());
    ev.on('item:used', () => { if (this._current === 'inventory') this._refreshInventory(); });
    ev.on('item:added', () => { if (this._current === 'inventory') this._refreshInventory(); });
  }

  // --- screen scaffolding ---------------------------------------------------
  _screen(name, cls) {
    const s = el('div', `screen sc-${cls || name}`, this.layer);
    this._screens[name] = s;
    return s;
  }

  _btn(parent, label, cb, cls) {
    const b = el('button', `mbtn${cls ? ' ' + cls : ''}`, parent, label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      this.ui.sfx('ui_select');
      cb();
    });
    this._hoverFocus(b);
    return b;
  }

  _hoverFocus(node) {
    node.addEventListener('mouseenter', () => {
      const i = this._focusList.indexOf(node);
      if (i >= 0 && i !== this._focusIdx) this._setFocus(i, true);
    });
  }

  // --- build: title ---------------------------------------------------------
  _buildTitle() {
    const s = this._screen('title');
    const stars = el('div', 'title-stars', s);
    for (let i = 0; i < 10; i++) el('span', null, stars, '✦');
    const block = el('div', 'title-block', s);
    el('div', 'logo-star', block, '✦');
    el('h1', 'logo', block, 'AURELIA');
    el('div', 'logo-sub', block, 'Legend of the Shattered Star');
    el('div', 'logo-rule', block);
    this.titleMenu = el('div', 'title-menu', s);
    el('div', 'title-foot', s,
      'WASD move · mouse look · click to attack — best with sound on');
  }

  _refreshTitle() {
    const g = this.game;
    this.titleMenu.innerHTML = '';
    this._btn(this.titleMenu, 'New Game', () => {
      this.ui.fadeTo(() => g.newGame(), 500);
    });
    if (g.hasSave()) {
      this._btn(this.titleMenu, 'Continue', () => {
        this.ui.fadeTo(() => g.continueGame(), 500);
      });
    }
    this._btn(this.titleMenu, 'How to Play', () => { this._overlay = 'howto'; this._sync(); });
    this._btn(this.titleMenu, 'Settings', () => { this._overlay = 'settings'; this._sync(); });
  }

  // --- build: pause ---------------------------------------------------------
  _buildPause() {
    const s = this._screen('pause');
    const p = el('div', 'panel glass', s);
    el('h2', 'panel-title', p, 'Paused');
    el('div', 'panel-orn', p, '✦');
    const col = el('div', 'panel-col', p);
    this._btn(col, 'Resume', () => this.game.popModal('pause'));
    this._btn(col, 'Save', () => this._saveClicked());
    this._btn(col, 'Settings', () => { this._overlay = 'settings'; this._sync(); });
    this._btn(col, 'Quit to Title', () => this._quitToTitle());
    el('div', 'panel-foot', p, 'Esc — resume');
  }

  _saveClicked() {
    const g = this.game;
    if (g.inDungeon) {
      g.events.emit('toast', { text: 'The shrine’s gloom refuses your prayer — save outside.' });
      return;
    }
    const ok = g.save();
    g.events.emit('toast', { text: ok ? '✦ Progress saved' : 'The realm resisted saving.' });
  }

  _quitToTitle() {
    const g = this.game;
    this.ui.fadeTo(() => {
      try { if (g.inDungeon) g.dungeon.exit?.(true); } catch (e) { console.error(e); }
      g.popModal('pause');
      this._overlay = null;
      if (g.player.alive && !g.inDungeon) g.save();
      g.mode = 'title';
    }, 500);
  }

  // --- build: settings ------------------------------------------------------
  _buildSettings() {
    const s = this._screen('settings');
    const p = el('div', 'panel glass', s);
    el('h2', 'panel-title', p, 'Settings');
    el('div', 'panel-orn', p, '✦');

    this._sliders = {};
    for (const [key, label] of [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'], ['voice', 'Voice']]) {
      const row = el('div', 'set-row', p);
      el('label', null, row, label);
      const input = el('input', 'set-range', row);
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '5';
      const val = el('span', 'set-val', row, '100');
      input.addEventListener('input', () => {
        const v = clamp(+input.value / 100, 0, 1);
        this.game.audio.setVolumes({ [key]: v });
        val.textContent = String(input.value);
      });
      this._hoverFocus(input);
      this._sliders[key] = { input, val };
    }

    const invRow = el('div', 'set-row', p);
    el('label', null, invRow, 'Invert camera Y');
    this.invertBtn = el('button', 'toggle', invRow, 'Off');
    this.invertBtn.type = 'button';
    this.invertBtn.addEventListener('click', () => {
      const on = !this.ui.prefs.invertY;
      this.ui.prefs.invertY = on;
      this.game.cameraRig.invertY = on;
      this.ui.savePrefs();
      this._refreshInvert();
      this.ui.sfx('ui_select');
    });
    this._hoverFocus(this.invertBtn);

    // Mobile browsers can refuse to start audio, and iOS silences WebAudio
    // entirely when the ring/silent switch is on. Surface the real state here
    // and let a tap force another unlock attempt.
    const sndRow = el('div', 'set-row', p);
    el('label', null, sndRow, 'Sound');
    this.soundBtn = el('button', 'toggle', sndRow, '…');
    this.soundBtn.type = 'button';
    this.soundBtn.addEventListener('click', () => {
      this.game.audio.resume?.();
      this.ui.sfx('ui_select');
      setTimeout(() => this._refreshSound(), 120);
    });
    this._hoverFocus(this.soundBtn);
    this.soundHint = el('div', 'set-hint', p, '');

    const qRow = el('div', 'set-row', p);
    el('label', null, qRow, 'Quality');
    el('span', 'set-static', qRow,
      this.game.quality === 'high' ? 'High — auto' : 'Low — mobile auto');

    this._btn(p, 'Back', () => { this._overlay = null; this._sync(); }, 'mb-back');
  }

  _refreshSettings() {
    const vols = this.game.audio.volumes;
    for (const key of ['master', 'music', 'sfx', 'voice']) {
      const s = this._sliders[key];
      const v = Math.round((vols[key] ?? 1) * 100);
      s.input.value = String(v);
      s.val.textContent = String(v);
    }
    this._refreshInvert();
    this._refreshSound();
  }

  _refreshSound() {
    if (!this.soundBtn) return;
    const running = !!this.game.audio.running;
    this.soundBtn.textContent = running ? 'On' : 'Tap to enable';
    this.soundHint.textContent = running
      ? 'On iPhone, flip the side ring/silent switch off if you still hear nothing.'
      : 'Audio has not started yet — tap the button above.';
  }

  _refreshInvert() {
    const on = !!this.ui.prefs.invertY;
    this.invertBtn.textContent = on ? 'On' : 'Off';
    this.invertBtn.classList.toggle('on', on);
  }

  // --- build: how to play ---------------------------------------------------
  _buildHowto() {
    const s = this._screen('howto');
    const p = el('div', 'panel glass wide', s);
    el('h2', 'panel-title', p, 'How to Play');
    el('div', 'panel-orn', p, '✦');
    const grid = el('div', 'keys-grid', p);
    for (const [keys, what] of HOWTO_ROWS) {
      el('kbd', null, grid, keys);
      el('span', null, grid, what);
    }
    el('p', 'howto-note', p,
      'On touch screens a stick and buttons appear — drag the right half of the screen to look around. ' +
      'Guard the boglins’ blows, roll through their swings, and bring light back to the valley.');
    this._btn(p, 'Back', () => { this._overlay = null; this._sync(); }, 'mb-back');
  }

  // --- build: death ---------------------------------------------------------
  _buildDeath() {
    const s = this._screen('death');
    el('h2', 'death-title', s, 'The light fades…');
    el('div', 'death-sub', s, 'Yet the star remembers you.');
    const b = this._btn(s, 'Return to the Waking World', () => {
      this.ui.fadeTo(() => this.game.respawnPlayer(), 600);
    }, 'death-btn');
    this.deathBtn = b;
  }

  // --- build: inventory -----------------------------------------------------
  _buildInventory() {
    const s = this._screen('inventory', 'inv');
    const p = el('div', 'panel glass wide', s);
    const x = el('button', 'panel-x', p, '✕');
    x.type = 'button';
    x.addEventListener('click', () => {
      this.ui.sfx('ui_close');
      this.game.popModal('inventory');
    });
    el('h2', 'panel-title', p, 'Inventory');
    el('div', 'panel-orn', p, '✦');

    this.equipEl = el('div', 'inv-equip', p);
    this.invGrid = el('div', 'inv-grid', p);
    const detail = el('div', 'inv-detail', p);
    this.invName = el('div', 'inv-name', detail);
    this.invDesc = el('div', 'inv-desc', detail);
    this.invUse = el('button', 'mbtn inv-use', detail, 'Use');
    this.invUse.type = 'button';
    this.invUse.addEventListener('click', () => {
      this.ui.sfx('ui_select');
      if (this._invSel && this.game.useItem(this._invSel)) this._refreshInventory();
    });
    this._hoverFocus(this.invUse);

    el('h3', 'inv-h3', p, 'Quest Log');
    this.questLog = el('div', 'quest-log', p);
    el('div', 'panel-foot', p, 'I — close');
  }

  _refreshInventory() {
    const g = this.game;
    const s = g.state;
    this.equipEl.innerHTML = '';
    const sw = el('div', 'equip-item', this.equipEl);
    el('span', `equip-icon icon-sword${s.sword === 'sunblade' ? ' sunblade' : ''}`, sw);
    el('span', null, sw, s.sword === 'sunblade' ? 'The Sunblade' : 'Bronze Sword');
    const ky = el('div', 'equip-item', this.equipEl);
    el('span', 'equip-icon icon-key', ky);
    el('span', null, ky, `Keys × ${s.keys}`);

    this.invGrid.innerHTML = '';
    const ids = Object.keys(s.items).filter((id) => s.items[id] > 0);
    ids.sort((a, b) => {
      const order = { potion: 0, glowshroom: 1 };
      return (order[a] ?? 9) - (order[b] ?? 9) || a.localeCompare(b);
    });
    if (ids.length === 0) {
      el('div', 'inv-empty', this.invGrid, 'Your satchel is empty — the realm awaits.');
      this._invSel = null;
    } else {
      if (!ids.includes(this._invSel)) this._invSel = ids[0];
      for (const id of ids) {
        const meta = ITEMS[id] || { name: this._prettyId(id), icon: 'icon-star' };
        const cell = el('button', 'inv-cell', this.invGrid);
        cell.type = 'button';
        cell.dataset.item = id;
        el('span', `inv-icon ${meta.icon}`, cell, meta.icon === 'icon-star' ? '✦' : '');
        el('span', 'count', cell, String(s.items[id]));
        if (id === this._invSel) cell.classList.add('sel');
        cell.addEventListener('click', () => {
          if (this._invSel === id && (ITEMS[id] || {}).use) {
            this.ui.sfx('ui_select');
            if (g.useItem(id)) this._refreshInventory();
          } else {
            this._invSel = id;
            this.ui.sfx('ui_move');
            this._refreshInventory();
          }
        });
        this._hoverFocus(cell);
      }
    }
    this._refreshInvDetail();
    this._refreshQuestLog();
    if (this._current === 'inventory') this._rebuildFocus();
  }

  _refreshInvDetail() {
    const id = this._invSel;
    if (!id) {
      this.invName.textContent = '';
      this.invDesc.textContent = 'Gather herbs, tonics and treasures on your travels.';
      this.invUse.style.display = 'none';
      return;
    }
    const meta = ITEMS[id] || { name: this._prettyId(id), desc: 'A curious find.' };
    this.invName.textContent = meta.name;
    this.invDesc.textContent = meta.desc || '';
    this.invUse.style.display = meta.use ? '' : 'none';
  }

  _prettyId(id) {
    const s = String(id).replace(/[-_]/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  _refreshQuestLog() {
    const g = this.game;
    this.questLog.innerHTML = '';
    const qs = g.state.quests || {};
    const ids = Object.keys(qs);
    if (ids.length === 0) {
      el('div', 'quest-none', this.questLog, 'No tales begun yet. Seek Elder Maren in Brindlemere.');
      return;
    }
    for (const id of ids) {
      const v = qs[id];
      const done = this._questDone(v);
      const row = el('div', `quest-row${done ? ' done' : ''}`, this.questLog);
      el('span', 'q-dot', row);
      el('span', 'q-title', row, this._questTitle(id));
      el('span', 'q-status', row, done ? 'Complete' : 'In progress');
    }
  }

  _questTitle(id) {
    const q = this.game.quests;
    for (const k of ['defs', 'DEFS', 'definitions', 'quests']) {
      const d = q && q[k];
      if (d && d[id] && typeof d[id].title === 'string') return d[id].title;
    }
    return QUEST_TITLES[id] || this._prettyId(id);
  }

  _questDone(v) {
    if (!v || typeof v !== 'object') return v === true;
    if (v.done || v.completed || v.complete || v.rewarded) return true;
    const st = v.stage;
    return typeof st === 'string' &&
      ['done', 'complete', 'completed', 'rewarded', 'turned-in', 'finished'].includes(st);
  }

  // --- screen state machine -------------------------------------------------
  _wanted() {
    const g = this.game;
    if (g.mode === 'dead') return 'death';
    if (g.mode === 'title') return this._overlay || 'title';
    if (g.modals.has('inventory')) return 'inventory';
    if (g.modals.has('pause')) return this._overlay || 'pause';
    return null;
  }

  _sync() {
    const want = this._wanted();
    if (want === this._current) return;
    if (this._current) this._screens[this._current].classList.remove('on');
    if (!want) this._overlay = null;
    this._current = want;
    if (!want) return;

    this._openedAt = performance.now();
    if (want === 'title') this._refreshTitle();
    if (want === 'settings') this._refreshSettings();
    if (want === 'inventory') this._refreshInventory();
    if (want === 'death' || want === 'title' || want === 'pause') {
      this.game.input.exitPointerLock();
    }
    this._screens[want].classList.add('on');
    this._rebuildFocus();
  }

  _rebuildFocus() {
    const scr = this._screens[this._current];
    if (!scr) { this._focusList = []; return; }
    const old = this._focusList[this._focusIdx];
    this._focusList = [...scr.querySelectorAll('.mbtn, .inv-cell, .toggle, input.set-range')]
      .filter((n) => n.style.display !== 'none');
    let idx = this._focusList.indexOf(old);
    if (idx < 0) idx = 0;
    this._setFocus(idx, false);
  }

  _setFocus(i, blip) {
    const prev = this._focusList[this._focusIdx];
    if (prev) prev.classList.remove('focus');
    this._focusIdx = clamp(i, 0, Math.max(0, this._focusList.length - 1));
    const cur = this._focusList[this._focusIdx];
    if (cur) {
      cur.classList.add('focus');
      if (blip) this.ui.sfx('ui_move');
    }
  }

  _onKey(e) {
    if (!this._current || this._focusList.length === 0) return;
    const code = e.code;
    const cur = this._focusList[this._focusIdx];
    const onSlider = cur && cur.tagName === 'INPUT';

    if (onSlider && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      const dir = code === 'ArrowLeft' ? -1 : 1;
      cur.value = String(clamp(+cur.value + dir * 5, 0, 100));
      cur.dispatchEvent(new Event('input'));
      this.ui.sfx('ui_move');
      e.preventDefault();
      return;
    }
    if (code === 'ArrowUp' || code === 'KeyW' || code === 'ArrowLeft') {
      this._setFocus((this._focusIdx - 1 + this._focusList.length) % this._focusList.length, true);
      e.preventDefault();
    } else if (code === 'ArrowDown' || code === 'KeyS' || code === 'ArrowRight') {
      this._setFocus((this._focusIdx + 1) % this._focusList.length, true);
      e.preventDefault();
    } else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'KeyE') {
      if (cur && !onSlider) { cur.click(); e.preventDefault(); }
    } else if (code === 'Escape') {
      if (this._current === 'settings' || this._current === 'howto') {
        this._overlay = null;
        this.ui.sfx('ui_close');
        this._sync();
      }
    }
  }

  // -------------------------------------------------------------------------
  update() {
    this._sync();
    const g = this.game;
    if (this._current === 'inventory') {
      const aged = performance.now() - this._openedAt > 280;
      if (aged && (g.input.pressed('inventory') || g.input.pressed('pause'))) {
        g.popModal('inventory');
      }
    }
    if (this._current === 'death' && g.input.pressed('confirm')) {
      this.deathBtn.click();
    }
  }
}
