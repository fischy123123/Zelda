// Item definitions for the inventory. Emoji stand in for icon art so the game
// stays fully self-contained (no external image assets).
export const ITEMS = {
  sword: {
    id: 'sword',
    name: 'Hero Sword',
    emoji: '🗡️',
    equippable: true,
    description: 'A trusty blade. Swing with Click or F.',
  },
  shield: {
    id: 'shield',
    name: 'Wooden Shield',
    emoji: '🛡️',
    equippable: true,
    description: 'Reduces damage from frontal blows.',
  },
  key: {
    id: 'key',
    name: 'Small Key',
    emoji: '🗝️',
    stackable: true,
    description: 'Opens a locked dungeon door.',
  },
  heartContainer: {
    id: 'heartContainer',
    name: 'Heart Container',
    emoji: '💗',
    description: 'Permanently raises maximum health.',
  },
  bomb: {
    id: 'bomb',
    name: 'Bombs',
    emoji: '💣',
    stackable: true,
    equippable: true,
    description: 'Explosive flowers in a bag.',
  },
  bow: {
    id: 'bow',
    name: 'Hero Bow',
    emoji: '🏹',
    equippable: true,
    description: 'Fire arrows at distant foes.',
  },
  triforce: {
    id: 'triforce',
    name: 'Shard of Power',
    emoji: '🔺',
    description: 'A glowing relic — the dungeon\'s reward.',
  },
};

export function getItem(id) {
  return ITEMS[id] || null;
}
