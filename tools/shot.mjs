// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [waitMs] [evalJs]
import { chromium } from 'playwright-core';
const [url, out, w = '1440', h = '900', wait = '6000', js] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
if (js) { await page.evaluate(js); await page.waitForTimeout(3000); }
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
