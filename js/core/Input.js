// Centralized keyboard + mouse state. A single instance is shared across the game.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered: true only on the frame a key goes down
    this.mouse = { dx: 0, dy: 0, down: false, clicked: false };
    this.pointerLocked = false;

    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      // Prevent the page from scrolling on space / arrows while playing.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', () => {
      this.mouse.down = true;
      this.mouse.clicked = true;
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    });

    // Pointer lock gives us a free-look camera while playing.
    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  isDown(code) { return this.keys.has(code); }

  // True only on the first frame the key was pressed this update.
  wasPressed(code) { return this.pressed.has(code); }

  consumeClick() {
    const c = this.mouse.clicked;
    this.mouse.clicked = false;
    return c;
  }

  // Read and reset accumulated mouse movement for this frame.
  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    return d;
  }

  releaseLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  // Called at the very end of each frame to clear edge-triggered state.
  endFrame() {
    this.pressed.clear();
  }
}
