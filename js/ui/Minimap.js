// Minimap — a circular corner map. The terrain is sampled once (every ~6
// world units) into an offscreen canvas, spread across frames so boot never
// hitches; per-frame drawing is just a crop + a handful of vector markers.
// Hidden inside the dungeon. M toggles local zoom / whole-valley view.

import { el } from './UI.js';
import { SITES, LAKE, FOREST_BAND, WORLD } from '../world/layout.js';
import { clamp, clamp01 } from '../util/math.js';

const EXTENT = 720;              // half-width of the mapped square (world units)
const BUILD_BUDGET_MS = 3.5;     // per-frame build time slice
const ZOOM_RADIUS = 135;         // world units shown from center in zoom mode

const MARKERS = [
  { site: SITES.village, color: '#e8b64c', shape: 'circle', label: 'Brindlemere' },
  { site: SITES.shrine, color: '#7fd4ff', shape: 'diamond', label: 'Hollow Shrine' },
  { site: SITES.ruins, color: '#c9c4b6', shape: 'triangle', label: 'Skywatch Ruins' },
  { site: SITES.lakeDock, color: '#4c9df0', shape: 'square', label: 'Mirrowmere' },
];
const CAMPS = [SITES.camp1, SITES.camp2, SITES.camp3, SITES.camp4, SITES.camp5];

export class Minimap {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    const low = game.quality === 'low';

    this.step = low ? 9 : 6;
    this.cells = Math.floor((EXTENT * 2) / this.step);

    this.wrap = el('div', 'minimap', ui.root);
    this.canvas = el('canvas', 'mm-canvas', this.wrap);
    const px = low ? 220 : 300;
    this.canvas.width = px;
    this.canvas.height = px;
    el('div', 'mm-north', this.wrap, 'N');
    el('div', 'mm-dir mm-e', this.wrap, 'E');
    el('div', 'mm-dir mm-s', this.wrap, 'S');
    el('div', 'mm-dir mm-w', this.wrap, 'W');
    this.ctx = this.canvas.getContext('2d');

    this.off = document.createElement('canvas');
    this.off.width = this.off.height = this.cells;
    this.offCtx = this.off.getContext('2d');
    this.img = this.offCtx.createImageData(this.cells, this.cells);
    this._heights = new Float32Array(this.cells * this.cells);
    this._row = 0;
    this.built = false;

