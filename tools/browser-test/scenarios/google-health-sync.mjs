// docs/specs/google-health-sync.md, headless checklist C1..C20 (Google fully stubbed, invented data), plus a 375 px look at the new card and the Diary button.
// Timezone America/New_York (forced with the DevTools protocol) and the clock fixed to 2026-11-16 12:00 local (17:00Z).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = '123456-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com';
const SECRET = 'GOCSPX-abcdefghij';
const KEY = 'macrodiary.googleclient.v1';
const SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const BASE = 'https://health.googleapis.com/v4/users/me';
const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; return { requestAccessToken() { window.__requests = (window.__requests || 0) + 1; setTimeout(() => { const r = window.__reply || {}; if (r.errorCallback) cfg.error_callback(r.errorCallback); else cfg.callback('callback' in r ? r.callback : { access_token: 'stub-token-123', expires_in: 3599, scope: 'x', token_type: 'Bearer' }); }, window.__delay || 50); } }; } } } };`;
export const allowConsoleErrors = true;   // stubbed 4xx/5xx answers make Chromium log "Failed to load resource"; page errors and token leaks are asserted below
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
const seed = (extra = {}) => ({ schemaVersion: 9, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days: {}, ...extra });
const SEED15 = { '2026-11-15': { updatedAt: 1000, source: 'google-health', steps: 5000, workouts: [{ id: 'w1', name: 'Run', start: '2026-11-15T13:00:00Z', minutes: 30 }] } };

export default async function ({ page, url, check, screenshot }) {
  mkdirSync(SHOTS, { recursive: true });
  const fails = [];
  // These items assume NO built-in Client ID (docs/specs/google-health-seamless.md C24: run them as [N]). The app now ships one, so the browser is handed
  // js/services/google-health-api.js with DEFAULT_CLIENT_ID = '' (nothing on disk changes).
  await page.route('**/js/services/google-health-api.js', async route => { const resp = await route.fetch(); const t = await resp.text(); return route.fulfill({ response: resp, body: t.replace(/export const DEFAULT_CLIENT_ID = '[^']*';/, "export const DEFAULT_CLIENT_ID = '';") }); });
  let health = HAPPY(), seen = [], hosts = [], gsiHits = 0, consoleAll = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { await page.screenshot({ path: join(SHOTS, 'ghs-' + id + '-fail.png'), fullPage: true }); console.log('  screenshot: ' + join(SHOTS, 'ghs-' + id + '-fail.png')); } catch {} }
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await page.clock.setFixedTime(new Date('2026-11-16T17:00:00Z'));
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => consoleAll.push(m.text()));
  page.on('request', r => { try { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { hosts.push(u.hostname); if (u.hostname === 'accounts.google.com') gsiHits++; } } catch {} });
  await page.route('https://health.googleapis.com/v4/**', async route => {
    const r = route.request(), u = r.url();
    seen.push({ method: r.method(), url: u, headers: r.headers(), body: r.postData() });
    const h = health[u.includes('dailyRollUp') ? 'steps' : u.includes('reconcile') ? 'sleep' : u.includes('dataTypes/exercise') ? 'exercise' : 'other'];
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    if (h === 'abort') return route.abort();
    return route.fulfill(h);
  });
  page.on('dialog', x => x.accept());

  const start = async ({ id = false, state = null, tab = null } = {}) => {
    health = HAPPY(); seen = []; hosts = []; gsiHits = 0; consoleAll = [];
    await page.goto(url + '/index.html');
    await page.evaluate(([i, s, k]) => { localStorage.clear(); sessionStorage.clear(); if (i) localStorage.setItem(k, i); if (s) localStorage.setItem('macrodiary.v1', JSON.stringify(s)); }, [id ? ID : null, state, KEY]);
    await page.reload(); await page.waitForSelector('.tabs');
    if (tab) await page.click(`[data-tab="${tab}"]`);
  };
  const settings = () => page.click('[data-tab="settings"]');
  const status = async () => (await page.locator('#ghSyncStatus').textContent()).trim();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1') || 'null'));
  const ls = k => page.evaluate(x => localStorage.getItem(x), k);
  const pageText = () => page.evaluate(() => document.body.innerText + '\n' + document.documentElement.outerHTML);
  const storageDump = () => page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  const clickSync = async () => { await settings(); await page.click('#ghSyncBtn'); await page.waitForFunction(() => !document.getElementById('ghSyncBtn').disabled && !/^Syncing/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 10000 }); };
  const healthReqs = () => seen.length;

  // C1
  await item('C1', async () => {
    await start(); await settings();
    const order = await page.evaluate(() => [...document.querySelectorAll('#v-settings .card')].map(c => ((c.querySelector('h2') || {}).textContent || '(no h2)').trim()));
    const i = order.indexOf('Google Health sync');
    ok(i > 0, 'card heading present, headings: ' + order.join(' | '));
    eq(order[i - 1], 'Import from Google Health', 'card before');
    eq(order[i + 1], 'Sync between devices', 'card after');
    eq(await page.inputValue('#ghSyncClientId'), '', 'input empty');
    eq((await page.locator('label[for=ghSyncClientId]').textContent()).trim(), 'Google Client ID', 'label');
    eq((await page.locator('#ghSyncSave').textContent()).trim(), 'Save', 'Save'); eq((await page.locator('#ghSyncRemove').textContent()).trim(), 'Remove', 'Remove');
    eq((await page.locator('#ghSyncBtn').textContent()).trim(), 'Sync Google Health', 'Sync btn'); ok(await page.locator('#ghSyncBtn').isEnabled(), 'Sync enabled');
    eq(await status(), '', 'status empty');
    const t = (await page.locator('#ghSyncCard').innerText()).toLowerCase();
    for (const p of ['about 1 hour', 'no background sync', 'test mode', 'sign in']) ok(t.includes(p), 'card text has "' + p + '"');
    await page.click('[data-tab="diary"]');
    ok(!(await page.locator('#ghSyncDiary').isVisible()), 'Diary button hidden');
    ok(!hosts.some(h => h === 'accounts.google.com' || h === 'health.googleapis.com'), 'no Google request, saw ' + hosts.join(','));
  });
  // C2
  await item('C2', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', 'not-a-client-id'); await page.click('#ghSyncSave');
    eq(await status(), 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.', 'status');
    eq(await ls(KEY), null, 'nothing saved');
    await page.click('[data-tab="diary"]'); ok(!(await page.locator('#ghSyncDiary').isVisible()), 'Diary button hidden');
  });
  // C3
  await item('C3', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', SECRET); await page.click('#ghSyncSave');
    eq(await status(), 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.', 'status');
    eq(await page.inputValue('#ghSyncClientId'), '', 'input emptied');
    ok(!(await page.evaluate(() => document.body.innerText)).includes('GOCSPX'), 'page text has no GOCSPX');
    ok(!(await storageDump()).includes('GOCSPX'), 'no storage has GOCSPX');
  });
  // C4
  await item('C4', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', ID); await page.click('#ghSyncSave');
    eq(await status(), 'Client ID saved on this device.', 'status');
    eq(await ls(KEY), ID, 'stored ID');
    const main = await ls('macrodiary.v1'); ok(main === null || !main.includes('apps.googleusercontent.com'), 'main state has no ID');
    await page.click('[data-tab="diary"]'); ok(await page.locator('#ghSyncDiary').isVisible(), 'Diary button visible');
    eq((await page.locator('#ghSyncDiary').textContent()).trim(), 'Sync Google Health', 'Diary button text');
  });
  // C5
  await item('C5', async () => {
    await start({ id: true }); await settings();
    eq(await page.inputValue('#ghSyncClientId'), ID, 'input shows ID after reload');
    await page.click('[data-tab="diary"]'); ok(await page.locator('#ghSyncDiary').isVisible(), 'Diary button visible');
  });
  // C6
  await item('C6', async () => {
    await start({ id: true }); await settings(); await page.click('#ghSyncRemove');
    eq(await status(), 'Client ID removed.', 'status'); eq(await page.inputValue('#ghSyncClientId'), '', 'input empty'); eq(await ls(KEY), null, 'key removed');
    await page.click('[data-tab="diary"]'); ok(!(await page.locator('#ghSyncDiary').isVisible()), 'Diary button hidden');
  });
  // C7
  await item('C7', async () => {
    await start({ id: true, state: seed({ activity: SEED15 }) }); await settings();
    await page.click('#ghSyncBtn');
    await page.waitForFunction(() => /^Synced|^Google|^Could|^Nothing/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 10000 });
    eq(await status(), SYNCED, 'status');
    eq(await page.evaluate(() => window.__requests), 1, '__requests');
    const cfg = await page.evaluate(() => ({ id: window.__cfg.client_id, scope: window.__cfg.scope }));
    eq(cfg.id, ID, 'client_id'); eq(cfg.scope, SCOPE, 'scope');
    eq(seen.length, 3, 'health request count');   // CHANGED: steps, sleep, exercise
    const [a, b, c3] = seen;
    eq(a.method + ' ' + a.url, 'POST ' + BASE + '/dataTypes/steps/dataPoints:dailyRollUp', 'steps request');
    eq(a.headers.authorization, 'Bearer stub-token-123', 'steps auth');
    const T0 = { hours: 0, minutes: 0, seconds: 0, nanos: 0 };
    eq(JSON.stringify(JSON.parse(a.body)), JSON.stringify({ range: { start: { date: { year: 2026, month: 11, day: 10 }, time: T0 }, end: { date: { year: 2026, month: 11, day: 17 }, time: T0 } }, windowSizeDays: 1 }), 'steps body');
    eq(b.method + ' ' + b.url, 'GET ' + BASE + '/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-10%22', 'sleep request');
    eq(b.headers.authorization, 'Bearer stub-token-123', 'sleep auth');
    eq(c3.method + ' ' + c3.url, 'GET ' + BASE + '/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%222026-11-10%22', 'exercise request');
    eq(c3.headers.authorization, 'Bearer stub-token-123', 'exercise auth');
    const bad = hosts.filter(h => h !== 'accounts.google.com' && h !== 'health.googleapis.com'); ok(!bad.length, 'other hosts: ' + bad.join(','));
    ok(await page.locator('#ghSyncBtn').isEnabled() && await page.locator('#ghSyncDiary').isEnabled(), 'buttons enabled again');
    ok(!(await pageText()).includes('stub-token-123') && !(await storageDump()).includes('stub-token-123') && !consoleAll.join('\n').includes('stub-token-123'), 'token leaked');
    await page.click('[data-tab="diary"]'); await page.waitForSelector('#activityLine', { state: 'visible' });
    const line = async () => (await page.locator('#activityLine').innerText()).replace(/\s+/g, ' ').trim();
    eq(await line(), 'From Google Health: Steps 1,226 · Sleep 6 h 38 min', 'today line');
    await page.click('#prev'); eq(await line(), 'From Google Health: Steps 2,919 · Sleep 5 h 36 min · 1 workout', '15th line');
    await page.click('#prev'); eq(await line(), 'From Google Health: Steps 12,921 · Sleep 7 h 15 min', '14th line');
  });
  // C8
  await item('C8', async () => {
    await start({ id: true, tab: 'diary' });
    ok(!(await page.locator('#activityLine').isVisible()), 'activityLine hidden before');
    await page.click('#ghSyncDiary');
    await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Synced'), null, { timeout: 10000 });
    eq((await page.locator('#toast').textContent()).trim(), SYNCED, 'toast');
    await page.waitForSelector('#activityLine', { state: 'visible', timeout: 3000 });
    eq((await page.locator('#activityLine').innerText()).replace(/\s+/g, ' ').trim(), 'From Google Health: Steps 1,226 · Sleep 6 h 38 min', 'activityLine');
    ok(await page.locator('#waterCups button').count() > 0, 'water cups still present');
    const a = (await stored()).activity['2026-11-16'];
    ok(a && a.steps === 1226 && a.sleepMinutes === 398 && a.sleepStart === '2026-11-16T09:00:00Z' && a.sleepEnd === '2026-11-16T13:00:00Z' && a.source === 'google-health', 'stored record: ' + JSON.stringify(a));
  });
  // C9
  await item('C9', async () => {
    await start({ id: true, tab: 'diary' }); await page.evaluate(() => { window.__delay = 600; });
    await page.click('#ghSyncDiary');   // the spec uses #ghSyncBtn; the Diary button runs the same function, so Settings is driven below too
    ok(await page.locator('#ghSyncDiary').isDisabled(), 'Diary button disabled while running');
    await page.waitForFunction(() => /^Synced/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 10000 });
    await settings(); await page.evaluate(() => { window.__delay = 600; window.__requests = 0; });
    await page.click('#ghSyncBtn');
    ok(await page.locator('#ghSyncBtn').isDisabled() && await page.locator('#ghSyncDiary').isDisabled(), 'both disabled');
    eq(await status(), 'Syncing with Google Health…', 'status while running');
    await page.locator('#ghSyncBtn').click({ force: true, timeout: 500 }).catch(() => {});
    await page.waitForTimeout(100);
    eq(await page.evaluate(() => window.__requests), 1, '__requests stays 1');
    await page.waitForFunction(() => !document.getElementById('ghSyncBtn').disabled, null, { timeout: 5000 });
    ok(await page.locator('#ghSyncDiary').isEnabled(), 'Diary enabled'); eq(await status(), SYNCED, 'final status');
  });
  // C10
  await item('C10', async () => {
    await start(); await settings(); await page.fill('#ghSyncClientId', ID); await page.click('#ghSyncBtn'); await page.waitForTimeout(300);
    eq(await status(), 'Enter a Client ID first.', 'status');
    eq(gsiHits, 0, 'accounts.google.com requests'); eq(healthReqs(), 0, 'health requests');
  });
  // C11
  await item('C11', async () => {
    await start({ id: true }); await settings(); await page.evaluate(() => { window.__reply = { errorCallback: { type: 'popup_closed' } }; });
    // __reply must exist when the Google stub runs; the stub reads it at click time, set after the script is loaded, so load it first via a failing-free tap:
    await clickSyncWith({ errorCallback: { type: 'popup_closed' } });
    eq(await status(), 'The Google sign-in window was closed before it finished. Tap Sync Google Health to try again.', 'status');
    eq(healthReqs(), 0, 'health requests'); ok(await page.locator('#ghSyncBtn').isEnabled() && await page.locator('#ghSyncDiary').isEnabled(), 'buttons enabled');
  });
  // helper used by C11/C12: __reply is read inside the stub's setTimeout, so it can be set right after the click as long as it is before the delay ends
  async function clickSyncWith(reply) {
    await page.evaluate(() => { window.__delay = 300; });
    await page.click('#ghSyncBtn');
    await page.evaluate(r => { window.__reply = r; }, reply);
    await page.waitForFunction(() => !document.getElementById('ghSyncBtn').disabled && !/^Syncing/.test(document.getElementById('ghSyncStatus').textContent), null, { timeout: 10000 });
  }
  // C12
  await item('C12', async () => {
    await start({ id: true }); await settings();
    await clickSyncWith({ callback: { error: 'access_denied', error_description: 'owner@example.com is not allowed' } });
    eq(await status(), 'Google did not allow access. While the app is in test mode, only accounts added as test users can sign in.', 'status');
    ok(!(await pageText()).includes('owner@example.com'), 'email on page');
  });
  // C13
  await item('C13', async () => {
    await start({ id: true, state: seed({ activity: SEED15 }) }); await settings();
    health.steps = json(401, { error: { code: 401, message: 'Invalid token ya29.fake for me@example.com', status: 'UNAUTHENTICATED' } });
    await clickSync();
    eq(await status(), 'Google rejected the sign-in. Tap Sync Google Health to sign in again.', 'status');
    ok(!seen.some(r => r.url.includes('reconcile')), 'sleep request was made');
    ok(!seen.some(r => r.url.includes('dataTypes/exercise')), 'exercise request was made');
    const a = (await stored()).activity['2026-11-15']; ok(a.steps === 5000 && a.updatedAt === 1000, '15th changed: ' + JSON.stringify(a));
    const t = await pageText(); ok(!t.includes('ya29.fake') && !t.includes('me@example.com'), 'secret text on page');
  });
  // C14
  await item('C14', async () => {
    await start({ id: true }); await settings();
    health.steps = json(400, { error: { code: 400, message: 'Account not linked', status: 'FAILED_PRECONDITION', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] } });
    await clickSync();
    eq(await status(), 'This Google account is not linked in the Google Health app yet. Open the app on your phone, sign in, then try again.', 'status');
  });
  // C15
  await item('C15', async () => {
    await start({ id: true }); await settings();
    health.sleep = json(403, { error: { code: 403, message: 'Insufficient scope', status: 'PERMISSION_DENIED' } });
    await clickSync();
    eq(await status(), 'Google refused access to your health data. Check that both Health permissions were ticked on the consent screen and the Google Health API is enabled.', 'status');
    const s = await stored(); ok(!s || !s.activity || Object.keys(s.activity).length === 0, 'activity applied: ' + JSON.stringify(s && s.activity));
  });
  // C16
  await item('C16', async () => {
    await start({ id: true }); await settings(); health.steps = 'abort'; health.sleep = 'abort';
    await clickSync();
    eq(await status(), 'Could not reach Google. Check your connection and try again.', 'status');
    ok(await page.locator('#ghSyncBtn').isEnabled() && await page.locator('#ghSyncDiary').isEnabled(), 'buttons enabled');
  });
  // C17
  await item('C17', async () => {
    await start({ id: true }); await settings();
    await clickSync(); eq(await status(), SYNCED, 'first status'); const u1 = (await stored()).activity['2026-11-16'].updatedAt;
    await page.waitForTimeout(50); await page.evaluate(() => { document.getElementById('ghSyncStatus').textContent = ''; });
    await clickSync(); eq(await status(), SYNCED, 'second status'); const u2 = (await stored()).activity['2026-11-16'].updatedAt;
    eq(u2, u1, 'updatedAt unchanged by the second sync');
  });
  // C18
  await item('C18', async () => {
    await start({ id: true }); await settings();
    health.steps = { status: 500, contentType: 'text/html', body: '<img src=x onerror=window.__pwned=1>' };
    await clickSync();
    eq(await status(), 'Google Health answered with an error (HTTP 500). Try again later.', 'status');
    ok(await page.evaluate(() => document.querySelector('#ghSyncStatus img') === null && window.__pwned === undefined), 'img or __pwned from the 500 body');
    await page.fill('#ghSyncClientId', '<img src=x onerror=window.__pwned=1>'); await page.click('#ghSyncSave');
    eq(await status(), 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.', 'bad-shape status');
    ok(await page.evaluate(() => document.querySelector('#ghSyncCard img') === null && window.__pwned === undefined), 'img or __pwned from the input');
  });
  // C19
  await item('C19', async () => {
    await start({ id: true }); await page.waitForTimeout(300);
    for (const t of ['diary', 'plan', 'recipes', 'shop', 'settings', 'diary']) { await page.click(`[data-tab="${t}"]`); await page.waitForTimeout(150); }
    eq(gsiHits, 0, 'accounts.google.com requests'); eq(healthReqs(), 0, 'health requests');
    ok(!hosts.includes('health.googleapis.com'), 'health host contacted');
  });
  // C20
  await item('C20', async () => {
    await start({ id: true }); await settings();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#bkExport')]);
    const path = await dl.path(); const { readFileSync } = await import('node:fs');
    const txt = readFileSync(path, 'utf8');
    ok(txt.length > 10, 'backup file read, ' + txt.length + ' bytes');
    ok(!txt.includes('apps.googleusercontent.com'), 'backup contains the Client ID');
  });

  // X1: 375 px look
  await item('X1-375px', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start({ id: true, tab: 'diary' });
    await page.waitForTimeout(200); await page.screenshot({ path: join(SHOTS, 'ghs-375-diary.png'), fullPage: true });
    const bd = await page.locator('#ghSyncDiary').boundingBox(); ok(bd && bd.height >= 36 && bd.x >= 0 && bd.x + bd.width <= 375, 'diary button box ' + JSON.stringify(bd));
    await settings(); await page.locator('#ghSyncCard').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(SHOTS, 'ghs-375-settings.png'), fullPage: true });
    await page.locator('#ghSyncCard').screenshot({ path: join(SHOTS, 'ghs-375-card.png') });
    const m = await page.evaluate(() => { const c = document.getElementById('ghSyncCard').getBoundingClientRect(); const kids = [...document.querySelectorAll('#ghSyncCard button, #ghSyncCard input')].map(e => { const r = e.getBoundingClientRect(); return { id: e.id, x: Math.round(r.x), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; }); return { card: { x: Math.round(c.x), r: Math.round(c.right) }, kids, scrollW: document.documentElement.scrollWidth }; });
    console.log('  375px metrics ' + JSON.stringify(m));
    ok(m.scrollW <= 375, 'horizontal overflow, scrollWidth ' + m.scrollW);
    ok(m.kids.every(k => k.x >= m.card.x && k.r <= m.card.r + 1), 'a control sticks out of the card');
  });

  ok(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
  if (fails.length) throw new Error(fails.length + ' item(s) failed: ' + fails.join(' || '));
}
