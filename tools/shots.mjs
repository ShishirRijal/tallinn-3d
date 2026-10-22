// Usage: node tools/shots.mjs <outDir> <hash1,hash2,...> [width] [height]
// Opens the app once per hash and saves <outDir>/<hash>.png
import { chromium } from 'playwright-core';
const [outDir, hashes, w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const hash of hashes.split(',')) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.on('pageerror', (e) => console.log(`[${hash}] pageerror ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${hash}] ${m.text()}`));
  await page.goto(`http://localhost:5173/${hash === 'home' ? '' : '#' + hash}`);
  await page.waitForFunction(() => document.querySelector('#loader')?.classList.contains('done'), null, { timeout: 60000 });
  await page.waitForTimeout(hash === 'home' ? 4500 : 3000);
  await page.screenshot({ path: `${outDir}/${hash}.png` });
  await page.close();
}
await browser.close();
