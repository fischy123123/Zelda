// Dialogue — letterboxed bottom panel with name tag, typewriter text,
// advance marker and branching choices. Drives `game.pushModal('dialogue')`
// and emits 'dialogue:start' / 'dialogue:end' per the contract. Node defs:
// { name, nodes: { id: { text: [...], choices?: [{label, next?, action?,
// cond?}], next?, action? } } } — actions/conds are functions of `game`.

import { el } from './UI.js';

const CHARS_PER_SEC = 34;
const BLIP_GAP = 0.055;

export class Dialogue {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;

    this.lbTop = el('div', 'dg-lb top', ui.root);
    this.lbBot = el('div', 'dg-lb bot', ui.root);
    this.wrap = el('div', 'dg-wrap', ui.root);
    const panel = el('div', 'dg-panel glass', this.wrap);
    this.nameEl = el('div', 'dg-name', panel);
    this.textEl = el('div', 'dg-text', panel);
    this.advEl = el('div', 'dg-adv', panel, '▼');
    this.choicesEl = el('ul', 'dg-choices', panel);

    panel.addEventListener('click', () => {
      if (this._choiceList) return; // choices handle their own clicks
      this._advance();
    });

    window.addEventListener('keydown', (e) => this._onKey(e));

    this._def = null;
    this._node = null;
    this._pages = [];
    this._page = 0;
    this._full = '';
    this._shown = 0;
    this._t = 0;
    this._typing = false;
    this._guard = 0;
    this._blipT = 0;
    this._choiceList = null;
    this._sel = 0;
    this._voiced = false;
  }

  get open() { return !!this._def; }

  // -------------------------------------------------------------------------
  start(def, startNode = 'start') {
    if (!def || !def.nodes || !def.nodes[startNode]) {
      console.warn('[dialogue] bad def or missing node', startNode);
      return;
    }
    const wasOpen = this.open;
    this._def = def;
    this.nameEl.textContent = def.name || '';
    this.nameEl.style.display = def.name ? '' : 'none';
    if (!wasOpen) {
      this.game.pushModal('dialogue');
      this.game.events.emit('dialogue:start', { name: def.name });
      this.lbTop.classList.add('on');
      this.lbBot.classList.add('on');
      this.wrap.classList.add('on');
    }
    this._guard = 0.2;
    this._goto(startNode);
  }

  _goto(id) {
    const node = this._def && this._def.nodes[id];
    if (!node) { this._end(); return; }
    this._node = node;
    if (typeof node.action === 'function') {
      try { node.action(this.game); }
      catch (err) { console.error('[dialogue] node action threw', err); }
    }
    const t = node.text;
    this._pages = Array.isArray(t) ? t.map(String) : [String(t ?? '')];
    if (this._pages.length === 0) this._pages = [''];
    this._page = 0;
    this._startPage();
  }

  _startPage() {
    this._full = this._pages[this._page] || '';
    this._shown = 0;
    this._t = 0;
    this._typing = true;
    this.textEl.textContent = '';
    this.advEl.classList.remove('on');
    this._hideChoices();
    // Voiced line, if this one was generated. When a clip plays we mute the
    // typewriter blips so the two don't talk over each other.
    this._voiced = false;
    const voice = this.game.voice;
    if (voice && this._def) {
      const speaker = this._def.voiceId || this._def.name;
      this._voiced = voice.play(speaker, this._full);
    }
  }

  _pageDone() {
    this._typing = false;
    this._shown = this._full.length;
    this.textEl.textContent = this._full;
    const last = this._page >= this._pages.length - 1;
    if (last) {
      const list = this._filteredChoices();
      if (list.length > 0) { this._showChoices(list); return; }
    }
    this.advEl.classList.add('on');
  }

  _filteredChoices() {
    const cs = this._node && this._node.choices;
    if (!Array.isArray(cs)) return [];
    const out = [];
    for (const c of cs) {
      if (typeof c.cond === 'function') {
        let ok = false;
        try { ok = !!c.cond(this.game); }
        catch (err) { console.error('[dialogue] choice cond threw', err); }
        if (!ok) continue;
      }
      out.push(c);
    }
    return out;
  }

  _showChoices(list) {
    this._choiceList = list;
    this._sel = 0;
    this.choicesEl.innerHTML = '';
    list.forEach((c, i) => {
      const li = el('li', i === 0 ? 'sel' : null, this.choicesEl, c.label || '…');
      li.addEventListener('click', (e) => { e.stopPropagation(); this._select(i); });
      li.addEventListener('mouseenter', () => this._setSel(i, true));
    });
    this.choicesEl.classList.add('on');
  }

  _hideChoices() {
    this._choiceList = null;
    this.choicesEl.classList.remove('on');
    this.choicesEl.innerHTML = '';
  }

  _setSel(i, blip) {
    if (!this._choiceList || i === this._sel) return;
    const items = this.choicesEl.children;
    if (items[this._sel]) items[this._sel].classList.remove('sel');
    this._sel = i;
    if (items[i]) items[i].classList.add('sel');
    if (blip) this.ui.sfx('ui_move');
  }

  _select(i) {
    const c = this._choiceList && this._choiceList[i];
    if (!c) return;
    this.game.voice?.stop();
    this.ui.sfx('ui_select');
    this._hideChoices();
    if (typeof c.action === 'function') {
      try { c.action(this.game); }
      catch (err) { console.error('[dialogue] choice action threw', err); }
    }
    if (!this._def) return;           // action may have chained into a new start()
    if (c.next) this._goto(c.next);
    else this._end();
  }

  _advance() {
    if (!this.open || this._guard > 0) return;
    this._guard = 0.12;
    if (this._typing) { this._pageDone(); return; }
    if (this._choiceList) { this._select(this._sel); return; }
    if (this._page < this._pages.length - 1) {
      this.game.voice?.stop();
      this._page++;
      this._startPage();
      return;
    }
    const node = this._node;
    if (node && node.next) this._goto(node.next);
    else this._end();
  }

  _end() {
    if (!this._def) return;
    this.game.voice?.stop();
    this._voiced = false;
    this._def = null;
    this._node = null;
    this._hideChoices();
    this.lbTop.classList.remove('on');
    this.lbBot.classList.remove('on');
    this.wrap.classList.remove('on');
    this.game.popModal('dialogue');
    this.game.events.emit('dialogue:end', {});
  }

  // -------------------------------------------------------------------------
  _onKey(e) {
    if (!this.open || !this._choiceList) return;
    const code = e.code;
    if (code === 'ArrowUp' || code === 'KeyW') {
      this._setSel((this._sel - 1 + this._choiceList.length) % this._choiceList.length, true);
      e.preventDefault();
    } else if (code === 'ArrowDown' || code === 'KeyS') {
      this._setSel((this._sel + 1) % this._choiceList.length, true);
      e.preventDefault();
    }
  }

  // -------------------------------------------------------------------------
  update(rawDt) {
    if (!this.open) return;
    this._guard = Math.max(0, this._guard - rawDt);
    this._blipT = Math.max(0, this._blipT - rawDt);

    if (this._typing) {
      this._t += rawDt * CHARS_PER_SEC;
      const n = Math.min(this._full.length, this._t | 0);
      if (n > this._shown) {
        const ch = this._full.charAt(n - 1);
        this._shown = n;
        this.textEl.textContent = this._full.slice(0, n);
        if (!this._voiced && this._blipT <= 0 && ch !== ' ' && ch !== '\n') {
          this._blipT = BLIP_GAP;
          this.ui.sfx('dialogue_blip');
        }
        if (n >= this._full.length) this._pageDone();
      }
    }

    const input = this.game.input;
    if (this._guard <= 0 &&
        (input.pressed('interact') || input.pressed('attack') ||
         input.pressed('confirm') || input.pressed('jump'))) {
      this._advance();
    }
  }
}
