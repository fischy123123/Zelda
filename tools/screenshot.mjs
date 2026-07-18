// Boot the game in headless Chromium, capture console output and screenshots.
// Usage: node tools/screenshot.mjs [outDir] [--play]
//   --play: start a new game and simulate a few seconds of gameplay input.
// Requires a static server on :8000 (npm run serve) and global playwright.

import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shots';
const doPlay = process.argv.includes('--play');
mkdirSync(outDir, { recursive: true });

const { chromium } = await import('playwright');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack || ''}`));

await page.goto('http://localhost:8000/', { waitUntil: 'load' });

const ready = await page
  .waitForFunction(() => window.__GAME_READY__ === true || window.__GAME_ERROR__, { timeout: 45000 })
  .then(() => page.evaluate(() => window.__GAME_ERROR__ || 'ready'))
  .catch(() => 'timeout');
console.log('boot:', ready);

// Let the title scene render a few frames.
await page.waitForTimeout(6000);
await page.screenshot({ path: `${outDir}/01-title.png` });

if (doPlay && ready === 'ready') {
  await page.evaluate(() => window.game.newGame());
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outDir}/02-spawn.png` });

  // Walk forward, look around, swing the sword.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${outDir}/03-walk.png` });
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/04-attack.png` });

  // Dusk + night looks.
  await page.evaluate(() => window.game.sky.setTimeOfDay && window.game.sky.setTimeOfDay(0.74));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/05-dusk.png` });
  await page.evaluate(() => window.game.sky.setTimeOfDay && window.game.sky.setTimeOfDay(0.95));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/06-night.png` });

  const stats = await page.evaluate(() => ({
    mode: window.game.mode,
    enemies: window.game.enemies.length,
    calls: window.game.renderer.info.render.calls,
    triangles: window.game.renderer.info.render.triangles,
    pos: window.game.player.position.toArray().map((v) => +v.toFixed(1)),
  }));
  console.log('stats:', JSON.stringify(stats));

  // Location tour.
  const tp = async (name, x, z, tod, yaw = 0.5) => {
    await page.evaluate(([x, z, tod, yaw]) => {
      const g = window.game;
      g.sky.setTimeOfDay(tod);
      g.player.respawn(x, z, yaw);
      g.cameraRig.snapBehind(g.player, yaw + Math.PI * 0.9);
    }, [x, z, tod, yaw]);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${outDir}/${name}.png` });
  };
  await tp('10-village', 60, 10, 0.45, Math.PI);
  await tp('11-lake', -260, 140, 0.55, -1.2);
  await tp('12-forest', -60, -380, 0.4, Math.PI);
  await tp('13-shrine', -150, -480, 0.5, Math.PI);
  await tp('14-camp', 275, -150, 0.5, 0.4);
  // Dungeon interior.
  await page.evaluate(() => window.game.dungeon.enter());
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/15-dungeon.png` });
}

console.log('--- console log (errors/warnings) ---');
for (const l of logs) if (!l.startsWith('[log]')) console.log(l);
console.log(`--- total console lines: ${logs.length} ---`);

await browser.close();
