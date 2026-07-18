// Tiny synchronous pub/sub used as the game-wide event bus (game.events).
// Canonical event names and payloads are documented in docs/CONTRACTS.md.

export class Emitter {
  constructor() { this._map = new Map(); }

  on(name, fn) {
    let set = this._map.get(name);
    if (!set) { set = new Set(); this._map.set(name, set); }
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => { off(); fn(payload); });
    return off;
  }

  off(name, fn) {
    const set = this._map.get(name);
    if (set) set.delete(fn);
  }

  emit(name, payload) {
    const set = this._map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); }
      catch (err) { console.error(`[events] handler for "${name}" threw`, err); }
    }
  }
}
