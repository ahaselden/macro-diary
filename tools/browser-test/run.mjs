// Usage: node tools/browser-test/run.mjs [--device "iPhone 13"] [--headed] [scenario files...]   (default: every file in scenarios/)
// Each scenario: export default async ({ page, url, check, screenshot }) => {...}; optional exports: stubs (array, see stubs.mjs), device (string).
// It throws (or check() fails) on a problem. Exit code 1 when anything fails. The app runs on a free port and everything is stopped at the end.
import { readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startServer, launchBrowser, openPage } from './lib.mjs';
import { summarize } from './stubs.mjs';

const args = process.argv.slice(2);
let device, headed = false; const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--device') device = args[++i]; else if (args[i] === '--headed') headed = true; else files.push(args[i]);
}
const dir = fileURLToPath(new URL('./scenarios/', import.meta.url));
const list = files.length ? files.map(f => resolve(f)) : readdirSync(dir).filter(f => f.endsWith('.mjs')).sort().map(f => join(dir, f));
const shots = mkdtempSync(join(tmpdir(), 'macro-diary-shots-'));

const results = [];
let server, browser;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { if (browser) await browser.close().catch(() => {}); if (server) server.stop(); process.exit(130); });   // Ctrl-C must not leave the server or browser running
try {
  server = await startServer();
  browser = await launchBrowser({ headed });
  for (const file of list) {
    const name = file.split(/[\\/]/).pop().replace(/\.mjs$/, '');
    const r = { name, ok: false };
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.default !== 'function') throw new Error('The scenario has no default export function.');
      const o = await openPage(browser, { appUrl: server.url, stubs: mod.stubs, device: mod.device || device, screenshotDir: shots });
      const check = (cond, msg) => { if (!cond) throw new Error('Check failed: ' + msg); };
      try {
        await mod.default({ page: o.page, url: server.url, check, screenshot: o.screenshot });
        r.ok = o.consoleErrors.length === 0 || mod.allowConsoleErrors === true;
        if (!r.ok) r.error = 'The page logged errors.';
      } catch (e) { r.error = String((e && e.message) || e); r.screenshot = await o.screenshot(name + '-failed').catch(() => ''); }
      r.consoleErrors = o.consoleErrors;
      await o.context.close();
    } catch (e) { r.error = String((e && e.message) || e); }
    results.push(r);
  }
} catch (e) {
  results.push({ name: 'setup', ok: false, error: String((e && e.message) || e) });
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.stop();
}
const s = summarize(results);
console.log(s.text + `\n(screenshots, if any, are in ${shots})`);
process.exit(s.ok ? 0 : 1);
