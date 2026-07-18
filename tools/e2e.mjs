// End-to-end functional test: drives real game systems via the console API
// and asserts on outcomes. Slow-renderer safe (state-driven, not input-driven).
// Usage: node tools/e2e.mjs   (requires server on :8000)

const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME_READY__ === true, { timeout: 60000 });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
};

// Frame-stepper: waits for N rendered frames (not wall time).
const frames = (n) => page.evaluate((n) => new Promise((res) => {
  let c = 0;
  const tick = () => { if (++c >= n) res(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), n);

// --- boot + new game --------------------------------------------------------
await page.evaluate(() => window.game.newGame());
await frames(5);
check('newGame starts playing', await page.evaluate(() => game.mode === 'playing'));
check('hud state sane', await page.evaluate(() => game.state.hp === 12 && game.state.maxHp === 12));

// --- combat: strike a boglin ------------------------------------------------
const combat = await page.evaluate(async () => {
  const g = window.game;
  const e = g.enemies.find((x) => x.type === 'boglin' && x.alive);
  if (!e) return { err: 'no boglin' };
  // Teleport next to it and face it.
  const p = g.player;
  p.position.set(e.group.position.x - 1.6, e.group.position.y, e.group.position.z);
  p.yaw = Math.atan2(e.group.position.x - p.position.x, e.group.position.z - p.position.z);
  const hpBefore = e.hp;
  p.attack = { index: 0, t: 0.12, hitSet: new Set() }; // mid-swing, active window next frames
  await new Promise((res) => { let c = 0; const t = () => (++c > 8 ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  return { hpBefore, hpAfter: e.hp, aggro: e.aggro };
});
check('sword hit damages boglin', combat.hpAfter < combat.hpBefore, JSON.stringify(combat));
check('boglin aggros on hit', combat.aggro === true);

// --- kill → death event, loot drops ----------------------------------------
const kill = await page.evaluate(async () => {
  const g = window.game;
  const e = g.enemies.find((x) => x.type === 'boglin' && x.alive);
  if (!e) return { err: 'no boglin' };
  let death = false;
  g.events.on('enemy:death', () => { death = true; });
  const before = g.pickups.length;
  e.takeDamage(99, null, 0);
  await new Promise((res) => { let c = 0; const t = () => (++c > 6 ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  return { death, dropped: g.pickups.length > before, alive: e.alive };
});
check('enemy dies and emits event', kill.death === true && kill.alive === false);
check('enemy drops loot', kill.dropped === true);

// --- quests via dialogue actions -------------------------------------------
const quests = await page.evaluate(() => {
  const g = window.game;
  g.quests.startMain();
  g.quests.startHorde();
  const q1 = g.state.quests['shattered-star'].stage === 1;
  // Simulate 10 boglin kills.
  for (let i = 0; i < 10; i++) g.events.emit('enemy:death', { type: 'boglin', pos: g.player.position });
  const canTurn = g.quests.canTurnInHorde();
  const gemsBefore = g.state.gems;
  const stamBefore = g.state.maxStamina;
  g.quests.turnInHorde();
  return {
    q1, canTurn,
    gems: g.state.gems - gemsBefore,
    stam: g.state.maxStamina - stamBefore,
    objective: g.quests.activeObjective()?.title,
  };
});
check('main quest starts', quests.q1);
check('horde quest counts kills + turn-in (+80 gems, +25 stam)',
  quests.canTurn && quests.gems === 80 && quests.stam === 25, JSON.stringify(quests));
check('active objective is main quest', quests.objective === 'The Shattered Star');

// --- dialogue UI -------------------------------------------------------------
const dlg = await page.evaluate(async () => {
  const g = window.game;
  const { getDialogue } = await import('./js/data/dialogue.js');
  const { def, entry } = getDialogue('tam', g);
  g.ui.dialogue.start(def, entry);
  const open = g.ui.dialogue.open && g.modals.has('dialogue');
  // Force-close.
  g.ui.dialogue._end();
  return { open, closed: !g.modals.has('dialogue') };
});
check('dialogue opens + sets modal', dlg.open);
check('dialogue closes + clears modal', dlg.closed);

// --- potion use --------------------------------------------------------------
const potion = await page.evaluate(() => {
  const g = window.game;
  g.state.hp = 4;
  const before = g.state.items.potion || 0;
  const used = g.useItem('potion');
  return { used, hp: g.state.hp, delta: (g.state.items.potion || 0) - before };
});
check('potion heals 3 hearts and is consumed', potion.used && potion.hp === 12 && potion.delta === -1);

// --- dungeon + boss ----------------------------------------------------------
const dungeon = await page.evaluate(async () => {
  const g = window.game;
  g.dungeon.enter();
  await new Promise((r) => setTimeout(r, 1200)); // fade
  const inside = g.inDungeon && g.player.groundProvider === g.dungeon;
  return { inside, underground: g.sky.underground };
});
check('dungeon entry teleports + sets state', dungeon.inside && dungeon.underground);

const boss = await page.evaluate(async () => {
  const g = window.game;
  const frames = (n) => new Promise((res) => { let c = 0; const t = () => (++c > n ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  // Walk into the arena: teleport to its center.
  let started = false, ended = false, hpEvents = 0;
  g.events.on('boss:start', () => { started = true; });
  g.events.on('boss:hp', () => { hpEvents++; });
  g.events.on('boss:end', (e) => { ended = e.victory; });
  g.player.position.set(3000, g.dungeon.heightAt(3000, 3000 - 122), 3000 - 122);
  await frames(10);
  const bossEnemy = g.enemies.find((e) => e.name && /colossus/i.test(e.name));
  if (!bossEnemy) return { started, err: 'boss not in enemies' };
  // Wait out the rise intro (invulnerable), then beat it down.
  for (let i = 0; i < 120 && (bossEnemy.state === 'dormant' || bossEnemy.state === 'rise'); i++) await frames(1);
  const stateAtFight = bossEnemy.state;
  for (let i = 0; i < 80 && bossEnemy.alive; i++) {
    bossEnemy.takeDamage(3, null, 0);
    await frames(1);
  }
  await frames(30);
  return { started, ended, hpEvents, dead: !bossEnemy.alive, stateAtFight, sword: g.state.sword };
});
check('boss fight starts on arena entry', boss.started, JSON.stringify(boss));
check('boss emits hp events and dies', boss.hpEvents > 5 && boss.dead === true);
check('boss victory event fires', boss.ended === true);

// --- sunblade chest ----------------------------------------------------------
const sunblade = await page.evaluate(async () => {
  const g = window.game;
  const frames = (n) => new Promise((res) => { let c = 0; const t = () => (++c > n ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  await frames(10);
  // Find the big chest via interactables.
  const items = [...g.interact.items].filter((i) => i.position.x > 2500);
  for (const it of items) {
    if ((typeof it.prompt === 'function' ? it.prompt() : it.prompt) === 'Open') it.onInteract(g);
  }
  await frames(6);
  return { sword: g.state.sword, cleared: !!g.state.flags.shrineCleared, mainStage: g.state.quests['shattered-star']?.stage };
});
check('sunblade chest equips sunblade + flags shrine cleared',
  sunblade.sword === 'sunblade' && sunblade.cleared === true, JSON.stringify(sunblade));
check('main quest advances to return stage', sunblade.mainStage === 2);

// --- exit + save/load --------------------------------------------------------
const saveload = await page.evaluate(async () => {
  const g = window.game;
  g.dungeon.exit();
  await new Promise((r) => setTimeout(r, 1200));
  const outside = !g.inDungeon && g.player.groundProvider === g.terrain;
  g.state.gems = 123;
  const saved = g.save();
  g.state.gems = 0;
  g.continueGame();
  return { outside, saved, gems: g.state.gems, sword: g.state.sword };
});
check('dungeon exit restores overworld', saveload.outside);
check('save + continue restores state', saveload.saved && saveload.gems === 123 && saveload.sword === 'sunblade');

// --- death + respawn ---------------------------------------------------------
const death = await page.evaluate(async () => {
  const g = window.game;
  const frames = (n) => new Promise((res) => { let c = 0; const t = () => (++c > n ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  g.state.hp = 1;
  g.player._iframes = 0;
  g.player.takeDamage(4, null, 0);
  await frames(4);
  const dead = g.mode === 'dead';
  g.respawnPlayer();
  await frames(4);
  return { dead, respawned: g.mode === 'playing' && g.state.hp >= 8 && g.player.alive };
});
check('death triggers dead mode', death.dead);
check('respawn restores play', death.respawned);

// --- audio + postfx sanity ---------------------------------------------------
const misc = await page.evaluate(() => ({
  postfxLive: !window.game.postfx._failed,
  audioExists: typeof window.game.audio.sfx === 'function',
  fps: 'n/a',
}));
check('postfx pipeline never fell back', misc.postfxLive);
check('audio engine callable', misc.audioExists);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) {
  console.log('--- page errors ---');
  for (const e of errors.slice(0, 20)) console.log(e);
}
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
