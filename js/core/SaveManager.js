// Persists a serializable snapshot of game progress to localStorage.
const KEY = 'verdant-realm-save-v1';

export const SaveManager = {
  has() {
    try { return localStorage.getItem(KEY) !== null; }
    catch { return false; }
  },

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  save(snapshot) {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  },

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
