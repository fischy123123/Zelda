// Heads-up display: hearts, rupee/key counters, stamina wheel, quest objective,
// boss health bar, region-name splash, interaction prompt, and pickup toasts.
export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.heartsEl = document.getElementById('hearts');
    this.rupeeEl = document.getElementById('rupee-count');
    this.keyEl = document.getElementById('key-count');
    this.promptEl = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.objectiveEl = document.getElementById('objective');
    this.staminaEl = document.getElementById('stamina');
    this.bossEl = document.getElementById('bossbar');
    this.bossNameEl = document.getElementById('bossname');
    this.bossFillEl = document.getElementById('bossfill');
    this.regionEl = document.getElementById('region-splash');
    this._heartCount = -1;
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  _ensureHearts(maxHalf) {
    const hearts = Math.ceil(maxHalf / 2);
    if (hearts === this._heartCount) return;
    this._heartCount = hearts;
    this.heartsEl.innerHTML = '';
    for (let i = 0; i < hearts; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      h.innerHTML = '<div class="fill"></div>';
      this.heartsEl.appendChild(h);
    }
  }

  update(player, inventory) {
    this._ensureHearts(player.maxHealth);
    const nodes = this.heartsEl.children;
    for (let i = 0; i < nodes.length; i++) {
      const halfValue = player.health - i * 2;
      const node = nodes[i];
      node.classList.remove('empty', 'half');
      if (halfValue >= 2) { /* full */ }
      else if (halfValue === 1) node.classList.add('half');
      else node.classList.add('empty');
    }
    this.rupeeEl.textContent = inventory.rupees;
    this.keyEl.textContent = inventory.keys;

    // Stamina wheel appears only while spent.
    if (this.staminaEl) {
      const frac = player.stamina / player.maxStamina;
      this.staminaEl.classList.toggle('hidden', frac >= 0.995);
      this.staminaEl.classList.toggle('exhausted', player.exhausted);
      this.staminaEl.style.setProperty('--p', String(Math.round(frac * 100)));
    }
  }

  setObjective(text) {
    if (!this.objectiveEl) return;
    if (text) {
      this.objectiveEl.textContent = '◆ ' + text;
      this.objectiveEl.classList.remove('hidden');
    } else {
      this.objectiveEl.classList.add('hidden');
    }
  }

  setBoss(name, frac) {
    if (!this.bossEl) return;
    if (name == null) { this.bossEl.classList.add('hidden'); return; }
    this.bossEl.classList.remove('hidden');
    this.bossNameEl.textContent = name;
    this.bossFillEl.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  splashRegion(name) {
    if (!this.regionEl) return;
    this.regionEl.textContent = name;
    this.regionEl.classList.remove('hidden', 'show');
    void this.regionEl.offsetWidth; // restart the CSS animation
    this.regionEl.classList.add('show');
  }

  setPrompt(text) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.classList.remove('hidden');
    } else {
      this.promptEl.classList.add('hidden');
    }
  }

  toast(message) {
    const t = document.createElement('div');
    t.className = 'toast-item';
    t.textContent = message;
    this.toastEl.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
}
