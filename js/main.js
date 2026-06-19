import { Game } from './core/Game.js?v=8';

// Bootstraps the game and runs the render loop.
const canvas = document.getElementById('game');
const game = new Game(canvas);

// Hide the loading splash once the module graph has executed.
document.getElementById('loading').classList.add('hidden');

function loop() {
  requestAnimationFrame(loop);
  game.update();
}
loop();

// Expose for debugging in the browser console.
window.__game = game;
