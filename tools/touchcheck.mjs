const { chromium, devices } = await import('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME_READY__ === true, { timeout: 60000 });
await page.evaluate(() => {
  window.game.newGame();
  window.__attacks = 0;
  window.game.events.on('player:attack', () => window.__attacks++);
});
await page.touchscreen.tap(200, 500); // wake touch UI
await page.waitForTimeout(2500);

const btn = await page.locator('.tb-attack').boundingBox();
if (!btn) { console.log('NO ATTACK BUTTON'); process.exit(1); }
// Rapid-fire 8 taps on the attack button.
for (let i = 0; i < 8; i++) {
  await page.touchscreen.tap(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);
const attacks = await page.evaluate(() => window.__attacks);
console.log('attack events from rapid taps:', attacks);

// Pause button (menu-style, needs click synthesis to still work).
const pb = await page.locator('.tb-sys').first().boundingBox();
await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
await page.waitForTimeout(1500);
const paused = await page.evaluate(() => window.game.modals.has('pause'));
console.log('pause via touch works:', paused);
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(attacks > 0 && paused ? 0 : 1);
