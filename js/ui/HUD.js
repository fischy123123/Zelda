// Renders the heads-up display: hearts, rupee/key counters, interaction prompt,
// and transient pickup toasts. Pure DOM, driven each frame by the game.
export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.heartsEl = document.getElementById('hearts');
    this.rupeeEl = document.getElementById('rupee-count');
    this.keyEl = document.getElementById('key-count');
    this.promptEl = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this._heartCount = -1;
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  // Rebuild heart elements only when the max changes; otherwise just update fill.
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
      const halfValue = player.health - i * 2; // remaining halves for this heart
      const node = nodes[i];
      node.classList.remove('empty', 'half');
      if (halfValue >= 2) { /* full */ }
      else if (halfValue === 1) node.classList.add('half');
      else node.classList.add('empty');
    }
    this.rupeeEl.textContent = inventory.rupees;
    this.keyEl.textContent = inventory.keys;
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
