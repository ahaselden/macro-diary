// Starts the app on a free port and opens it in a headless browser of its own (never the user's browser). Dev-only: needs `npm install` in this folder.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { routeFor } from './stubs.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.unref(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

/** Starts scripts/serve.mjs on a free port; resolves { url, stop }. */
export async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(repoRoot, 'scripts/serve.mjs'), String(port)], { cwd: repoRoot, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url + '/index.html')).ok) return { url, stop: () => child.kill() }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill(); throw new Error('The dev server did not start.');
}

/** Edge, then Chrome (whichever is installed). Throws a clear message when neither is. */
export async function launchBrowser({ headed = false } = {}) {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];   // a fake camera, no permission prompt
  let last;
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: !headed, args }); } catch (e) { last = e; }
  }
  throw new Error('Could not start Microsoft Edge or Google Chrome (is one installed?). ' + String((last && last.message) || last).split('\n')[0]);
}

/** A fresh browser context (own storage, service worker blocked) with the stubs applied; every external request is aborted unless stubbed. */
export async function openPage(browser, { appUrl, stubs = [], device, screenshotDir }) {
  if (device && !devices[device]) throw new Error(`Unknown device "${device}". Try "iPhone 13" or "Pixel 7".`);
  const dev = device ? (({ defaultBrowserType, ...rest }) => rest)(devices[device]) : {};
  const context = await browser.newContext({ ...dev, serviceWorkers: 'block', permissions: ['camera'] });
  const consoleErrors = [];
  await context.route('**/*', route => {
    const r = routeFor(route.request().url(), { appOrigin: appUrl, stubs });
    if (r.action === 'fulfill') return route.fulfill({ status: r.status, contentType: r.contentType, body: r.body });
    if (r.action === 'abort') return route.abort();
    return route.continue();
  });
  await context.routeWebSocket('**', ws => ws.close());                      // WebSockets are not covered by route(): close them too
  const page = await context.newPage();
  page.on('pageerror', e => consoleErrors.push('Uncaught: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) consoleErrors.push(m.text()); });   // ERR_FAILED = a request we aborted on purpose
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  const screenshot = async name => { if (!screenshotDir) return ''; const f = join(screenshotDir, name.replace(/[^\w.-]/g, '_') + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; };
  return { page, context, consoleErrors, screenshot };
}