    this._zoom = true;
    this._visible = null;
    this._questTarget = null;
    this._questPoll = 0;
    this._frame = 0;
  }

  // -------------------------------------------------------------------------
  // Incremental terrain bake.
  _buildSome() {
    const deadline = performance.now() + BUILD_BUDGET_MS;
    const t = this.game.terrain;
    const wl = t.waterLevel;
    const cells = this.cells;
    const data = this.img.data;
    const H = this._heights;

    while (this._row < cells && performance.now() < deadline) {
      const iy = this._row;
      const z = -EXTENT + (iy + 0.5) * this.step;
      for (let ix = 0; ix < cells; ix++) {
        const x = -EXTENT + (ix + 0.5) * this.step;
        const b = t.biomeAt(x, z);
        const h = b.height;
        const idx = iy * cells + ix;
        H[idx] = h;

        let r, g, bl;
        if (h < wl - 0.25) {
          const d = clamp01((wl - h) / 8);
          r = 46 - 25 * d; g = 127 - 37 * d; bl = 158 - 38 * d;
        } else if (b.id === 'beach') {
          r = 226; g = 207; bl = 155;
        } else if (b.id === 'badland') {
          const dark = ((Math.floor(h / 7) % 2 + 2) % 2) * 0.4;
          r = 199 - 34 * dark; g = 141 - 37 * dark; bl = 90 - 27 * dark;
        } else if (b.id === 'forest') {
          const k = clamp01(b.forest);
          r = 87 - 25 * k; g = 140 - 30 * k; bl = 72 - 18 * k;
        } else {
          const k = clamp01(b.grass * 1.15);
          r = 111 + 45 * k; g = 174 + 29 * k; bl = 78 + 18 * k;
        }
        // Rock on slopes, snow above the treeline.
        const rocky = clamp01((b.slope - 0.55) * 2.2);
        if (rocky > 0) { r += (141 - r) * rocky; g += (135 - g) * rocky; bl += (121 - bl) * rocky; }
        if (h > 58) {
          const sn = clamp01((h - 58) / 28);
          r += (242 - r) * sn; g += (244 - g) * sn; bl += (240 - bl) * sn;
        }
        // Fade the impassable rim to map-navy.
        const dc = Math.sqrt(x * x + z * z);
        if (dc > WORLD.playRadius - 30) {
          const f = clamp01((dc - (WORLD.playRadius - 30)) / 90) * 0.75;
          r += (26 - r) * f; g += (32 - g) * f; bl += (52 - bl) * f;
        }
        // NW hillshade from already-computed neighbors.
        let shade = 1;
        if (ix > 0 && iy > 0) {
          shade = clamp(1 + ((H[idx - 1] - h) + (H[idx - cells] - h)) * 0.035, 0.72, 1.18);
        }
        const o = idx * 4;
        data[o] = Math.min(255, r * shade);
        data[o + 1] = Math.min(255, g * shade);
        data[o + 2] = Math.min(255, bl * shade);
        data[o + 3] = 255;
      }
      this._row++;
    }
    if (this._row >= this.cells) {
      this.offCtx.putImageData(this.img, 0, 0);
      this.built = true;
      this.img = null;
      this._heights = null;
    }
  }

  // -------------------------------------------------------------------------
  _pollQuest() {
    let target = null;
    this._campsActive = false;
    try {
      const q = this.game.quests;
      this._campsActive = !!q && q.stage('thin-the-horde') === 1;
      const o = q && typeof q.activeObjective === 'function' ? q.activeObjective() : null;
      if (o) {
        const s = `${o.title || ''} ${o.text || ''}`.toLowerCase();
        if (s.includes('shrine') || s.includes('hollow')) target = SITES.shrine;
        else if (s.includes('ruin') || s.includes('skywatch')) target = SITES.ruins;
        else if (s.includes('shroom') || s.includes('mushroom') || s.includes('elderwood')) {
          target = this._forestPoint || (this._forestPoint = {
            x: 0, z: FOREST_BAND.z - FOREST_BAND.depth * 0.5,
          });
        } else if (s.includes('lake') || s.includes('mirrowmere') || s.includes('dock')) {
          target = SITES.lakeDock;
        } else if (s.includes('boglin') || s.includes('camp') || s.includes('horde')) {
          target = SITES.camp1;
        } else {
          target = SITES.village;
        }
      }
    } catch (e) { target = null; }
    this._questTarget = target;
  }

  // -------------------------------------------------------------------------
  update(rawDt) {
    if (!this.built) this._buildSome();

    const g = this.game;
    const visible = g.mode === 'playing' && !g.inDungeon;
    if (visible !== this._visible) {
      this._visible = visible;
      this.wrap.classList.toggle('on', visible);
    }
    if (!visible) return;

    if (!g.uiBlocked && g.input.pressed('map')) {
      this._zoom = !this._zoom;
      this.ui.sfx('ui_move');
    }

    this._questPoll -= rawDt;
    if (this._questPoll <= 0) {
      this._questPoll = 1;
      this._pollQuest();
    }

    // Half-rate redraw on low quality.
    this._frame++;
    if (g.quality === 'low' && (this._frame & 1)) return;
    this._draw();
  }

  _draw() {
    const ctx = this.ctx;
    const size = this.canvas.width;
    const c = size * 0.5;
    const R = c - 4;
    const p = this.game.player.position;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#141c30';
    ctx.fillRect(0, 0, size, size);

    let viewX, viewZ, scale; // world → canvas px-per-unit
    if (this._zoom) {
      viewX = p.x;
      viewZ = p.z;
      scale = R / ZOOM_RADIUS;
    } else {
      viewX = 0;
      viewZ = 0;
      scale = R / EXTENT;
    }

    if (this.built) {
      const upp = this.step;                       // units per offscreen pixel
      const srcHalf = R / scale / upp;             // offscreen px per canvas half
      const sx = (viewX + EXTENT) / upp - srcHalf;
      const sy = (viewZ + EXTENT) / upp - srcHalf;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.off, sx, sy, srcHalf * 2, srcHalf * 2, c - R, c - R, R * 2, R * 2);
    }

    // Dashed guide line: player → active quest target (under the markers).
    if (this._questTarget) {
      const px0 = c + (p.x - viewX) * scale;
      const py0 = c + (p.z - viewZ) * scale;
      const qx0 = c + (this._questTarget.x - viewX) * scale;
      const qy0 = c + (this._questTarget.z - viewZ) * scale;
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -(performance.now() * 0.01) % 9;
      ctx.beginPath();
      ctx.moveTo(px0, py0);
      ctx.lineTo(qx0, qy0);
      ctx.strokeStyle = 'rgba(255, 217, 122, 0.55)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // Site markers (+ name labels in whole-valley view).
    for (const m of MARKERS) {
      const mx = c + (m.site.x - viewX) * scale;
      const my = c + (m.site.z - viewZ) * scale;
      const dx = mx - c, dy = my - c;
      if (dx * dx + dy * dy > (R - 7) * (R - 7)) continue;
      this._marker(ctx, mx, my, m.color, m.shape);
      if (!this._zoom) this._label(ctx, mx, my + 13, m.label);
    }

    // Boglin camps while the horde hunt is on: red ✕ marks the prey.
    if (this._campsActive) {
      for (const camp of CAMPS) {
        const mx = c + (camp.x - viewX) * scale;
        const my = c + (camp.z - viewZ) * scale;
        const dx = mx - c, dy = my - c;
        if (dx * dx + dy * dy > (R - 7) * (R - 7)) continue;
        this._cross(ctx, mx, my, 4, '#ff6a55');
      }
    }

    // NPC quest markers in close-up view: gold ! / ? over the giver's dot.
    if (this._zoom) {
      const npcs = this.game.village && this.game.village.npcs;
      if (npcs) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 11px Georgia, serif';
        for (const npc of npcs) {
          const nx = c + (npc.group.position.x - viewX) * scale;
          const ny = c + (npc.group.position.z - viewZ) * scale;
          const dx = nx - c, dy = ny - c;
          if (dx * dx + dy * dy > (R - 8) * (R - 8)) continue;
          ctx.beginPath();
          ctx.arc(nx, ny, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = '#f2ead6';
          ctx.strokeStyle = 'rgba(10, 8, 4, 0.8)';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          if (npc.questKind) {
            const ch = npc.questKind === 'offer' ? '!' : '?';
            const col = npc.questKind === 'progress' ? '#aab2c2' : '#ffd24c';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(10, 8, 4, 0.85)';
            ctx.strokeText(ch, nx, ny - 8);
            ctx.fillStyle = col;
            ctx.fillText(ch, nx, ny - 8);
          }
        }
      }
    }

    // Active quest marker — clamped to the rim, gently pulsing, with the
    // straight-line distance so you know how far the walk is.
    if (this._questTarget) {
      let qx = (this._questTarget.x - viewX) * scale;
      let qy = (this._questTarget.z - viewZ) * scale;
      const d = Math.sqrt(qx * qx + qy * qy);
      const lim = R - 11;
      if (d > lim) { qx = qx / d * lim; qy = qy / d * lim; }
      const pulse = 5.5 + Math.sin(performance.now() * 0.005) * 1.4;
      this._star(ctx, c + qx, c + qy, pulse, '#ffd97a');
      const distW = Math.hypot(this._questTarget.x - p.x, this._questTarget.z - p.z);
      if (distW > 18) {
        const ly = qy + (qy < 0 ? 15 : -13); // keep the text inside the ring
        this._label(ctx, c + qx, c + ly, `${Math.round(distW)}m`, '#ffe9b0');
      }
    }

    // Camera view cone + player arrow.
    const px = c + (p.x - viewX) * scale;
    const py = c + (p.z - viewZ) * scale;
    const camYaw = this.game.cameraRig.getYaw();
    const ca = Math.atan2(-Math.cos(camYaw), -Math.sin(camYaw));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, 26, ca - 0.5, ca + 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 242, 208, 0.14)';
    ctx.fill();

    const yaw = this.game.player.yaw;
    const pa = Math.atan2(Math.cos(yaw), Math.sin(yaw));
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(pa);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fillStyle = '#ffd97a';
    ctx.strokeStyle = 'rgba(10, 8, 4, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Gold ring.
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 182, 76, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _marker(ctx, x, y, color, shape) {
    ctx.beginPath();
    const r = 4.5;
    if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'diamond') {
      ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r, y);
      ctx.closePath();
    } else if (shape === 'triangle') {
      ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r);
      ctx.closePath();
    } else {
      ctx.rect(x - r + 0.5, y - r + 0.5, r * 2 - 1, r * 2 - 1);
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(10, 8, 4, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  _label(ctx, x, y, text, color = '#e8e1cd') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 9px Georgia, serif';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(10, 8, 4, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  _cross(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.strokeStyle = 'rgba(10, 8, 4, 0.85)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _star(ctx, x, y, r, color) {
    ctx.beginPath();
    const r2 = r * 0.38;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r2;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(10, 8, 4, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
}
