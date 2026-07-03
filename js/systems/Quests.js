// The main quest line. The game holds an index into this list; each entry's
// objective is shown on the HUD. Progression is monotonic (see Game.milestone).
export const QUESTS = [
  { id: 'meet',   objective: 'Speak with Elder Maru in Hylia Village' },
  { id: 'vault',  objective: 'Enter the Sunken Vault — the glowing arch to the north-east' },
  { id: 'key',    objective: 'Defeat the key-bearing Moblin and take its Small Key' },
  { id: 'boss',   objective: 'Unlock the golden gate and slay Gorlok the Vault-Keeper' },
  { id: 'shard',  objective: 'Claim the Shard of Power from the reliquary' },
  { id: 'return', objective: 'Return to Elder Maru in Hylia Village' },
  { id: 'done',   objective: 'The realm is at peace — explore, adventurer!' },
];
