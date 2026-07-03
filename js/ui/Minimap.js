// Circular overworld minimap: a pre-rendered terrain image with live markers
// for the village, the vault portal, nearby enemies, and the player.
export class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.base = null;
    this.worldSize = 400;
  }

  init(world) {
    if (!this.ctx) return;
    this.worldSize = world.terrain.size;
    const N = 110;
    const off = document.createElement('canvas');
    off.width = off.height = N;
    const octx = off.getContext('2d');
    const img = octx.createImageData(N, N);
    const t = world.terrain;
    const half = t.size / 2;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const wx = (px / (N - 1)) * t.size - half;
        const wz = (py / (N - 1)) * t.size - half;
        const h = t.getHeightAt(wx, wz);
        let r, g, b;
        if (h < t.seaLevel) { r = 43; g = 111; b = 176; }
        else if (h < t.seaLevel + 1.2) { r = 216; g = 201; b = 143; }
        else if (h < t.maxHeight * 0.4) { r = 77; g = 143; b = 63; }
        else if (h < t.maxHeight * 0.68) { r = 60; g = 113; b = 54; }
        else if (h < t.maxHeight * 0.85) { r = 119; g = 117; b = 106; }
        else { r = 232; g = 238; b = 242; }
        const i = (py * N + px) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    this.base = off;
  }

  setVisible(v) { this.canvas?.classList.toggle('hidden', !v); }

  _px(wx) { return ((wx + this.worldSize / 2) / this.worldSize) * this.canvas.width; }

  draw(world, playerPos, facing, enemies) {
    if (!this.ctx || !this.base) return;
    const ctx = this.ctx, W = this.canvas.width;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(this.base, 0, 0, W, W);

    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this._px(x), this._px(z), r, 0, Math.PI * 2);
      ctx.fill();
    };

    dot(0, 0, '#ffd23f', 3.5);                                  // village
    if (world.entrancePos) dot(world.entrancePos.x, world.entrancePos.z, '#6fe3c4', 3.5); // vault
    if (enemies) {
      ctx.globalAlpha = 0.9;
      for (const e of enemies) { if (!e.dead) dot(e.mesh.position.x, e.mesh.position.z, '#ff5a5a', 2); }
      ctx.globalAlpha = 1;
    }

    // Player arrow (map is north-up; rotate to the facing direction).
    const px = this._px(playerPos.x), py = this._px(playerPos.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - facing);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#10141c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
