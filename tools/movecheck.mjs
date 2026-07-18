const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8000/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__GAME_READY__ === true, { timeout: 60000 });
await page.evaluate(() => window.game.newGame());
await page.waitForTimeout(800);

for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.8]) {
  const r = await page.evaluate(async (yaw) => {
    const g = window.game;
    const frames = (n) => new Promise((res) => { let c = 0; const t = () => (++c > n ? res() : requestAnimationFrame(t)); requestAnimationFrame(t); });
    // Flat, obstacle-free spot; pin the camera at the requested yaw.
    g.player.respawn(-60, 260, 0);
    g.cameraRig.lockTarget = null;
    g.cameraRig.yaw = yaw;
    g.player.velocity.set(0, 0, 0);
    await frames(2);
    const start = { x: g.player.position.x, z: g.player.position.z };
    g.input.virtual.z = -1; // hold "forward"
    g.cameraRig.yaw = yaw;  // keep pinned
    await frames(14);
    g.input.virtual.z = 0;
    const dx = g.player.position.x - start.x;
    const dz = g.player.position.z - start.z;
    const len = Math.hypot(dx, dz) || 1;
    // Camera forward on the ground plane:
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return { yaw: +yaw.toFixed(2), moved: +len.toFixed(2), dot: +((dx / len) * fx + (dz / len) * fz).toFixed(3) };
  }, yaw);
  console.log(JSON.stringify(r));
}
await browser.close();
