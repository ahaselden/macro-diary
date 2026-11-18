// docs/specs/google-health-workouts.md, headless checklist C1..C14 (Google's sign-in script and health.googleapis.com fully stubbed, invented data).
// Timezone America/New_York (forced with the DevTools protocol), clock fixed to 2026-11-16 12:00 local (17:00Z = 1794848400000). The built-in Client ID is used.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const NOW = 1794848400000, H = 3600000;
const KEY = 'macrodiary.v1', PK = 'macrodiary.googlesync.v1';
const SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const BASE = 'https://health.googleapis.com/v4/users/me';
const EX_URL = BASE + '/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%222026-11-10%22';
const SLEEP_URL = BASE + '/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-10%22';
const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; return { requestAccessToken(arg) {
  window.__args = (window.__args || []).concat([arg || null]); window.__requests = (window.__requests || 0) + 1;
  setTimeout(() => cfg.callback({ access_token: 'stub-token-123', expires_in: 3599, scope: 'x', token_type: 'Bearer' }), 50); } }; } } } };`;
export const allowConsoleErrors = true;   // stubbed 4xx/5xx answers make Chromium log "Failed to load resource"; page errors and leaks are asserted below
export const stubs = [{ match: 'https://accounts.google.com/gsi/client', body: GSI, contentType: 'application/javascript' }];

const SHOTS = process.env.GHS_SHOTS || 'C:/Users/Adam/AppData/Local/Temp/claude/f5883c2306ec2df6/f7b5aca2-91d1-4005-9166-4eb7f6af5f70/scratchpad/shots';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const d = (y, m, dd) => ({ civilStartTime: { date: { year: y, month: m, day: dd }, time: {} } });
const STEPS_OK = { rollupDataPoints: [{ ...d(2026, 11, 14), steps: { countSum: '12921' } }, { ...d(2026, 11, 15), steps: { countSum: '2919' } }, { ...d(2026, 11, 16), steps: { countSum: '1226' } }, d(2026, 11, 13)] };
const sl = (s, e, m) => ({ sleep: { interval: { startTime: s, startUtcOffset: '-18000s', endTime: e, endUtcOffset: '-18000s' }, summary: { minutesAsleep: m } } });
const SLEEP_OK = { dataPoints: [sl('2026-11-16T09:00:00Z', '2026-11-16T13:00:00Z', '239'), sl('2026-11-16T05:30:00Z', '2026-11-16T08:09:00Z', '159'), sl('2026-11-15T06:00:00Z', '2026-11-15T11:00:00Z', '268'),
  sl('2026-11-15T04:00:00Z', '2026-11-15T05:10:00Z', '68'), sl('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435')], nextPageToken: '' };
const P = 'users/me/dataTypes/exercise/dataPoints/';
const A = { name: P + 'TEST-RUN-0001', exercise: { exerciseType: 'RUNNING', displayName: 'Run', interval: { startTime: '2026-11-14T18:07:37Z', startUtcOffset: '-18000s', endTime: '2026-11-14T18:40:37Z', endUtcOffset: '-18000s' }, activeDuration: '1860s', exerciseMetadata: { hasGps: true },
  metricsSummary: { caloriesKcal: 312.4, distanceMillimeters: 4200400, steps: '5120', averageHeartRateBeatsPerMinute: '148', activeZoneMinutes: '22', averagePaceSecondsPerMeter: 0.43 } } };
const B = { name: P + 'TEST-SPORT-0002', exercise: { exerciseType: 'SPORT', displayName: '', interval: { startTime: '2026-11-15T01:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-15T02:00:00Z', endUtcOffset: '-18000s' }, metricsSummary: { caloriesKcal: 150, averageHeartRateBeatsPerMinute: '121' } } };
const C = { name: P + 'TEST-WALK-0003', exercise: { exerciseType: 'WALKING', interval: { startTime: '2026-11-16T14:00:00Z', startUtcOffset: '-18000s', endTime: '2026-11-16T14:20:00Z', endUtcOffset: '-18000s' }, activeDuration: '1200s', metricsSummary: { caloriesKcal: 95.4, distanceMillimeters: 1700000, steps: '2400' } } };
const EXERCISE_OK = { dataPoints: [A, B, C], nextPageToken: '' };
const HAPPY = () => ({ steps: json(200, STEPS_OK), sleep: json(200, SLEEP_OK), exercise: json(200, EXERCISE_OK) });
const SYNCED0 = 'Synced 3 days: steps for 3, sleep for 3';
const SYNCED = SYNCED0 + ', workouts for 2';
const FAILED = SYNCED0 + '. Workouts could not be read from Google Health.';
const ZIP1 = { id: 'zip-1', name: 'Run', start: '2026-11-14T18:07:00Z', minutes: 31, kcal: 300, steps: 5100, distanceM: 4100, avgHr: 147, peakHr: 170 };
const ZIP2 = { id: 'zip-2', name: 'Walk', start: '2026-11-15T13:00:00Z', minutes: 40 };
const OLD = { updatedAt: 1, source: 'google-health', workouts: [{ id: 'zip-3', name: 'Old', start: '2026-10-01T13:00:00Z', minutes: 10 }] };
const ZIPSEED = () => ({ '2026-11-14': { updatedAt: 1000, source: 'google-health', steps: 5000, workouts: [{ ...ZIP1 }] }, '2026-11-15': { updatedAt: 1000, source: 'google-health', workouts: [{ ...ZIP2 }] }, '2026-10-01': JSON.parse(JSON.stringify(OLD)) });
const seed = (extra = {}) => ({ schemaVersion: 9, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days: {}, ...extra });
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(q => [q, x[q]])) : x);

export default async function ({ page, url, screenshot }) {
  mkdirSync(SHOTS, { recursive: true });
  const fails = [];
  let health = HAPPY(), seen = [], consoleAll = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { const p = join(SHOTS, 'ghw-' + id + '-fail.png'); await page.screenshot({ path: p, fullPage: true }); console.log('  screenshot: ' + p); } catch {} }
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await page.clock.setFixedTime(new Date(NOW));
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => consoleAll.push(m.text()));
  await page.route('https://health.googleapis.com/v4/**', async route => {
    const r = route.request(), u = r.url();
    seen.push({ method: r.method(), url: u, headers: r.headers(), body: r.postData() });
    let h = health[u.includes('dailyRollUp') ? 'steps' : u.includes('reconcile') ? 'sleep' : u.includes('dataTypes/exercise') ? 'exercise' : 'other'];
    if (typeof h === 'function') h = h(u);
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    if (h === 'abort') return route.abort();
    return route.fulfill(h);
  });
  page.on('dialog', x => x.accept());

  const start = async ({ state = null, prefs = null, tab = null } = {}) => {
    await page.goto(url + '/no-such-page-for-origin.txt');   // same origin, not the app: the previous item's saved state must not start a quiet sync
    await page.evaluate(([s, p, k, pk]) => { localStorage.clear(); sessionStorage.clear(); if (p) localStorage.setItem(pk, p); if (s) localStorage.setItem(k, JSON.stringify(s)); }, [state, prefs, KEY, PK]);
    health = HAPPY(); seen = []; consoleAll = [];
    await page.goto(url + '/index.html'); await page.waitForSelector('.tabs');
    if (tab) await page.click(`[data-tab="${tab}"]`);
  };
  const settings = () => page.click('[data-tab="settings"]');
  const diary = async () => { await page.click('[data-tab="diary"]'); await page.waitForSelector('#dialsOpen', { state: 'visible' }); };
  const status = async () => (await page.locator('#ghSyncStatus').textContent()).trim();
  const stored = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const prefsObj = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), PK);
  const pageText = () => page.evaluate(() => document.body.innerText + '\n' + document.documentElement.outerHTML);
  const line = async () => (await page.locator('#activityLine').innerText()).replace(/\s+/g, ' ').trim();
  const idle = () => page.waitForFunction(() => !document.getElementById('ghSyncBtn').disabled && !/^Syncing/.test(document.getElementById('ghSyncStatus').textContent) && document.getElementById('ghSyncStatus').textContent.trim() !== '', null, { timeout: 10000 });
  const sync = async () => { await settings(); await page.click('#ghSyncBtn'); await idle(); };
  const details = async () => {
    await page.click('#dialsOpen'); await page.waitForSelector('#dlg[open]');
    const txt = await page.locator('#dBody').innerText();
    const heading = await page.locator('#dBody h2', { hasText: /^Workouts$/ }).count();
    await page.evaluate(() => document.getElementById('dlg').close());
    return { lines: txt.split('\n').map(l => l.trim()).filter(Boolean), heading };
  };
  const back = async n => { for (let i = 0; i < n; i++) await page.click('#prev'); };
  const D14 = ['Run · 31 min · 4.2 km · 312 kcal · avg 148 bpm', 'Sport · 30 min · 150 kcal · avg 121 bpm'];
  const wk = (s, day) => (s.activity[day] || {}).workouts;
  const noLeak = async () => { const t = await pageText(); ok(!t.includes('ya29.fake') && !t.includes('me@example.com') && !t.includes('stub-token-123') && !consoleAll.join('\n').includes('stub-token-123'), 'secret text on the page or console'); };

  await item('C1: sync with workouts, units g', async () => {
    await start({ tab: 'settings' });
    await page.click('#ghSyncBtn'); await idle();
    eq(await status(), SYNCED, 'C1: status');
    eq(seen.length, 3, 'C1: Health request count');
    eq(seen[0].method + ' ' + seen[0].url, 'POST ' + BASE + '/dataTypes/steps/dataPoints:dailyRollUp', 'C1: request 1');
    eq(seen[1].method + ' ' + seen[1].url, 'GET ' + SLEEP_URL, 'C1: request 2');
    eq(seen[2].method + ' ' + seen[2].url, 'GET ' + EX_URL, 'C1: request 3');
    ok(seen.every(r => r.headers.authorization === 'Bearer stub-token-123'), 'C1: bearer on all three');
    eq(await page.evaluate(() => window.__requests), 1, 'C1: sign-in asked once'); eq(await page.evaluate(() => window.__cfg.scope), SCOPE, 'C1: scope');
    const s = await stored(), a = s.activity;
    eq(canon(wk(s, '2026-11-14')), canon([{ id: 'TEST-RUN-0001', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31, kcal: 312, steps: 5120, distanceM: 4200, avgHr: 148 }, { id: 'TEST-SPORT-0002', name: 'Sport', start: '2026-11-15T01:30:00Z', minutes: 30, kcal: 150, avgHr: 121 }]), 'C1: 14th workouts');
    eq(canon(wk(s, '2026-11-16')), canon([{ id: 'TEST-WALK-0003', name: 'Walking', start: '2026-11-16T14:00:00Z', minutes: 20, kcal: 95, steps: 2400, distanceM: 1700 }]), 'C1: 16th workouts');
    ok(!('workouts' in a['2026-11-15']), 'C1: 15th has no workouts key');
    for (const [day, st, sm] of [['2026-11-14', 12921, 435], ['2026-11-15', 2919, 336], ['2026-11-16', 1226, 398]]) ok(a[day].source === 'google-health' && a[day].steps === st && a[day].sleepMinutes === sm, 'C1: record ' + day + ' ' + JSON.stringify(a[day]));
    eq(s.schemaVersion, 13, 'C1: schemaVersion');
  });

  await item('C2: Diary lines, units g', async () => {
    await start({ tab: 'settings' }); await page.click('#ghSyncBtn'); await idle(); await diary();
    eq(await line(), 'From Google Health: Steps 1,226 · Sleep 6 h 38 min · 1 workout', 'C2: 16th line');
    let t = await details(); eq(t.heading, 1, 'C2: 16th Workouts heading'); ok(t.lines.includes('Walking · 20 min · 1.7 km · 95 kcal'), 'C2: 16th row, got ' + JSON.stringify(t.lines));
    await back(1); eq(await line(), 'From Google Health: Steps 2,919 · Sleep 5 h 36 min', 'C2: 15th line');
    t = await details(); eq(t.heading, 0, 'C2: 15th has no Workouts heading');
    await back(1); eq(await line(), 'From Google Health: Steps 12,921 · Sleep 7 h 15 min · 2 workouts', 'C2: 14th line');
    t = await details(); eq(t.heading, 1, 'C2: 14th Workouts heading');
    const i0 = t.lines.indexOf(D14[0]), i1 = t.lines.indexOf(D14[1]);
    ok(i0 >= 0 && i1 === i0 + 1, 'C2: 14th rows in order, got ' + JSON.stringify(t.lines));
  });

  await item('C3: Diary lines, units oz', async () => {
    await start({ state: seed({ weightUnit: 'oz' }), tab: 'settings' }); await page.click('#ghSyncBtn'); await idle(); await diary();
    let t = await details(); ok(t.lines.includes('Walking · 20 min · 1.1 mi · 95 kcal'), 'C3: 16th row oz, got ' + JSON.stringify(t.lines));
    await back(2); t = await details();
    ok(t.lines.includes('Run · 31 min · 2.6 mi · 312 kcal · avg 148 bpm') && t.lines.includes(D14[1]), 'C3: 14th rows oz, got ' + JSON.stringify(t.lines));
    await settings(); await page.selectOption('#wUnit', 'g'); await diary();
    t = await details(); ok(t.lines.includes(D14[0]) && t.lines.includes(D14[1]), 'C3: back to km without a new sync, got ' + JSON.stringify(t.lines));
    eq(seen.length, 3, 'C3: no new requests after switching units');
  });

  await item('C4: replace per day', async () => {
    await start({ state: seed({ activity: ZIPSEED() }), tab: 'settings' }); await page.click('#ghSyncBtn'); await idle();
    eq(await status(), SYNCED, 'C4: status');
    const s = await stored();
    ok(wk(s, '2026-11-14').length === 2 && wk(s, '2026-11-14').every(w => !('peakHr' in w)), 'C4: 14th stored workouts, ' + JSON.stringify(wk(s, '2026-11-14')));
    await diary(); await back(1);
    eq(await line(), 'From Google Health: Steps 2,919 · Sleep 5 h 36 min · 1 workout', 'C4: 15th line');
    let t = await details(); ok(t.lines.includes('Walk · 40 min'), 'C4: 15th row, got ' + JSON.stringify(t.lines));
    eq(s.activity['2026-11-15'].steps, 2919, 'C4: 15th steps from the API');
    await back(1); t = await details();
    ok(t.lines.includes(D14[0]) && t.lines.includes(D14[1]), 'C4: 14th rows, got ' + JSON.stringify(t.lines));
    ok(!t.lines.some(l => l.includes('avg 147 bpm') || l.includes('4.1 km')), 'C4: zip Run still shown');
    eq(canon(s.activity['2026-10-01']), canon(OLD), 'C4: old day byte for byte');
  });

  await item('C5: no workouts in the answer', async () => {
    for (const body of [{ dataPoints: [] }, {}]) {
      await start({ state: seed({ activity: ZIPSEED() }), tab: 'settings' }); health.exercise = json(200, body);
      await page.click('#ghSyncBtn'); await idle();
      eq(await status(), SYNCED0, 'C5: status for ' + JSON.stringify(body)); eq(seen.length, 3, 'C5: request count');
      await diary(); await back(2); const t = await details();
      eq(t.lines.filter(l => l === 'Run · 31 min · 4.1 km · 300 kcal · avg 147 bpm').length, 1, 'C5: zip row once for ' + JSON.stringify(body) + ', got ' + JSON.stringify(t.lines));
    }
  });

  await item('C6: exercise request fails', async () => {
    const variants = [['500', json(500, { error: { code: 500, message: 'Bad ya29.fake for me@example.com', status: 'INTERNAL' } })], ['403', json(403, { error: { code: 403, message: 'no', status: 'PERMISSION_DENIED' } })], ['abort', 'abort'], ['200 html', { status: 200, contentType: 'text/html', body: '<html>nope' }]];
    for (const [n, stub] of variants) {
      const before = pageErrors.length;
      await start({ state: seed({ activity: ZIPSEED() }), tab: 'settings' }); health.exercise = stub;
      await page.click('#ghSyncBtn'); await idle();
      eq(await status(), FAILED, 'C6(' + n + '): status'); eq(seen.length, 3, 'C6(' + n + '): request count (exercise made once)');
      const s = await stored(), a = s.activity;
      ok(a['2026-11-14'].steps === 12921 && a['2026-11-15'].steps === 2919 && a['2026-11-16'].steps === 1226 && a['2026-11-14'].sleepMinutes === 435 && a['2026-11-15'].sleepMinutes === 336 && a['2026-11-16'].sleepMinutes === 398, 'C6(' + n + '): steps/sleep applied');
      eq(canon(wk(s, '2026-11-14')), canon([ZIP1]), 'C6(' + n + '): 14th zip workouts kept'); eq(canon(wk(s, '2026-11-15')), canon([ZIP2]), 'C6(' + n + '): 15th zip workouts kept');
      ok(!('workouts' in a['2026-11-16']), 'C6(' + n + '): 16th has no workouts');
      await noLeak(); eq(pageErrors.length, before, 'C6(' + n + '): page errors ' + pageErrors.join('|'));
    }
  });

  await item('C7: sign-in / steps / sleep failure all-or-nothing', async () => {
    const SEEDACT = ZIPSEED();
    await start({ state: seed({ activity: SEEDACT }), tab: 'settings' });
    health.steps = json(401, { error: { code: 401, message: 'Invalid token ya29.fake for me@example.com', status: 'UNAUTHENTICATED' } });
    await page.click('#ghSyncBtn'); await idle();
    eq(await status(), 'Google rejected the sign-in. Tap Sync Google Health to sign in again.', 'C7a: status'); eq(seen.length, 1, 'C7a: request count');
    eq(canon((await stored()).activity), canon(SEEDACT), 'C7a: nothing written'); await noLeak();
    await start({ state: seed({ activity: SEEDACT }), tab: 'settings' }); health.sleep = json(500, { error: { code: 500 } });
    await page.click('#ghSyncBtn'); await idle();
    eq(await status(), 'Google Health answered with an error (HTTP 500). Try again later.', 'C7b: status'); eq(seen.length, 2, 'C7b: request count');
    eq(canon((await stored()).activity), canon(SEEDACT), 'C7b: nothing written');
  });

  await item('C8: Diary button and toast', async () => {
    await start({ tab: 'diary' }); ok(await page.locator('#ghSyncDiary').isVisible(), 'C8: Diary button visible');
    await page.click('#ghSyncDiary'); await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Synced'), null, { timeout: 10000 });
    eq((await page.locator('#toast').textContent()).trim(), SYNCED, 'C8: toast');
    await page.waitForSelector('#activityLine', { state: 'visible', timeout: 3000 });
    eq(await line(), 'From Google Health: Steps 1,226 · Sleep 6 h 38 min · 1 workout', 'C8: 16th line without a reload');
    await start({ tab: 'diary' }); health.exercise = json(500, { error: { code: 500 } });
    await page.click('#ghSyncDiary'); await page.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Synced'), null, { timeout: 10000 });
    eq((await page.locator('#toast').textContent()).trim(), FAILED, 'C8: toast with exercise 500');
  });

  await item('C9: quiet sync on open', async () => {
    const stale = ms => JSON.stringify({ lastSyncAt: ms, auto: true });
    await start({ prefs: stale(NOW - 4 * H) });
    await page.waitForFunction(() => (window.__requests || 0) >= 1, null, { timeout: 5000 }); await page.waitForSelector('#activityLine', { state: 'visible', timeout: 5000 }); await page.waitForTimeout(500);
    eq(await page.evaluate(() => window.__requests), 1, 'C9: sign-in once'); eq(await page.evaluate(() => window.__args[0].prompt), 'none', 'C9: prompt none');
    eq(seen.length, 3, 'C9: Health requests'); ok((await line()).endsWith('· 1 workout'), 'C9: 16th line, got ' + await line());
    await settings(); eq(await status(), SYNCED, 'C9: status'); eq((await prefsObj()).lastSyncAt, NOW, 'C9: lastSyncAt');
    // variant: exercise 500. The stub is set before the quiet attempt by seeding the route table through a fresh load.
    await page.goto(url + '/no-such-page-for-origin.txt'); await page.evaluate(([p, pk]) => { localStorage.clear(); localStorage.setItem(pk, p); }, [stale(NOW - 4 * H), PK]);
    health = HAPPY(); health.exercise = json(500, { error: { code: 500 } }); seen = [];
    await page.goto(url + '/index.html'); await page.waitForFunction(() => (window.__requests || 0) >= 1, null, { timeout: 5000 }); await page.waitForTimeout(800);
    await settings(); eq(await status(), FAILED, 'C9 variant: status');
    const s = await stored(); ok(s.activity['2026-11-16'].steps === 1226 && s.activity['2026-11-16'].sleepMinutes === 398, 'C9 variant: steps/sleep applied');
    await page.click('[data-tab="diary"]'); ok(await page.locator('#ghSyncDiary').isVisible(), 'C9 variant: Diary button stays');
  });

  await item('C10: second identical sync changes nothing', async () => {
    await start({ tab: 'settings' }); await page.click('#ghSyncBtn'); await idle();
    const up = s => ['2026-11-14', '2026-11-15', '2026-11-16'].map(k => s.activity[k].updatedAt);
    const u1 = up(await stored());
    await page.waitForTimeout(100); await page.evaluate(() => { document.getElementById('ghSyncStatus').textContent = ''; });
    await page.click('#ghSyncBtn'); await idle();
    eq(await status(), SYNCED, 'C10: second status'); eq(JSON.stringify(up(await stored())), JSON.stringify(u1), 'C10: updatedAt of all three days');
  });

  await item('C11: two pages of exercise results', async () => {
    const two = u => u.endsWith('&pageToken=tok2') ? json(200, { dataPoints: [C], nextPageToken: '' }) : json(200, { dataPoints: [A, B], nextPageToken: 'tok2' });
    await start({ tab: 'settings' }); health.exercise = two; await page.click('#ghSyncBtn'); await idle();
    eq(seen.length, 4, 'C11: request count'); eq(seen[3].method + ' ' + seen[3].url, 'GET ' + EX_URL + '&pageToken=tok2', 'C11: 4th request');
    eq(await status(), SYNCED, 'C11: status'); const s = await stored();
    eq(wk(s, '2026-11-14').map(w => w.id).join(), 'TEST-RUN-0001,TEST-SPORT-0002', 'C11: 14th ids'); eq(wk(s, '2026-11-16').map(w => w.id).join(), 'TEST-WALK-0003', 'C11: 16th ids');
    await start({ tab: 'settings' }); health.exercise = u => u.endsWith('&pageToken=tok2') ? json(429, { error: { code: 429 } }) : json(200, { dataPoints: [A, B], nextPageToken: 'tok2' });
    await page.click('#ghSyncBtn'); await idle();
    eq(await status(), FAILED, 'C11: status after 429'); const s2 = await stored();
    ok(Object.values(s2.activity).every(x => !x.workouts), 'C11: no workouts stored from page 1, ' + JSON.stringify(s2.activity));
  });

  await item('C12: offset and midnight', async () => {
    const late = { name: P + 'TEST-LATE-0004', exercise: { exerciseType: 'RUNNING', displayName: 'Late run', interval: { startTime: '2026-11-15T04:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-15T04:50:00Z', endUtcOffset: '-18000s' } } };
    const mid = { name: P + 'TEST-MID-0005', exercise: { exerciseType: 'RUNNING', displayName: 'Midnight run', interval: { startTime: '2026-11-15T05:00:00Z', startUtcOffset: '-18000s', endTime: '2026-11-15T05:20:00Z', endUtcOffset: '-18000s' } } };
    await start({ tab: 'settings' }); health.exercise = json(200, { dataPoints: [late, mid] }); await page.click('#ghSyncBtn'); await idle();
    eq(await status(), SYNCED, 'C12: status'); await diary(); await back(2);
    ok((await line()).endsWith('· 1 workout'), 'C12: 14th line, got ' + await line());
    let t = await details(); ok(t.lines.includes('Late run · 20 min') && !t.lines.some(l => l.includes('Midnight run')), 'C12: 14th rows, got ' + JSON.stringify(t.lines));
    await page.click('#next'); ok((await line()).endsWith('· 1 workout'), 'C12: 15th line, got ' + await line());
    t = await details(); ok(t.lines.includes('Midnight run · 20 min') && !t.lines.some(l => l.includes('Late run')), 'C12: 15th rows, got ' + JSON.stringify(t.lines));
    await page.click('#next'); ok(!(await line()).includes('workout'), 'C12: 16th line has no workout, got ' + await line());
    ok(!('workouts' in (await stored()).activity['2026-11-16']), 'C12: 16th stored has no workouts');
  });

  await item('C13: hostile display name is text', async () => {
    const name = '<img src=x onerror="window.__pwned=1"> & "q"';
    const rec = { name: P + 'TEST-HOSTILE-0007', exercise: { exerciseType: 'RUNNING', displayName: name, interval: { startTime: '2026-11-16T14:00:00Z', startUtcOffset: '-18000s', endTime: '2026-11-16T14:30:00Z', endUtcOffset: '-18000s' } } };
    await start({ tab: 'settings' }); health.exercise = json(200, { dataPoints: [rec] }); await page.click('#ghSyncBtn'); await idle();
    ok(/^Synced/.test(await status()), 'C13: status "' + await status() + '"');
    await diary(); await page.click('#dialsOpen'); await page.waitForSelector('#dlg[open]');
    const lines = (await page.locator('#dBody').innerText()).split('\n').map(l => l.trim());
    ok(lines.includes(name + ' · 30 min'), 'C13: exact row, got ' + JSON.stringify(lines));
    eq(await page.locator('#dBody img').count(), 0, 'C13: no img in #dBody'); eq(await page.evaluate(() => window.__pwned), undefined, 'C13: __pwned');
    await page.evaluate(() => document.getElementById('dlg').close());
  });

  await item('C14: layout at 375 px', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    const long = 'Abcdefghij'.repeat(6);
    const rec = { ...A, name: P + 'TEST-LONG-0006', exercise: { ...A.exercise, displayName: long, interval: { startTime: '2026-11-14T19:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-14T20:03:00Z', endUtcOffset: '-18000s' } } };
    await start({ tab: 'settings' }); health.exercise = json(200, { dataPoints: [A, B, C, rec] }); await page.click('#ghSyncBtn'); await idle();
    await diary(); await back(2); await page.click('#dialsOpen'); await page.waitForSelector('#dlg[open]');
    const m = await page.evaluate(long => { const dlg = document.getElementById('dlg'), rows = [...document.querySelectorAll('#dBody div')].filter(e => e.children.length === 0 && e.textContent.startsWith(long));
      const r = rows[0]; return { pageW: document.documentElement.scrollWidth, dlgScroll: dlg.scrollWidth, dlgClient: dlg.clientWidth, bodyScroll: document.getElementById('dBody').scrollWidth, bodyClient: document.getElementById('dBody').clientWidth, text: r && r.textContent, h: r && r.getBoundingClientRect().height, lh: r && parseFloat(getComputedStyle(r).lineHeight) || 20 }; }, long);
    console.log('  375px metrics ' + JSON.stringify(m)); await screenshot('ghw-C14-long-row-375');
    ok(m.pageW <= 375, 'C14: page horizontal overflow ' + m.pageW); ok(m.dlgScroll <= m.dlgClient && m.bodyScroll <= m.bodyClient, 'C14: dialog horizontal overflow ' + JSON.stringify(m));
    eq(m.text, long + ' · 31 min · 4.2 km · 312 kcal · avg 148 bpm', 'C14: long row text');
    ok(m.h > m.lh * 1.5, 'C14: the long row wraps (height ' + m.h + ', line ' + m.lh + ')');
    await page.evaluate(() => document.getElementById('dlg').close());
  });

  ok(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
  if (fails.length) throw new Error(fails.length + ' item(s) failed: ' + fails.join(' || '));
}
