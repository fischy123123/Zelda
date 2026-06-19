import { getItem } from '../data/items.js?v=5';

// Tracks owned items, rupees, keys, and the currently equipped gear.
export class Inventory {
  constructor() {
    this.rupees = 0;
    this.keys = 0;
    this.items = {};            // id -> count
    this.equipped = { weapon: null, offhand: null };
  }

  add(itemId, count = 1) {
    const def = getItem(itemId);
    if (!def) return;
    if (itemId === 'key') { this.keys += count; return; }
    this.items[itemId] = (this.items[itemId] || 0) + count;
    // Auto-equip the first weapon/offhand we pick up.
    if (def.equippable) {
      if (itemId === 'shield' && !this.equipped.offhand) this.equipped.offhand = itemId;
      else if (itemId !== 'shield' && !this.equipped.weapon) this.equipped.weapon = itemId;
    }
  }

  has(itemId) { return (this.items[itemId] || 0) > 0; }

  useKey() {
    if (this.keys <= 0) return false;
    this.keys -= 1;
    return true;
  }

  addRupees(n) { this.rupees += n; }

  equip(itemId) {
    const def = getItem(itemId);
    if (!def || !def.equippable || !this.has(itemId)) return;
    if (itemId === 'shield') this.equipped.offhand = itemId;
    else this.equipped.weapon = itemId;
  }

  // List of { def, count, equipped } for the UI.
  list() {
    return Object.keys(this.items)
      .filter((id) => this.items[id] > 0)
      .map((id) => ({
        def: getItem(id),
        count: this.items[id],
        equipped: this.equipped.weapon === id || this.equipped.offhand === id,
      }));
  }

  toJSON() {
    return { rupees: this.rupees, keys: this.keys, items: this.items, equipped: this.equipped };
  }

  fromJSON(data) {
    if (!data) return;
    this.rupees = data.rupees || 0;
    this.keys = data.keys || 0;
    this.items = data.items || {};
    this.equipped = data.equipped || { weapon: null, offhand: null };
  }
}
