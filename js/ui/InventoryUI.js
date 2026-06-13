// Renders the inventory overlay grid. Clicking an equippable item equips it.
export class InventoryUI {
  constructor(inventory, onEquip) {
    this.inventory = inventory;
    this.onEquip = onEquip;
    this.el = document.getElementById('inventory');
    this.gridEl = document.getElementById('inv-grid');
    this.open = false;
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true;
    this.render();
    this.el.classList.remove('hidden');
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  render() {
    this.gridEl.innerHTML = '';
    const items = this.inventory.list();
    // Always render at least 8 slots so the panel has a consistent shape.
    const slots = Math.max(8, items.length);
    for (let i = 0; i < slots; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      const item = items[i];
      if (item) {
        slot.classList.add('filled');
        if (item.equipped) slot.classList.add('equipped');
        slot.innerHTML =
          `<div class="inv-emoji">${item.def.emoji}</div>` +
          `<div class="inv-name">${item.def.name}</div>` +
          (item.count > 1 ? `<div class="inv-count">×${item.count}</div>` : '');
        slot.title = item.def.description;
        if (item.def.equippable) {
          slot.style.cursor = 'pointer';
          slot.addEventListener('click', () => {
            this.inventory.equip(item.def.id);
            this.onEquip?.(item.def.id);
            this.render();
          });
        }
      }
      this.gridEl.appendChild(slot);
    }
  }
}
