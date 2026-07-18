// Interactable registry: NPCs, chests, signs, doors register here; each frame
// the nearest valid one within range gets the on-screen prompt, and the
// interact button triggers it.

export class Interact {
  constructor(game) {
    this.game = game;
    this.items = new Set();
    this.current = null;
    this._lastPrompt = undefined;
  }

  /**
   * obj: {
   *   position: Vector3 | {x,y,z},
   *   radius: number,
   *   prompt: string | () => string,   // e.g. "Talk", "Open"
   *   enabled?: () => bool,
   *   onInteract: (game) => void,
   * }
   */
  register(obj) { this.items.add(obj); return () => this.items.delete(obj); }
  unregister(obj) { this.items.delete(obj); }

  update() {
    const g = this.game;
    const p = g.player.position;
    let best = null, bestD = Infinity;
    if (!g.uiBlocked && g.player.alive) {
      for (const it of this.items) {
        if (it.enabled && !it.enabled()) continue;
        const dx = it.position.x - p.x, dz = it.position.z - p.z;
        const dy = (it.position.y ?? p.y) - p.y;
        const d = Math.hypot(dx, dz);
        if (d < (it.radius || 2.5) && Math.abs(dy) < 4 && d < bestD) { best = it; bestD = d; }
      }
    }
    this.current = best;
    const promptText = best ? (typeof best.prompt === 'function' ? best.prompt() : best.prompt) : null;
    if (promptText !== this._lastPrompt) {
      this._lastPrompt = promptText;
      g.events.emit('prompt', promptText);
    }
    if (best && g.input.pressed('interact')) {
      best.onInteract(g);
    }
  }
}
