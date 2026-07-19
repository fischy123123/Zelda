// Boot: sanity-check WebGL, start the game, expose debug handles.

import { Game } from './core/Game.js';

function fatal(msg) {
  const el = document.getElementById('boot-error');
  if (el) { el.textContent = msg; el.style.display = 'flex'; }
  console.error('[boot]', msg);
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// Mobile: never let rapid taps or pinches zoom the page. iOS Safari ignores
// user-scalable=no, so block its gesture events and double-tap directly.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchend', (e) => {
  // Only for the canvas + touch-control layer — menu buttons keep their
  // synthesized clicks (they're covered by touch-action: manipulation).
  if (e.target && e.target.closest && e.target.closest('#game, .touch')) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('DOMContentLoaded', () => {
  if (!hasWebGL()) {
    fatal('This adventure needs WebGL, which your browser has disabled.');
    return;
  }
  try {
    const canvas = document.getElementById('game');
    const game = new Game(canvas);
    window.game = game;               // debug + automated verification hook
    window.__GAME_READY__ = true;
    document.getElementById('boot-splash')?.remove();
  } catch (err) {
    console.error(err);
    fatal('The realm failed to load — see the console for details.');
    window.__GAME_ERROR__ = String(err && err.stack || err);
  }
});
