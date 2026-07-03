// Typewriter dialogue box. Advance with E / Space / F / click / tap on the box.
export class Dialogue {
  constructor() {
    this.el = document.getElementById('dialogue');
    this.nameEl = document.getElementById('dlg-name');
    this.textEl = document.getElementById('dlg-text');
    this.hintEl = document.getElementById('dlg-hint');
    this.active = false;
    this.lines = [];
    this.idx = 0;
    this.shown = 0;
    this.speed = 44; // chars per second
    this.onDone = null;
    this._tap = false;
    this.el?.addEventListener('pointerdown', (e) => { e.preventDefault(); this._tap = true; });
  }

  show(name, lines, onDone) {
    this.lines = Array.isArray(lines) ? lines : [String(lines)];
    this.idx = 0;
    this.shown = 0;
    this.onDone = onDone || null;
    this.active = true;
    this._tap = false;
    if (this.nameEl) this.nameEl.textContent = name;
    this.el?.classList.remove('hidden');
  }

  hide() {
    this.active = false;
    this.el?.classList.add('hidden');
  }

  // Call each frame while the game is in the DIALOGUE state.
  tick(dt, input) {
    if (!this.active) return;
    const line = this.lines[this.idx] || '';
    this.shown += dt * this.speed;
    const n = Math.min(line.length, Math.floor(this.shown));
    if (this.textEl) this.textEl.textContent = line.slice(0, n);
    const complete = n >= line.length;
    if (this.hintEl) this.hintEl.style.visibility = complete ? 'visible' : 'hidden';

    const advance = input.wasPressed('KeyE') || input.wasPressed('Space')
      || input.wasPressed('KeyF') || input.consumeClick() || this._tap;
    this._tap = false;
    if (!advance) return;

    if (!complete) {
      this.shown = line.length; // first press reveals the full line
    } else {
      this.idx++;
      this.shown = 0;
      if (this.idx >= this.lines.length) {
        this.hide();
        const cb = this.onDone;
        this.onDone = null;
        cb && cb();
      }
    }
  }
}
