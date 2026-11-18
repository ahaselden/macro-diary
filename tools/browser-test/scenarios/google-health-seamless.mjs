// docs/specs/google-health-seamless.md, headless checklist C1..C23 (Google fully stubbed, invented data). C24 is checked by running google-health-sync.mjs (see the report).
// Timezone America/New_York, clock fixed to 2026-11-16 12:00 local (17:00Z = 1794848400000).
// [D] variant = the app as served (it ships a built-in Client ID, DEF below). [N] variant = the same app, but the browser is handed
// js/services/google-health-api.js with `DEFAULT_CLIENT_ID = ''` (a route.fulfill rewrite of that one constant; nothing on disk changes).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEF = '1094978660996-lntit6oh8sch8qslv9uk38td9sujppug.apps.googleusercontent.com';   // the shipped default (checked against the page in C1)
const ID2 = '987654-zyxwvutsrqponmlkjihgfedcba.apps.googleusercontent.com';
const KEY = 'macrodiary.googleclient.v1', PK = 'macrodiary.googlesync.v1';
const NOW = 1794848400000, H = 3600000;
const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; return { requestAccessToken(arg) {
  window.__args = (window.__args || []).concat([arg || null]); window.__requests = (window.__requests || 0) + 1;
  const rep = () => window.__reply || JSON.parse(localStorage.getItem('test.reply') || 'null') || {};
  const dl = window.__delay || Number(localStorage.getItem('test.delay')) || 50;
  setTimeout(() => { const r = rep(); if (r.errorCallback) cfg.error_callback(r.errorCallback); else cfg.callback('callback' in r ? r.callback : { access_token: 'stub-token-123', expires_in: 3599, scope: 'x', token_type: 'Bearer' }); }, dl); } }; } } } };`;
export const allowConsoleErrors = true;   // stubbed 4xx and the aborted script log "Failed to load resource"
export const stubs = [{ match: 'https://accounts.google.com/gsi/client', body: GSI, contentType: 'application/javascript' }];

const SHOTS = process.env.GHS_SHOTS || 'C:/Users/Adam/AppData/Local/Temp/claude/f5883c2306ec2df6/f7b5aca2-91d1-4005-9166-4eb7f6af5f70/scratchpad/shots';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const d = (y, m, dd) => ({ civilStartTime: { date: { year: y, month: m, day: dd }, time: {} } });
const STEPS_OK = { rollupDataPoints: [{ ...d(2026, 11, 14), steps: { countSum: '12921' } }, { ...d(2026, 11, 15), steps: { countSum: '2919' } }, { ...d(2026, 11, 16), steps: { countSum: '1226' } }, d(2026, 11, 13)] };
const sl = (s, e, m) => ({ sleep: { interval: { startTime: s, startUtcOffset: '-18000s', endTime: e, endUtcOffset: '-18000s' }, summary: { minutesAsleep: m } } });
const SLEEP_OK = { dataPoints: [sl('2026-11-16T09:00:00Z', '2026-11-16T13:00:00Z', '239'), sl('2026-11-16T05:30:00Z', '2026-11-16T08:09:00Z', '159'), sl('2026-11-15T06:00:00Z', '2026-11-15T11:00:00Z', '268'),
  sl('2026-11-15T04:00:00Z', '2026-11-15T05:10:00Z', '68'), sl('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435')], nextPageToken: '' };
const HAPPY = () => ({ steps: json(200, STEPS_OK), sleep: json(200, SLEEP_OK), exercise: json(200, { dataPoints: [] }) });   // CHANGED for docs/specs/google-health-workouts.md: the third (exercise) request
const SYNCED = 'Synced 3 days: steps for 3, sleep for 3';
const TODAY_LINE = 'From Google Health: Steps 1,226 · Sleep 6 h 38 min';
const stale = (ms = NOW - 4 * H, auto = true) => JSON.stringify({ lastSyncAt: ms, auto });

export default async function ({ page, url, screenshot }) {
  mkdirSync(SHOTS, { recursive: true });
  const fails = [];
  let health = HAPPY(), seen = [], hosts = [], variant = 'D', gsiAbort = false, rewrote = 0, consoleAll = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { await page.screenshot({ path: join(SHOTS, 'seamless-' + id.replace(/\W/g, '_') + '-fail.png'), fullPage: true }); console.log('  screenshot: ' + join(SHOTS, 'seamless-' + id.replace(/\W/g, '_') + '-fail.png')); } catch {} }
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await page.clock.setFixedTime(new Date(NOW));
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => consoleAll.push(m.text()));
  page.on('request', r => { try { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) hosts.push(u.hostname); } catch {} });
  await page.route('https://health.googleapis.com/v4/**', async route => {
    const r = route.request(), u = r.url();
    seen.push({ method: r.method(), url: u, headers: r.headers(), body: r.postData() });
    const h = health[u.includes('dailyRollUp') ? 'steps' : u.includes('reconcile') ? 'sleep' : u.includes('dataTypes/exercise') ? 'exercise' : 'other'];
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    if (h === 'abort') return route.abort();
    return route.fulfill(h);
  });
  await page.route('https://accounts.google.com/**', route => gsiAbort ? route.abort() : route.fallback());
  await page.route('**/js/services/google-health-api.js', async route => {
    if (variant !== 'N') return route.fallback();
    const resp = await route.fetch(); const text = await resp.text();
    const out = text.replace(/export const DEFAULT_CLIENT_ID = '[^']*';/, "export const DEFAULT_CLIENT_ID = '';");
    if (out !== text) rewrote++;
    return route.fulfill({ response: resp, body: out });
  });
  page.on('dialog', x => x.accept());

  // variant: 'D' | 'N'; local = { key: value } written to localStorage before the final load
  const start = async ({ v = 'D', prefs = null, own = null, reply = null, delay = null, abort = false, tab = null } = {}) => {
    variant = v; gsiAbort = abort;
    await page.goto(url + '/no-such-page-for-origin.txt');   // same origin, not the app: the previous item's saved state must not start a sync
    await page.evaluate(([p, o, r, dl, pk, ck]) => { localStorage.clear(); sessionStorage.clear(); if (p) localStorage.setItem(pk, p); if (o) localStorage.setItem(ck, o); if (r) localStorage.setItem('test.reply', JSON.stringify(r)); if (dl) localStorage.setItem('test.delay', String(dl)); }, [prefs, own, reply, delay, PK, KEY]);
    health = HAPPY(); seen = []; hosts = []; consoleAll = [];
    await page.goto(url + '/index.html'); await page.waitForSelector('.tabs');
    if (tab) await page.click(`[data-tab="${tab}"]`);
  };
  const reload = async () => { seen = []; hosts = []; await page.reload(); await page.waitForSelector('.tabs'); };
  const googleReqs = () => hosts.filter(h => h === 'accounts.google.com' || h === 'health.googleapis.com').length;
  const settings = () => page.click('[data-tab="settings"]');
  const diary = () => page.click('[data-tab="diary"]');
  const status = async () => (await page.locator('#ghSyncStatus').textContent()).trim();
  const lastTxt = async () => (await page.locator('#ghSyncLast').textContent()).trim();
  const ls = k => page.evaluate(x => localStorage.getItem(x), k);
  const prefsObj = async () => { const t = await ls(PK); return t === null ? null : JSON.parse(t); };
  const setPrefs = v => page.evaluate(([k, t]) => localStorage.setItem(k, t), [PK, v]);
  const reqs = () => page.evaluate(() => window.__requests || 0);
  const args = () => page.evaluate(() => window.__args || []);
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1') || 'null'));
  const waitReqs = (n, ms = 4000) => page.waitForFunction(x => (window.__requests || 0) >= x, n, { timeout: ms });
  const idle = () => page.waitForFunction(() => !document.getElementById('ghSyncBtn').disabled && !/^Syncing/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 10000 });
  const settle = async () => { await page.waitForTimeout(700); };
  const visibility = (state = 'visible') => page.evaluate(s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, state);
  const toastShown = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent.trim() !== ''; });
  const noLeak = async () => {
    const all = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML + JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
    ok(!all.includes('stub-token-123') && !consoleAll.join('\n').includes('stub-token-123'), 'token leaked');
  };

  await item('C1 [D]', async () => {
    await start(); await settings();
    eq(await page.evaluate(() => document.getElementById('ghSyncUsing').textContent), 'Using the built-in Client ID.', 'using text');
    ok((await page.locator('#ghSyncCard').innerText()).includes('Using the built-in Client ID.'), 'text visible in the card');
    eq(await page.inputValue('#ghSyncClientId'), '', 'input empty'); ok(await page.locator('#ghSyncAuto').isChecked(), 'auto checked');
    eq(await lastTxt(), '', '#ghSyncLast empty');
    ok(rewrote === 0, 'the [D] build was not rewritten');
    await diary(); ok(await page.locator('#ghSyncDiary').isVisible(), 'diary button visible'); eq((await page.locator('#ghSyncDiary').textContent()).trim(), 'Sync Google Health', 'diary button text');
    await settle(); eq(googleReqs(), 0, 'Google requests');
  });
  await item('C2 [N]', async () => {
    await start({ v: 'N' }); await settings();
    ok(rewrote > 0, 'the [N] rewrite was applied to the served module');
    ok(!(await page.locator('#ghSyncCard').innerText()).includes('Using the'), 'no "Using the" text');
    await diary(); ok(!(await page.locator('#ghSyncDiary').isVisible()), 'diary button hidden'); await settings();
    ok(await page.locator('#ghSyncAuto').isChecked(), 'auto checked'); eq(await lastTxt(), '', 'last empty');
    await settle(); eq(googleReqs(), 0, 'Google requests');
  });
  await item('C3 [D]', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', ID2); await page.click('#ghSyncSave');
    eq(await status(), 'Client ID saved on this device.', 'status');
    ok((await page.locator('#ghSyncCard').innerText()).includes('Using the Client ID saved on this device.'), 'using text');
    eq(await ls(KEY), ID2, 'stored');
    await page.click('#ghSyncBtn'); await idle();
    eq(await page.evaluate(() => window.__cfg.client_id), ID2, 'client_id used');
  });
  await item('C4 [D]', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', ID2); await page.click('#ghSyncSave'); await page.click('#ghSyncRemove');
    eq(await status(), 'Client ID removed. Using the built-in Client ID.', 'status'); eq(await page.inputValue('#ghSyncClientId'), '', 'input'); eq(await ls(KEY), null, 'key');
    ok((await page.locator('#ghSyncCard').innerText()).includes('Using the built-in Client ID.'), 'using text');
    await diary(); ok(await page.locator('#ghSyncDiary').isVisible(), 'diary still visible');
    await page.click('#ghSyncDiary'); await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Synced'), null, { timeout: 5000 });
    eq(await page.evaluate(() => window.__cfg.client_id), DEF, 'built-in id used again');
  });
  await item('C4 [N]', async () => {
    await start({ v: 'N' }); await settings(); await page.fill('#ghSyncClientId', ID2); await page.click('#ghSyncSave'); await page.click('#ghSyncRemove');
    eq(await status(), 'Client ID removed.', 'status'); await diary(); ok(!(await page.locator('#ghSyncDiary').isVisible()), 'diary hidden');
  });
  await item('C5 [D]', async () => {
    await start(); await settings(); await page.click('#ghSyncBtn'); await idle();
    eq(await ls(KEY), null, 'client key null'); const m = await ls('macrodiary.v1'); ok(m === null || !m.includes('apps.googleusercontent.com'), 'main state has no ID');
    eq(await page.evaluate(() => window.__cfg.client_id), DEF, 'cfg id');
  });
  await item('C6 [D]', async () => {
    await start(); await settings(); await page.click('#ghSyncBtn'); await idle();
    eq(await status(), SYNCED, 'status');
    const a = (await args())[0]; ok(!a || a.prompt !== 'none', 'first request arg ' + JSON.stringify(a));
    const p = await prefsObj(); eq(p.lastSyncAt, NOW, 'lastSyncAt'); ok(Object.keys(p).every(k => k === 'lastSyncAt' || k === 'auto'), 'prefs keys ' + Object.keys(p));
    eq(await lastTxt(), 'Last synced just now', 'last line'); await noLeak();
  });
  await item('C7 [D]', async () => {
    await start(); await settings(); await page.click('#ghSyncBtn'); await idle();
    const u1 = (await stored()).activity['2026-11-16'].updatedAt;
    await page.clock.setFixedTime(new Date(NOW + 300000));
    await page.click('#ghSyncBtn'); await page.waitForFunction(t => JSON.parse(localStorage.getItem('macrodiary.googlesync.v1')).lastSyncAt === t, NOW + 300000, { timeout: 5000 }); await idle();
    eq(await status(), SYNCED, 'status'); eq((await prefsObj()).lastSyncAt, NOW + 300000, 'lastSyncAt');
    eq((await stored()).activity['2026-11-16'].updatedAt, u1, 'updatedAt unchanged');
    eq(await lastTxt(), 'Last synced just now', 'last line');
    await page.clock.setFixedTime(new Date(NOW));
  });
  await item('C8 [D]', async () => {
    await start({ reply: { errorCallback: { type: 'popup_closed' } } }); await settings(); await page.click('#ghSyncBtn'); await idle();
    eq(await status(), 'The Google sign-in window was closed before it finished. Tap Sync Google Health to try again.', 'status'); eq(await ls(PK), null, 'prefs null');
    await setPrefs('{"lastSyncAt":1794834000000,"auto":true}'); await page.click('#ghSyncBtn'); await idle();
    eq((await prefsObj()).lastSyncAt, 1794834000000, 'lastSyncAt unchanged');
  });
  await item('C9 [D]', async () => {
    await start(); await page.waitForTimeout(3000); await visibility('visible'); await settle(); await settings(); await diary();
    eq(googleReqs(), 0, 'Google requests'); eq(await reqs(), 0, 'requestAccessToken calls');
  });
  const staleLoad = async (extra = {}) => start({ prefs: stale(), ...extra });
  const c10Outcomes = async () => {
    eq(await reqs(), 1, 'requestAccessToken calls'); eq((await args())[0].prompt, 'none', 'prompt');
    eq(seen.length, 3, 'health requests'); ok(seen.every(r => r.headers.authorization === 'Bearer stub-token-123'), 'bearer');
    eq(seen[0].method, 'POST', 'steps POST'); eq(seen[1].method, 'GET', 'sleep GET'); eq(seen[2].method + ' ' + seen[2].url, 'GET https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%222026-11-10%22', 'exercise GET');
  };
  await item('C10 [D]', async () => {
    await staleLoad(); await waitReqs(1); await page.waitForSelector('#activityLine', { state: 'visible', timeout: 4000 });
    await settle(); await c10Outcomes();
    eq((await page.locator('#activityLine').innerText()).replace(/\s+/g, ' ').trim(), TODAY_LINE, 'activity line');
    await settings(); eq(await status(), SYNCED, 'status'); eq((await prefsObj()).lastSyncAt, NOW, 'lastSyncAt'); eq(await lastTxt(), 'Last synced just now', 'last'); await noLeak();
  });
  await item('C11 [D]', async () => {
    await start({ prefs: stale(NOW - 2 * H) }); await page.waitForTimeout(3000); eq(googleReqs(), 0, '2h: Google requests');
    await start({ prefs: stale(NOW - 3 * H) }); await waitReqs(1); await settle(); eq(await reqs(), 1, '3h: one attempt'); eq((await args())[0].prompt, 'none', 'prompt');
  });
  await item('C12 [D]', async () => {
    await start({ prefs: stale(NOW - 4 * H, false) }); await page.waitForTimeout(3000); eq(googleReqs(), 0, 'Google requests'); await settings();
    ok(!(await page.locator('#ghSyncAuto').isChecked()), 'unchecked'); eq(await lastTxt(), 'Last synced 4 hours ago', 'last');
    await page.check('#ghSyncAuto'); let p = await prefsObj(); eq(p.auto, true, 'auto true'); eq(p.lastSyncAt, NOW - 4 * H, 'lastSyncAt unchanged');
    await reload(); await waitReqs(1); await settle(); eq(await reqs(), 1, 'one quiet attempt'); await settings(); ok(await page.locator('#ghSyncAuto').isChecked(), 'checked after reload');
    await setPrefs(stale(NOW - 4 * H, true)); await reload(); await settings(); await page.uncheck('#ghSyncAuto'); eq((await prefsObj()).auto, false, 'auto false');
    await reload(); await page.waitForTimeout(3000); eq(googleReqs(), 0, 'no requests after untick'); await settings(); ok(!(await page.locator('#ghSyncAuto').isChecked()), 'unchecked after reload');
  });
  await item('C13 [N]', async () => {
    await start({ v: 'N', prefs: stale() }); await page.waitForTimeout(3000); ok(rewrote > 0, '[N] rewrite applied'); eq(googleReqs(), 0, 'Google requests');
  });
  const quietNothing = async (label) => {
    await settle(); await settings();
    eq(await reqs(), gsiAbort0 ? 0 : 1, label + ': requestAccessToken calls'); eq(seen.length, 0, label + ': Health requests');
    ok(!(await toastShown()), label + ': toast'); eq(await status(), '', label + ': status');
    ok(await page.locator('#ghSyncBtn').isEnabled() && await page.locator('#ghSyncDiary').isEnabled(), label + ': buttons enabled');
    eq((await prefsObj()).lastSyncAt, NOW - 4 * H, label + ': lastSyncAt'); eq(await lastTxt(), 'Last synced 4 hours ago', label + ': last');
  };
  let gsiAbort0 = false;
  await item('C14 [D]', async () => {
    const cases = [['interaction_required', { callback: { error: 'interaction_required' } }], ['popup_failed_to_open', { errorCallback: { type: 'popup_failed_to_open' } }], ['popup_closed', { errorCallback: { type: 'popup_closed' } }], ['access_denied', { callback: { error: 'access_denied' } }]];
    for (const [n, reply] of cases) {
      gsiAbort0 = false; await staleLoad({ reply }); await quietNothing(n);
      if (n === 'interaction_required') { await screenshot('seamless-C14-quiet'); }
    }
    gsiAbort0 = true; await staleLoad({ abort: true }); await quietNothing('script blocked'); gsiAbort0 = false;
  });
  await item('C15 [D]', async () => {
    await staleLoad(); health.steps = json(401, { error: { code: 401, message: 'Invalid token ya29.fake for me@example.com', status: 'UNAUTHENTICATED' } });
    // the 401 stub is set after the first load already synced (and stamped), so put the stale stamp back and reload
    await setPrefs(stale()); await reload(); await waitReqs(1); await settle(); await settings();
    eq(await status(), 'Google rejected the sign-in. Tap Sync Google Health to sign in again.', 'status');
    const t = await page.evaluate(() => document.body.innerText + document.documentElement.outerHTML); ok(!t.includes('ya29.fake') && !t.includes('me@example.com'), 'secret text on the page');
    eq((await prefsObj()).lastSyncAt, NOW - 4 * H, 'lastSyncAt unchanged');
  });
  await item('C16 [D]', async () => {
    await staleLoad({ reply: { callback: { error: 'interaction_required' } } }); await settle(); eq(await reqs(), 1, 'quiet attempt');
    await page.evaluate(() => { window.__reply = {}; }); await page.click('#ghSyncDiary');
    await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Synced'), null, { timeout: 5000 });
    eq((await page.locator('#toast').textContent()).trim(), SYNCED, 'toast'); const a = await args(); ok(!a[a.length - 1] || a[a.length - 1].prompt !== 'none', 'last arg is not quiet: ' + JSON.stringify(a[a.length - 1]));
    eq((await prefsObj()).lastSyncAt, NOW, 'lastSyncAt');
  });
  await item('C17 [D]', async () => {
    await start({ prefs: stale(NOW - 2 * H) }); await page.waitForTimeout(1000); eq(googleReqs(), 0, 'zero after load');
    await setPrefs(stale()); await visibility('visible'); await waitReqs(1); await settle(); await c10Outcomes();
    await visibility('visible'); await settle(); eq(await reqs(), 1, 'no second attempt');
    // hidden does nothing
    await start({ prefs: stale(NOW - 2 * H) }); await page.waitForTimeout(500); await setPrefs(stale()); await visibility('hidden'); await page.waitForTimeout(1000); eq(await reqs(), 0, 'hidden: nothing');
    await visibility('visible'); await waitReqs(1); await settle(); eq(await reqs(), 1, 'visible afterwards: one attempt');
  });
  await item('C18 [D]', async () => {
    await staleLoad({ reply: { callback: { error: 'interaction_required' } } }); await settle(); eq(await reqs(), 1, 'first attempt');
    for (let i = 0; i < 3; i++) { await visibility('visible'); await page.waitForTimeout(300); }
    eq(await reqs(), 1, 'still 1 after 3 visibility events');
    await reload(); await waitReqs(1); await settle(); eq(await reqs(), 1, 'a reload allows exactly one more');
  });
  await item('C19 [D]', async () => {
    await staleLoad({ delay: 800 }); await settings();
    await visibility('visible'); await page.locator('#ghSyncBtn').click({ force: true, timeout: 300 }).catch(() => {});
    await page.waitForTimeout(150); eq(await reqs(), 1, 'one request while the first runs');
    ok(await page.locator('#ghSyncBtn').isDisabled(), 'button disabled while running');
    await page.waitForFunction(() => /^Synced/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 5000 }); await settle();
    eq(await status(), SYNCED, 'status'); eq(await reqs(), 1, 'still one request'); eq(seen.length, 3, 'three Health requests in total');
  });
  await item('C20 [D]', async () => {
    await staleLoad({ delay: 1500 }); await page.click('#prev'); const lbl = (await page.locator('#dateLbl').textContent()).trim();
    await page.evaluate(() => { const i = document.getElementById('rcQ'); i.value = 'keep me'; });
    await waitReqs(1); await page.waitForFunction(() => /Synced/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 8000 }); await settle();
    eq((await page.locator('#dateLbl').textContent()).trim(), lbl, 'selected day kept');
    await page.waitForSelector('#activityLine', { state: 'visible', timeout: 3000 });
    eq((await page.locator('#activityLine').innerText()).replace(/\s+/g, ' ').trim(), 'From Google Health: Steps 2,919 · Sleep 5 h 36 min', 'activity line for the 15th');
    eq(await page.inputValue('#rcQ'), 'keep me', 'typed text kept');
  });
  await item('C21 [D]', async () => {
    const check = async (label, prefs, auto = true) => {
      await start({ prefs }); await page.waitForTimeout(1500); await settings();
      eq(googleReqs(), 0, label + ': Google requests'); ok(await page.locator('#ghSyncAuto').isChecked() === auto, label + ': auto box'); eq(await lastTxt(), '', label + ': last empty');
      ok(await page.evaluate(() => !document.querySelector('#ghSyncCard img, #ghSyncCard b') && window.__pwned === undefined), label + ': inert');
    };
    await check('html', '{"lastSyncAt":"<img src=x onerror=window.__pwned=1>","auto":"<b>x</b>"}');
    await check('not json', 'garbage {');
    await check('future', JSON.stringify({ lastSyncAt: 1794934800000, auto: true }));
  });
  await item('C22 [D]', async () => {
    const cases = [[1794848340000, 'Last synced a minute ago'], [1794848100000, 'Last synced 5 minutes ago'], [1794841200000, 'Last synced 2 hours ago'], [1794740400000, 'Last synced a day ago'], [1794589200000, 'Last synced 3 days ago']];
    const bad = [];
    for (const [ms, text] of cases) { await start({ prefs: stale(ms, false) }); await settings(); const got = await lastTxt(); if (got !== text) bad.push(`for ${ms}: expected ${JSON.stringify(text)}, got ${JSON.stringify(got)}`); }
    if (bad.length) throw new Error(bad.join('; '));
  });
  await item('C23 [D]', async () => {
    await start(); await settings(); await page.click('#ghSyncBtn'); await idle();
    const m = await ls('macrodiary.v1'); ok(m && !/googlesync|lastSyncAt|apps\.googleusercontent\.com/.test(m), 'macrodiary.v1 clean');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#bkExport')]);
    const { readFileSync } = await import('node:fs'); const txt = readFileSync(await dl.path(), 'utf8');
    ok(txt.length > 10 && !/googlesync|lastSyncAt|apps\.googleusercontent\.com/.test(txt), 'backup file clean (' + txt.length + ' bytes)');
  });

  ok(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
  if (fails.length) throw new Error(fails.length + ' item(s) failed: ' + fails.join(' || '));
}
