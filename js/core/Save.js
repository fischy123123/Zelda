// Save / load via localStorage. Saves game state + player position + time.

const KEY = 'aurelia-save-v1';

export const Save = {
  exists() {
    try { return !!localStorage.getItem(KEY); } catch { return false; }
  },

  write(game) {
    try {
      const p = game.player;
      const data = {
        v: 1,
        savedAt: Date.now(),
        state: game.state,
        player: { x: p.position.x, z: p.position.z, yaw: p.yaw },
        timeOfDay: game.sky ? game.sky.timeOfDay : 0.35,
        inDungeon: !!game.inDungeon,
      };
      // Never save mid-dungeon position; respawn at the shrine door instead.
      localStorage.setItem(KEY, JSON.stringify(data));
      game.events.emit('game:save', {});
      return true;
    } catch (err) {
      console.warn('[save] failed', err);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1) return null;
      return data;
    } catch {
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
