// Google Health probe page (tools/google-health-probe/), Google fully stubbed. Spec: docs/specs/google-health-probe.md, headless outline H1 to H8 (+ privacy checks).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCOPES = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; window.__requests = (window.__requests || 0); return { requestAccessToken() { window.__requests++; } }; } } } };`;
export const allowConsoleErrors = true;   // the stubbed 403/500 answers make Chromium log "Failed to load resource"; page errors are asserted below instead
export const stubs = [{ match: 'https://accounts.google.com/gsi/client', body: GSI, contentType: 'application/javascript' }];

const SHOTS = process.env.PROBE_SHOTS || 'C:/Users/Adam/AppData/Local/Temp/claude/f5883c2306ec2df6/f7b5aca2-91d1-4005-9166-4eb7f6af5f70/scratchpad/shots';
const ID = 'stub-client.apps.googleusercontent.com';
const BASE = 'https://health.googleapis.com/v4/users/me';
const ROLLUP = { rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 12 }, time: {} }, civilEndTime: { date: { year: 2026, month: 11, day: 12 }, time: { hours: 23, minutes: 59, seconds: 59 } }, steps: { countSum: '6120' } }] };
const SLEEP_OK = { dataPoints: [{ sleep: { interval: { startTime: '2026-11-12T22:30:00Z', startUtcOffset: '0s', endTime: '2026-11-13T06:30:00Z', endUtcOffset: '0s' }, summary: { minutesAsleep: '455' } } }] };
const ERR403 = { error: { code: 403, message: 'Insufficient scope', status: 'PERMISSION_DENIED' } };
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export default async function ({ page, url, check, screenshot }) {
  mkdirSync(SHOTS, { recursive: true });
  const failures = [];
  const soft = (cond, msg) => { if (!cond) failures.push(msg); };
  let seen = [], externalHosts = new Set(), health = {};
  const shot = async name => { await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); await screenshot(name); };

  await page.addInitScript(() => { window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied.push(t); } }, configurable: true }); } catch {} });
  await page.clock.setFixedTime(new Date(2026, 10, 14, 20, 0, 0));
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  page.on('request', r => { try { const h = new URL(r.url()).hostname; if (!['127.0.0.1', 'localhost'].includes(h)) externalHosts.add(h); } catch {} });
  await page.route('https://health.googleapis.com/v4/**', async route => {
    const r = route.request(); const u = r.url();
    seen.push({ method: r.method(), url: u, headers: r.headers(), body: r.postData() });
    const key = u.includes('/identity') ? 'identity' : u.includes('dailyRollUp') ? 'steps' : u.includes('reconcile') ? 'sleep' : u.includes('dataTypes/exercise') ? 'exercise' : 'other';
    const h = health[key];
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    if (h === 'abort') return route.abort();
    return route.fulfill(h);
  });

  const open = async () => { seen = []; externalHosts = new Set(); await page.goto(url + '/tools/google-health-probe/'); await page.waitForSelector('#signIn'); await page.waitForFunction(() => window.google && window.google.accounts); };
  const text = sel => page.$eval(sel, e => e.textContent);
  const signInAndCall = async (cbExpr) => {
    await page.fill('#clientId', ID); await page.click('#signIn');
    await page.evaluate(cbExpr);
    await page.waitForTimeout(600);
  };
  const TOKEN_CB = `window.__cfg.callback({access_token:'ya29.stub-token', expires_in:3599, scope:'s1 s2', token_type:'Bearer'})`;
  const okHealth = () => { health = { identity: json(200, { name: 'users/me/identity' }), steps: json(200, ROLLUP), sleep: json(200, SLEEP_OK), exercise: json(200, {}) }; };

  // H1
  await open();
  for (const s of ['#clientId', '#signIn', '#showNumbers', '#copySummary']) soft(await page.$(s), `H1: ${s} present`);
  soft((await text('#signIn')) === 'Sign in with Google', 'H1: #signIn text is "Sign in with Google"');
  soft((await text('#copySummary')) === 'Copy result summary', 'H1: #copySummary text exact');
  soft(/show the numbers/.test(await page.$eval('#showNumbers', e => e.closest('label').textContent)), 'H1: label contains "show the numbers"');
  const bad = [...externalHosts].filter(h => h !== 'accounts.google.com');
  soft(bad.length === 0, 'H1: no request to hosts other than localhost and accounts.google.com, saw ' + bad.join(','));
  await page.setViewportSize({ width: 375, height: 800 });
  await shot('probe-H1-rendered');

  // H2
  await open();
  await page.click('#signIn');
  soft((await text('#status')).includes('Enter a Client ID first'), 'H2: #status says Enter a Client ID first, got "' + await text('#status') + '"');
  soft(await page.evaluate(() => window.__cfg === undefined), 'H2: window.__cfg undefined');

  // H3
  await open();
  await page.fill('#clientId', ID); await page.click('#signIn');
  const cfg = await page.evaluate(() => ({ id: window.__cfg.client_id, scope: window.__cfg.scope, ecb: typeof window.__cfg.error_callback, cb: typeof window.__cfg.callback, keys: Object.keys(window.__cfg).sort(), req: window.__requests, ls: Object.keys(localStorage), ss: Object.keys(sessionStorage) }));
  soft(cfg.id === ID, 'H3: client_id equals typed text');
  soft(cfg.scope === SCOPES, 'H3: scope is exactly the two readonly scopes, got ' + cfg.scope);
  soft(cfg.ecb === 'function' && cfg.cb === 'function', 'H3: callback and error_callback are functions');
  soft(cfg.req === 1, 'H3: __requests is 1, got ' + cfg.req);
  soft(cfg.ls.length === 0 && cfg.ss.length === 0, 'H3: storage empty, got ' + JSON.stringify([cfg.ls, cfg.ss]));

  // H4
  await open(); okHealth(); health.sleep = json(403, ERR403);
  await page.check('#showNumbers');
  await signInAndCall(TOKEN_CB);
  const t = { id: await text('#check-identity'), st: await text('#check-steps'), sl: await text('#check-sleep'), ti: await text('#tokenInfo'), sum: await text('#summary') };
  soft(t.id.trim() === 'identity: HTTP 200 - ok', 'H4: #check-identity "identity: HTTP 200 - ok", got "' + t.id + '"');
  soft(t.st.includes('steps: HTTP 200 - ok') && t.st.includes('2026-11-12: 6120'), 'H4: #check-steps has "steps: HTTP 200 - ok" and "2026-11-12: 6120", got "' + t.st + '"');
  soft(t.sl.trim() === 'sleep: HTTP 403 - failed: PERMISSION_DENIED (403): Insufficient scope', 'H4: #check-sleep exact, got "' + t.sl + '"');
  soft(t.ti.includes('expires_in: 3599') && t.ti.includes('refresh_token present: no') && t.ti.includes('scope granted: s1 s2'), 'H4: #tokenInfo lines, got "' + t.ti + '"');
  soft(!t.sum.includes('stub-token'), 'H4: summary has no token');
  soft(t.sum.includes('sleep: HTTP 403 - failed: PERMISSION_DENIED') && t.sum.includes('steps: HTTP 200 - ok'), 'H4: summary has verdict lines, got "' + t.sum + '"');
  const [rid, rst, rsl] = seen;   // the fourth request is the Exercise GET
  soft(seen.length === 4, 'H4: exactly 4 health requests, got ' + seen.length);
  soft(rid && rid.method === 'GET' && rid.url === BASE + '/identity' && rid.headers.authorization === 'Bearer ya29.stub-token', 'H4: identity GET with Bearer');
  const wantBody = { range: { start: { date: { year: 2026, month: 11, day: 12 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }, end: { date: { year: 2026, month: 11, day: 15 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } } }, windowSizeDays: 1 };
  soft(rst && rst.method === 'POST' && rst.url === BASE + '/dataTypes/steps/dataPoints:dailyRollUp' && rst.headers.authorization === 'Bearer ya29.stub-token', 'H4: dailyRollUp POST with Bearer, got ' + (rst && rst.url));
  soft(rst && JSON.stringify(JSON.parse(rst.body || 'null')) === JSON.stringify(wantBody), 'H4: dailyRollUp body, got ' + (rst && rst.body));
  soft(rsl && rsl.method === 'GET' && rsl.url === BASE + '/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-12%22' && rsl.headers.authorization === 'Bearer ya29.stub-token', 'H4: sleep URL, got ' + (rsl && rsl.url));
  const domText = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
  soft(!domText.includes('ya29.stub-token') && !domText.includes('stub-token'), 'H4/privacy: token text not anywhere in the DOM');
  soft(!/@/.test(await page.evaluate(() => document.body.innerText)), 'H4/privacy: no email-like text in page');
  const storage = await page.evaluate(() => ({ ls: Object.keys(localStorage), ss: Object.keys(sessionStorage), ck: document.cookie }));
  soft(!storage.ls.length && !storage.ss.length && !storage.ck, 'H4/privacy: nothing stored, got ' + JSON.stringify(storage));
  await page.click('#copySummary');
  const copied = await page.evaluate(() => window.__copied);
  soft(copied.length === 1 && copied[0] === t.sum && !copied[0].includes('stub-token') && !/@/.test(copied[0]), 'H4/privacy: copied summary equals #summary, no token/email, got ' + JSON.stringify(copied));
  await shot('probe-H4-ticked');
  // numbers toggle without refetch
  const before = seen.length;
  await page.uncheck('#showNumbers');
  soft(!(await text('#check-steps')).includes('6120') && !(await text('#summary')).includes('6120'), 'H4/toggle: untick hides 6120 in #check-steps and #summary');
  await page.check('#showNumbers');
  soft((await text('#check-steps')).includes('6120') && (await text('#summary')).includes('6120'), 'H4/toggle: tick shows 6120 again');
  soft(seen.length === before, 'H4/toggle: no refetch on toggling, requests ' + before + ' -> ' + seen.length);

  // H5
  await open(); okHealth(); health.sleep = json(403, ERR403);
  await signInAndCall(TOKEN_CB);
  const s5 = await text('#summary'), c5 = await text('#check-steps');
  soft(!c5.includes('6120') && !s5.includes('6120'), 'H5: 6120 hidden when unticked');
  soft(!await page.evaluate(() => document.documentElement.outerHTML.includes('6120')), 'H5: 6120 not anywhere in DOM html when unticked');
  await shot('probe-H5-hidden');

  // H6
  await open(); okHealth();
  await signInAndCall(`window.__cfg.callback({error:'invalid_scope', error_description:'Bad scope'})`);
  soft((await text('#gisError')).trim() === 'GIS error: error=invalid_scope; error_description=Bad scope', 'H6: #gisError exact, got "' + await text('#gisError') + '"');
  soft(seen.length === 0, 'H6: no request to health.googleapis.com');
  const l6 = (await text('#summary')).split('\n');
  soft(l6[0] === 'Google Health probe result' && l6[1] === 'Sign-in: failed', 'H6: summary first two lines, got ' + JSON.stringify(l6.slice(0, 3)));
  await shot('probe-H6-gis-error');

  // H7
  await open(); okHealth();
  await page.fill('#clientId', ID); await page.click('#signIn');
  await page.evaluate(() => window.__cfg.error_callback({ type: 'popup_closed' }));
  soft((await text('#gisError')).trim() === 'GIS error: type=popup_closed', 'H7: #gisError exact, got "' + await text('#gisError') + '"');
  soft(seen.length === 0, 'H7: no health request');
  await shot('probe-H7-popup-closed');

  // H8
  await open(); health = { identity: 'abort', steps: { status: 500, contentType: 'text/html', body: '<h1>oops</h1>' }, sleep: json(200, {}), exercise: json(200, {}) };
  await signInAndCall(TOKEN_CB);
  const a = await text('#check-identity'), b = await text('#check-steps'), c = await text('#check-sleep');
  soft(a.startsWith('identity: no response - failed:'), 'H8: identity line, got "' + a + '"');
  soft(b.startsWith('steps: HTTP 500 - failed:'), 'H8: steps line, got "' + b + '"');
  soft(await page.evaluate(() => document.querySelector('h1:not(:first-of-type)') === null && document.querySelectorAll('h1').length === 1), 'H8: no h1 created from the body');
  soft(c.trim() === 'sleep: HTTP 200 - ok', 'H8: sleep line, got "' + c + '"');
  soft(seen.length === 4, 'H8: all four checks were attempted, got ' + seen.length);
  await shot('probe-H8-network-failure');

  // Extra 1: token response without access_token is a failed sign-in
  await open(); okHealth();
  await signInAndCall(`window.__cfg.callback({expires_in:3599, scope:'s1', token_type:'Bearer'})`);
  const l9 = (await text('#summary')).split('\n');
  soft(l9[1] === 'Sign-in: failed' && /^GIS error: /.test(await text('#gisError')), 'X1: no access_token shows failed sign-in + GIS error, got ' + JSON.stringify([l9.slice(0, 4), await text('#gisError')]));
  soft(seen.length === 0, 'X1: no health request without a token');
  soft(await page.$eval('#signIn', e => !e.disabled), 'X1: #signIn re-enabled after failure');

  // Extra 2: a second click while a run is in progress does not mix results
  await open(); okHealth();
  await page.fill('#clientId', ID);
  await page.evaluate(() => { const b = document.getElementById('signIn'); b.click(); b.click(); });
  const dis = await page.$eval('#signIn', e => e.disabled);
  await page.evaluate(TOKEN_CB_SRC => { eval(TOKEN_CB_SRC); document.getElementById('signIn').click(); }, TOKEN_CB);
  await page.waitForTimeout(600);
  soft(dis === true, 'X2: #signIn disabled right after click');
  const reqs = await page.evaluate(() => window.__requests);
  soft(reqs === 1, 'X2: two quick clicks requested one token, got ' + reqs);
  soft(seen.length === 4, 'X2: exactly one run of 4 health requests, got ' + seen.length);
  soft((await text('#summary')).split('\n').filter(l => l.startsWith('identity:')).length === 1, 'X2: one identity line in summary');
  soft(await page.$eval('#signIn', e => !e.disabled), 'X2: #signIn re-enabled after run');

  soft(pageErrors.length === 0, 'uncaught page errors: ' + pageErrors.join(','));
  for (const f of failures) console.log('FINDING: ' + f);
  if (failures.length) throw new Error('Check failed: ' + failures.join(' | '));
  check(true, 'all probe checks passed');
}
