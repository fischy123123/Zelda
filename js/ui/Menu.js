// Controls the title / pause overlay and wires its buttons to the game.
export class Menu {
  constructor({ onNewGame, onContinue }) {
    this.el = document.getElementById('menu');
    this.continueBtn = document.getElementById('btn-continue');
    this.newBtn = document.getElementById('btn-new');
    this.titleEl = this.el.querySelector('h1');

    this.newBtn.addEventListener('click', () => onNewGame());
    this.continueBtn.addEventListener('click', () => onContinue());
  }

  // mode: 'title' or 'pause'. hasSave toggles the Continue button.
  show(mode, hasSave) {
    this.el.classList.remove('hidden');
    if (mode === 'pause') {
      this.titleEl.innerHTML = 'Paused';
      this.continueBtn.textContent = 'Resume';
      this.continueBtn.classList.remove('hidden');
      this.newBtn.textContent = 'Restart (New Game)';
    } else {
      this.titleEl.innerHTML = 'Legend of the<br />Verdant Realm';
      this.continueBtn.textContent = 'Continue';
      this.continueBtn.classList.toggle('hidden', !hasSave);
      this.newBtn.textContent = 'New Game';
    }
  }

  hide() { this.el.classList.add('hidden'); }
}
