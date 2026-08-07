/**
 * Headless render check for the room view.
 *
 * A WebGL scene can build cleanly and still render nothing, so "it compiled" is not
 * evidence. This loads the built page in Chromium, asserts the canvas has a live GL
 * context, drives a real selection click, and writes a screenshot to look at.
 *
 * Usage: node scripts/smoke.mjs <built-html> <screenshot-out.png>
 *
 * This is the seed of the on-device perf harness in
 * docs/gearbox/10-quality-devops.md §10.1 — same shape, real hardware later.
 */

import { chromium } from 'playwright-core';

const file = process.argv[2] ?? 'dist/index.html';
const shot = process.argv[3] ?? 'dist/room.png';

// Chromium is preinstalled in the CI image; software GL keeps this headless-safe.
const executablePath =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

const url = file.startsWith('/') ? `file://${file}` : `file://${process.cwd()}/${file}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3500);

const initialStatus = await page.textContent('#status');
const hasCanvas = await page.evaluate(() => !!document.querySelector('#stage canvas'));
const webgl = await page.evaluate(() => {
  const c = document.querySelector('#stage canvas');
  if (!c) return false;
  return !!(c.getContext('webgl2') || c.getContext('webgl'));
});
const vrButton = await page.evaluate(() => {
  const b = document.querySelector('#vr-slot button');
  return b ? b.textContent.trim() : null;
});

// Click a different item and confirm the selection actually changes.
await page.mouse.click(908, 450);
await page.waitForTimeout(900);
const statusAfterClick = await page.textContent('#status');
const presence = await page.textContent('#presence');

await page.screenshot({ path: shot });
await browser.close();

const result = { initialStatus, statusAfterClick, presence, hasCanvas, webgl, vrButton, errors };
console.log(JSON.stringify(result, null, 2));

const failures = [];
if (!hasCanvas) failures.push('no canvas was created');
if (!webgl) failures.push('canvas has no WebGL context');
if (initialStatus === statusAfterClick) failures.push('clicking an item did not change selection');
if (errors.length > 0) failures.push(`${errors.length} runtime error(s)`);
if (!presence || !presence.includes('in room')) failures.push('presence pill missing or empty');

if (failures.length > 0) {
  console.error(`[smoke] FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('[smoke] ok');
