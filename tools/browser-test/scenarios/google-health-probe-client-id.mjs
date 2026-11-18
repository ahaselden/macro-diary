// Google Health probe page pre-filled Client ID. Spec: docs/specs/probe-remember-client-id.md, headless checklist C1 to C7. Google fully stubbed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; return { requestAccessToken() { window.__requests = (window.__requests || 0) + 1; } }; } } } };`;
export const allowConsoleErrors = true;
export const stubs = [{ match: 'https://accounts.google.com/gsi/client', body: GSI, contentType: 'application/javascript' }];

const SRC = readFileSync(fileURLToPath(new URL('../../../js/services/google-health-api.js', import.meta.url)), 'utf8');
const DEFAULT = /DEFAULT_CLIENT_ID\s*=\s*'([^']+)'/.exec(SRC)[1];
const TYPED = 'fake-test-client-123.apps.googleusercontent.com';
const SECRET_MSG = 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.';
const SHAPE_MSG = 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.';

export default async function ({ page, url, check }) {
  const hosts = new Set(); const module200 = {};
  page.on('request', r => { try { const h = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(h)) hosts.add(h); } catch {} });
  page.on('response', r => { const p = new URL(r.url()).pathname; if (p.endsWith('/js/services/google-health-api.js') || p.endsWith('/js/domain/google-health-api.js')) module200[p] = r.status(); });
  await page.route('https://health.googleapis.com/v4/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const open = async () => { await page.goto(url + '/tools/google-health-probe/'); await page.waitForSelector('#signIn'); await page.waitForFunction(() => window.google && window.google.accounts); };
  const text = sel => page.$eval(sel, e => e.textContent);
  const cfgOf = () => page.evaluate(() => window.__cfg);
  const store = () => page.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) }));

  // C1
  await open();
  check((await page.inputValue('#clientId')) === DEFAULT, 'C1: #clientId equals DEFAULT_CLIENT_ID');
  const label = await page.evaluate(() => document.querySelector('label[for="clientId"]')?.textContent || '');
  check(label.includes('pre-filled') && label.includes('built-in'), 'C1: label has "pre-filled" and "built-in", got "' + label + '"');
  const s1 = await store();
  check(s1.ls.length === 0 && s1.ss.length === 0, 'C1: no storage keys ' + JSON.stringify(s1));

  // C2
  await page.click('#signIn');
  check((await page.evaluate(() => window.__cfg && window.__cfg.client_id)) === DEFAULT, 'C2: __cfg.client_id is the default');
  check(!(await text('#status')).includes(DEFAULT), 'C2: #status does not contain the Client ID');

  // C3
  await open();
  await page.fill('#clientId', ''); await page.click('#signIn');
  check((await text('#status')) === 'Enter a Client ID first.', 'C3: status exact, got "' + await text('#status') + '"');
  check((await cfgOf()) === undefined, 'C3: __cfg undefined');

  // C4
  await open();
  await page.fill('#clientId', 'GOCSPX-not-a-real-secret-value'); await page.click('#signIn');
  check((await text('#status')) === SECRET_MSG, 'C4: status exact, got "' + await text('#status') + '"');
  check((await page.inputValue('#clientId')) === '', 'C4: box cleared');
  check(!(await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML)).includes('not-a-real-secret'), 'C4: secret text nowhere on page');
  check((await cfgOf()) === undefined, 'C4: __cfg undefined');

  // C5
  await open();
  await page.fill('#clientId', 'hello'); await page.click('#signIn');
  check((await text('#status')) === SHAPE_MSG, 'C5: status exact, got "' + await text('#status') + '"');
  check((await page.inputValue('#clientId')) === 'hello', 'C5: box still hello');
  check((await cfgOf()) === undefined, 'C5: __cfg undefined');

  // C6
  await open();
  await page.fill('#clientId', ' ' + TYPED + ' '); await page.click('#signIn');
  check((await page.evaluate(() => window.__cfg && window.__cfg.client_id)) === TYPED, 'C6: client_id is the typed ID, trimmed');
  await page.evaluate(() => window.__cfg.callback({ access_token: 'ya29.stub-token', expires_in: 3599, scope: 's1 s2', token_type: 'Bearer' }));
  await page.waitForTimeout(600);
  const gone = await page.evaluate(() => ['#summary', '#status', '#tokenInfo', '#gisError'].map(s => document.querySelector(s).textContent).join('\n'));
  check(!gone.includes('fake-test-client-123'), 'C6: typed ID not in #summary/#status/#tokenInfo/#gisError');
  await page.reload(); await page.waitForSelector('#signIn');
  check((await page.inputValue('#clientId')) === DEFAULT, 'C6: after reload the box is the default again');
  const s6 = await store();
  check(s6.ls.length === 0 && s6.ss.length === 0, 'C6: no storage keys after reload ' + JSON.stringify(s6));

  // C7
  const bad = [...hosts].filter(h => h !== 'accounts.google.com' && h !== 'health.googleapis.com');
  check(bad.length === 0, 'C7: only localhost, accounts.google.com, health.googleapis.com; extra: ' + bad.join(','));
  const keys = Object.keys(module200);
  check(keys.length === 2 && keys.every(k => module200[k] === 200), 'C7: both module requests returned 200, got ' + JSON.stringify(module200));
}
