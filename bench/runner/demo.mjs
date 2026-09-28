// Browser smoke test for the demo task: loads the built extension into Chromium, scans the scanned ID card,
// fills the bank form end to end and fails if anything was blocked or the form did not complete.
// Needs the server on :8000, demo-sites on :5500 and `npm run build` in extension/ (see README).
//
//   npm install && npx playwright install chromium && node demo.mjs
//   CHROMIUM=/path/to/chrome node demo.mjs    (any Chromium build that still accepts --load-extension)
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../../extension/.output/chrome-mv3', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const DEMO = process.env.DEMO_URL ?? 'http://localhost:5500';
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'veil-'));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM || undefined,
  headless: true,
  viewport: { width: 1280, height: 800 },
  // Software GL so captureVisibleTab can read back frames in headless mode.
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const fail = async (msg) => { console.error(`FAIL: ${msg}`); await ctx.close(); rmSync(profile, { recursive: true, force: true }); process.exit(1); };

const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${sw.url().split('/')[2]}/sidepanel.html`);
const logs = () => panel.$$eval('#log li', (li) => li.map((l) => `[${l.className}] ${l.textContent}`).reverse());
const saveFrame = async (name) => {
  const src = await panel.getAttribute('#frame', 'src');
  if (src?.startsWith('data:')) writeFileSync(join(OUT, name), Buffer.from(src.split(',')[1], 'base64'));
};

// 1. Scan the ID card, which is only an image, into the vault.
const page = await ctx.newPage();
await page.goto(`${DEMO}/id-card-scan.html`);
await page.bringToFront();
await page.waitForTimeout(1000);
await panel.evaluate(() => document.getElementById('scan').click());
await panel.waitForFunction(() => [...document.querySelectorAll('#log li')].some((l) => /Scanned|error/.test(l.className + l.textContent)), null, { timeout: 60000 });
await saveFrame('scan-sent.webp');
const tokens = await panel.$$eval('#tokens .tok', (b) => b.map((x) => x.textContent));
console.log('Scan:', (await panel.textContent('#timings')).replace(/ms/g, 'ms '), '\nTokens:', tokens.join(' '));
for (const cls of ['NAME', 'DOB', 'AADHAAR', 'PAN', 'PHONE', 'EMAIL', 'ADDRESS', 'FACE', 'QR'])
  if (!tokens.includes(`⟦${cls}_1⟧`)) await fail(`scan did not produce ⟦${cls}_1⟧\n${(await logs()).join('\n')}`);

// 2. Fill the bank form from the vault. The user sets the password and approves the submit.
await page.goto(`${DEMO}/bank-form.html`);
await page.bringToFront();
await panel.fill('#goal', 'Open a savings account using my ID card details');
await panel.evaluate(() => { document.getElementById('review').checked = false; document.getElementById('start').click(); });
const end = Date.now() + 60000;
while (Date.now() < end && !/Done|Stopped|Blocked|limit/.test(await panel.textContent('#status'))) {
  if (await panel.isVisible('#approval')) {
    if (/password/i.test(await panel.textContent('#ap-detail'))) {
      await page.fill('#pw', 'Demo#Pass2026');
      await page.fill('#pw2', 'Demo#Pass2026');
    }
    await panel.click('#ap-yes');
  }
  await panel.waitForTimeout(250);
}
await saveFrame('last-sent.webp');
const thanks = await page.textContent('#thanks');
console.log((await logs()).join('\n'));
if (!/Thanks, Ananya Rao/.test(thanks ?? '')) await fail(`bank form did not complete (status: ${await panel.textContent('#status')})`);
if ((await logs()).some((l) => /firewall blocked|guard rejected/i.test(l))) await fail('a payload was blocked');
console.log(`PASS. Sent frames saved in ${OUT}`);
await ctx.close();
rmSync(profile, { recursive: true, force: true });
