// On-screen controls for phones/tablets: a left analog stick for movement, a
// right-side look pad for the camera, and action buttons. Everything feeds the
// shared Input instance so the rest of the game is unchanged.
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    document.body.appendChild(this.root);

    this._buildLookPad();
    this._buildJoystick();
    this._buildButtons();
    this._wireOverlayClose();
  }

  show() { this.root.classList.remove('hidden'); }
  hide() {
    this.root.classList.add('hidden');
    this.input.touchMove.x = 0;
    this.input.touchMove.y = 0;
  }

  // Right-hand portion of the screen: drag to orbit the camera.
  _buildLookPad() {
    const pad = document.createElement('div');
    pad.className = 'touch-look';
    this.root.appendChild(pad);

    let id = null, lastX = 0, lastY = 0;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; lastX = e.clientX; lastY = e.clientY;
      pad.setPointerCapture(id);
    }, { passive: false });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      this.input.addLook((e.clientX - lastX) * 1.4, (e.clientY - lastY) * 1.4);
      lastX = e.clientX; lastY = e.clientY;
    }, { passive: false });
    const end = (e) => { if (e.pointerId === id) id = null; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  // Bottom-left analog stick for movement.
  _buildJoystick() {
    const base = document.createElement('div');
    base.className = 'touch-stick';
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    base.appendChild(knob);
    this.root.appendChild(base);

    const R = 52; // max knob travel in px
    let id = null, cx = 0, cy = 0;
    const reset = () => {
      knob.style.transform = 'translate(-50%, -50%)';
      this.input.touchMove.x = 0;
      this.input.touchMove.y = 0;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      base.setPointerCapture(id);
    }, { passive: false });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(len, R);
      dx = (dx / len) * clamped; dy = (dy / len) * clamped;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.touchMove.x = dx / R;        // +right
      this.input.touchMove.y = -dy / R;       // +forward (up on screen)
    }, { passive: false });
    const end = (e) => { if (e.pointerId === id) { id = null; reset(); } };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  _button(label, cls, code, hold = false) {
    const b = document.createElement('div');
    b.className = `touch-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('active');
      this.input.triggerPress(code);
      if (hold) this.input.keys.add(code);
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      b.classList.remove('active');
      if (hold) this.input.keys.delete(code);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    this.root.appendChild(b);
    return b;
  }

  _buildButtons() {
    // Action cluster (bottom-right).
    this._button('⚔', 'btn-attack', 'KeyF');
    this._button('↥', 'btn-jump', 'Space');
    this._button('E', 'btn-interact', 'KeyE');
    // Run toggle held while pressed.
    this._button('»', 'btn-run', 'ShiftLeft', true);
    // Corner buttons.
    this._button('🎒', 'btn-inv', 'KeyI');
    this._button('Ⅱ', 'btn-pause', 'Escape');
  }

  // Tapping the inventory backdrop closes it on touch devices.
  _wireOverlayClose() {
    const inv = document.getElementById('inventory');
    if (!inv) return;
    inv.addEventListener('pointerdown', (e) => {
      if (e.target === inv) this.input.triggerPress('KeyI');
    });
  }
}
