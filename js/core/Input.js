// Unified input: keyboard + mouse + gamepad + a "virtual" channel that the
// touch UI writes into. Player/Camera read the merged state each frame.
//
// Actions: move (x,z in [-1,1]), look (dx,dy this frame), jump, attack, guard,
// roll, sprint, interact, lockon, inventory, pause, map.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, z: 0 };
    this.look = { dx: 0, dy: 0 };          // consumed (zeroed) by camera each frame
    this.wheel = 0;
    this.pointerLocked = false;
    this.usingGamepad = false;
    this.usingTouch = false;

    // Edge-triggered action presses collected since last frame.
    this._pressed = new Set();
    // Held actions.
    this._held = new Set();

    // Touch UI writes here: {x, z, lookDx, lookDy, held:Set, pressed:[]}
    this.virtual = { x: 0, z: 0, lookDx: 0, lookDy: 0, held: new Set(), pressed: [] };

    this._prevPadButtons = [];
    this._bind();
  }

  // --- public API -----------------------------------------------------------
  /** True only on the frame the action was pressed. */
  pressed(action) { return this._pressed.has(action); }
  /** True while the action is held. */
  held(action) { return this._held.has(action); }

  /** Touch UI calls this to simulate an edge-press. */
  virtualPress(action) { this.virtual.pressed.push(action); this.usingTouch = true; }

  requestPointerLock() {
    if (this.usingTouch) return;
    this.canvas.requestPointerLock?.();
  }
  exitPointerLock() { document.exitPointerLock?.(); }

  /** Called by Game at the END of each frame. */
  endFrame() {
    this._pressed.clear();
    this.look.dx = 0; this.look.dy = 0;
    this.wheel = 0;
  }

  /** Called by Game at the START of each frame. */
  poll() {
    this._pollKeyboard();
    this._pollGamepad();
    this._pollVirtual();
  }

  // --- keyboard / mouse -----------------------------------------------------
  _bind() {
    const KEYMAP = {
      Space: 'jump', KeyE: 'interact', KeyC: 'roll', ControlLeft: 'roll',
      ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyJ: 'attack', KeyK: 'guard',
      Tab: 'lockon', KeyQ: 'lockon', KeyI: 'inventory', KeyM: 'map',
      Escape: 'pause', Enter: 'confirm', KeyF: 'interact',
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEYMAP[e.code];
      if (a) {
        this._pressed.add(a);
        this._held.add(a);
        if (e.code === 'Tab') e.preventDefault();
      }
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = KEYMAP[e.code];
      if (a) this._held.delete(a);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this._held.clear(); });

    // Mouse: LMB attack, RMB guard; movement orbits camera when locked or dragging.
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.usingTouch) return;
      if (e.button === 0) { this._pressed.add('attack'); this._held.add('attack'); }
      if (e.button === 2) { this._pressed.add('guard'); this._held.add('guard'); }
      this._dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._held.delete('attack');
      if (e.button === 2) this._held.delete('guard');
      this._dragging = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.look.dx += e.movementX; this.look.dy += e.movementY;
      } else if (this._dragging) {
        this.look.dx += e.movementX * 1.2; this.look.dy += e.movementY * 1.2;
      }
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('touchstart', () => { this.usingTouch = true; }, { passive: true, once: false });
  }

  _pollKeyboard() {
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    this.move.x = x; this.move.z = z;
  }

  // --- gamepad --------------------------------------------------------------
  _pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return;

    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    if (lx || ly || rx || ry) this.usingGamepad = true;
    if (lx || ly) { this.move.x = lx; this.move.z = ly; }
    this.look.dx += rx * 14; this.look.dy += ry * 10;

    // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 back, 9 start.
    const MAP = { 0: 'jump', 1: 'roll', 2: 'attack', 3: 'interact', 5: 'lockon', 8: 'inventory', 9: 'pause' };
    for (const [idx, action] of Object.entries(MAP)) {
      const b = gp.buttons[idx];
      const was = this._prevPadButtons[idx];
      const is = !!(b && b.pressed);
      if (is && !was) this._pressed.add(action);
      if (is) this._held.add(`pad:${action}`), this._held.add(action);
      else if (was) this._held.delete(action);
      this._prevPadButtons[idx] = is;
    }
    // Triggers as holds.
    const lt = gp.buttons[6], rt = gp.buttons[7];
    if (lt && lt.pressed) this._held.add('guard'); else if (this._prevPadButtons.lt) this._held.delete('guard');
    if (rt && rt.pressed) this._held.add('sprint'); else if (this._prevPadButtons.rt) this._held.delete('sprint');
    this._prevPadButtons.lt = !!(lt && lt.pressed);
    this._prevPadButtons.rt = !!(rt && rt.pressed);
  }

  // --- touch virtual channel ------------------------------------------------
  _pollVirtual() {
    const v = this.virtual;
    if (v.x || v.z) { this.move.x = v.x; this.move.z = v.z; }
    this.look.dx += v.lookDx; this.look.dy += v.lookDy;
    v.lookDx = 0; v.lookDy = 0;
    for (const a of v.pressed) this._pressed.add(a);
    v.pressed.length = 0;
    for (const a of v.held) this._held.add(a);
    // Actions held virtually are cleared by the touch UI removing them from the set;
    // mirror removals here.
    for (const a of ['sprint', 'guard', 'attack']) {
      if (!v.held.has(a) && !this.keys.size && this.usingTouch) this._held.delete(a);
    }
  }
}
