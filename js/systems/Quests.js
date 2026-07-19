// Quest state machine. Stages live in game.state.quests[id] = {stage, count}
// so they persist through saves; this class owns transitions, event tracking,
// rewards, and the HUD objective line.

export class Quests {
  constructor(game) {
    this.game = game;

    // Public defs (UI reads titles + per-stage objective text).
    this.defs = {
      'shattered-star': {
        title: 'The Great Celestial Screw-Up',
        main: true,
        objectives: {
          1: 'Find the Hollow Shrine up north and un-screw whatever the star screwed up.',
          2: 'Haul the Sunblade back to Elder Maren before she dies of old age and spite.',
        },
        done: 3,
      },
      'mushroom-medicine': {
        title: 'Shroom Service',
        objectives: { 1: 'Grab 5 glowshrooms for Nyla. Do NOT lick them.' },
        done: 2,
      },
      'thin-the-horde': {
        title: 'Pest Control (Extremely Violent)',
        objectives: { 1: 'Un-alive 10 boglins for Captain Bram. Avenge his mooning.' },
        done: 2,
      },
    };

    const ev = game.events;
    ev.on('enemy:death', ({ type }) => {
      if ((type === 'boglin' || type === 'boglin_brute') && this.stage('thin-the-horde') === 1) {
        const q = this.get('thin-the-horde');
        if (q.count < 10) {
          q.count++;
          this._notify('thin-the-horde', q.count >= 10
            ? 'Horde thoroughly murdered! Go brag to Captain Bram.'
            : `Boglins un-alived: ${q.count}/10`);
        }
      }
    });
    ev.on('item:added', ({ id }) => {
      if (id === 'glowshroom' && this.stage('mushroom-medicine') === 1) {
        const n = game.state.items.glowshroom || 0;
        this._notify('mushroom-medicine', n >= 5
          ? 'Take the shrooms to Nyla. Still un-licked, hopefully.'
          : `Glowshrooms grabbed (not licked): ${Math.min(n, 5)}/5`);
      }
    });
    ev.on('boss:end', ({ victory }) => {
      if (victory && this.stage('shattered-star') === 1) {
        this.setStage('shattered-star', 2);
      }
    });
  }

  // -------------------------------------------------------------------------
  get(id) {
    const qs = this.game.state.quests;
    if (!qs[id]) qs[id] = { stage: 0, count: 0 };
    return qs[id];
  }

  stage(id) { return this.get(id).stage; }

  setStage(id, stage) {
    const q = this.get(id);
    if (q.stage === stage) return;
    const was = q.stage;
    q.stage = stage;
    const def = this.defs[id];
    if (!def) return;
    const ev = this.game.events;
    if (was === 0 && stage > 0 && stage < def.done) {
      ev.emit('quest:started', { id, title: def.title, text: def.objectives[stage] || '' });
      ev.emit('toast', { text: `New quest: ${def.title}` });
    } else if (stage >= def.done) {
      ev.emit('quest:completed', { id, title: def.title });
      ev.emit('toast', { text: `Quest complete: ${def.title}` });
    } else {
      ev.emit('quest:updated', { id, title: def.title, text: def.objectives[stage] || '' });
    }
  }

  _notify(id, text) {
    const def = this.defs[id];
    this.game.events.emit('quest:updated', { id, title: def.title, text });
  }

  isComplete(id) { return this.stage(id) >= (this.defs[id]?.done ?? 99); }

  /** HUD objective line: the main quest wins; otherwise first active side quest. */
  activeObjective() {
    const order = ['shattered-star', 'mushroom-medicine', 'thin-the-horde'];
    for (const id of order) {
      const def = this.defs[id];
      const st = this.stage(id);
      if (st > 0 && st < def.done) {
        let text = def.objectives[st] || '';
        if (id === 'thin-the-horde') text = `Un-alive boglins for Captain Bram (${Math.min(this.get(id).count, 10)}/10).`;
        if (id === 'mushroom-medicine') text = `Grab glowshrooms, no licking (${Math.min(this.game.state.items.glowshroom || 0, 5)}/5).`;
        return { title: def.title, text };
      }
    }
    return null;
  }

  /** Re-sync HUD after loading a save. */
  restore() {
    for (const id of Object.keys(this.defs)) {
      const def = this.defs[id];
      const st = this.stage(id);
      if (st > 0 && st < def.done) {
        this.game.events.emit('quest:updated', { id, title: def.title, text: def.objectives[st] || '' });
      }
    }
  }

  update() {}

  // --- turn-in helpers used by dialogue actions -----------------------------
  startMain() { if (this.stage('shattered-star') === 0) this.setStage('shattered-star', 1); }

  completeMain() {
    if (this.stage('shattered-star') !== 2) return;
    const g = this.game;
    this.setStage('shattered-star', 3);
    g.state.gems += 100;
    g.events.emit('gems', { total: g.state.gems, delta: 100 });
    g.addMaxHeart();
    g.events.emit('toast', { text: 'Maren blesses your shapely ass: +1 heart container, +100 gems!' });
  }

  startShrooms() { if (this.stage('mushroom-medicine') === 0) this.setStage('mushroom-medicine', 1); }

  canTurnInShrooms() {
    return this.stage('mushroom-medicine') === 1 && (this.game.state.items.glowshroom || 0) >= 5;
  }

  turnInShrooms() {
    if (!this.canTurnInShrooms()) return;
    const g = this.game;
    g.state.items.glowshroom -= 5;
    g.state.items.potion = (g.state.items.potion || 0) + 2;
    g.state.gems += 40;
    g.events.emit('gems', { total: g.state.gems, delta: 40 });
    g.events.emit('item:added', { id: 'potion', name: 'Restorative Potion' });
    this.setStage('mushroom-medicine', 2);
    g.events.emit('toast', { text: 'Nyla brews 2 potions. They taste like feet. (+40 gems)' });
  }

  startHorde() { if (this.stage('thin-the-horde') === 0) this.setStage('thin-the-horde', 1); }

  canTurnInHorde() { return this.stage('thin-the-horde') === 1 && this.get('thin-the-horde').count >= 10; }

  turnInHorde() {
    if (!this.canTurnInHorde()) return;
    const g = this.game;
    g.state.gems += 80;
    g.events.emit('gems', { total: g.state.gems, delta: 80 });
    g.state.maxStamina += 25;
    g.state.stamina = g.state.maxStamina;
    this.setStage('thin-the-horde', 2);
    g.events.emit('toast', { text: 'Bram’s dubious monk training: +25 max stamina, +80 gems!' });
  }
}
