const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME_READY__ === true, { timeout: 60000 });
await page.evaluate(() => {
  const g = window.game;
  g.newGame();
  g.player.model = null;            // drive the model by hand
  g.cameraRig.yaw = Math.PI / 2;    // side view
  g.cameraRig.targetDistance = 4.5;
});
await page.waitForTimeout(1500);
const S = process.env.SHOTDIR;
for (const t of [0.15, 0.4, 0.65, 0.9, 1.3]) {
  await page.evaluate((t) => {
    const g = window.game;
    const pose = {
      speed: 8, runBlend: 1, sprinting: false, grounded: true, yVel: 0,
      guarding: false, swimming: false, attack: null,
      roll: t <= 1 ? { t } : null,   // t>1 → just after the roll (unwind check)
      hurt: null, dead: false, charge: 0, idleTime: 0, iframes: false,
    };
    for (let i = 0; i < 24; i++) g.hero.update(1 / 60, pose);
    g.hero.group.position.copy(g.player.position);
  }, t);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${S}/roll-${t}.png`, clip: { x: 250, y: 100, width: 420, height: 400 } });
}
await browser.close();
console.log('done');
