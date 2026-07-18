// Static circle colliders (trees, rocks, buildings, walls) in a uniform grid
// hash. Entities call resolve() to get pushed out of solids.

export class Colliders {
  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.all = [];
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  /** c: {x, z, r, h?, tag?} — h is optional height (0 top = can step over none). */
  add(c) {
    this.all.push(c);
    const cs = this.cellSize;
    const minX = Math.floor((c.x - c.r) / cs), maxX = Math.floor((c.x + c.r) / cs);
    const minZ = Math.floor((c.z - c.r) / cs), maxZ = Math.floor((c.z + c.r) / cs);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = this._key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(c);
      }
    }
    return c;
  }

  addMany(list) { for (const c of list) this.add(c); }

  /** Remove a collider previously added (rebuilds affected cells lazily). */
  remove(c) {
    const i = this.all.indexOf(c);
    if (i >= 0) this.all.splice(i, 1);
    for (const arr of this.grid.values()) {
      const j = arr.indexOf(c);
      if (j >= 0) arr.splice(j, 1);
    }
  }

  forEachNear(x, z, r, cb) {
    const cs = this.cellSize;
    const minX = Math.floor((x - r) / cs), maxX = Math.floor((x + r) / cs);
    const minZ = Math.floor((z - r) / cs), maxZ = Math.floor((z + r) / cs);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const arr = this.grid.get(this._key(cx, cz));
        if (arr) for (const c of arr) cb(c);
      }
    }
  }

  /**
   * Push a circle (px, pz, radius) out of any overlapping colliders.
   * `py` lets tall entities ignore low colliders they're standing above.
   * Returns {x, z, hit}.
   */
  resolve(px, pz, radius, py = -Infinity) {
    let x = px, z = pz, hit = false;
    // Two iterations handles corner overlaps well enough.
    for (let iter = 0; iter < 2; iter++) {
      this.forEachNear(x, z, radius + 2, (c) => {
        if (c.top !== undefined && py > c.top) return; // standing above it
        const dx = x - c.x, dz = z - c.z;
        const d2 = dx * dx + dz * dz;
        const minD = radius + c.r;
        if (d2 < minD * minD && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / d;
          x += dx * push; z += dz * push;
          hit = true;
        }
      });
      if (!hit) break;
    }
    return { x, z, hit };
  }
}
