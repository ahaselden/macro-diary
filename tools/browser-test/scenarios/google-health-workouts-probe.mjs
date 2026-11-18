// Google Health probe, workouts step (tools/google-health-probe/), Google fully stubbed. Spec: docs/specs/google-health-workouts-probe.md, headless checklist C1 to C12.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCOPES = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const GSI = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; return { requestAccessToken() {} }; } } } };`;
export const allowConsoleErrors = true;   // stubbed 403/500 answers make Chromium log "Failed to load resource"; page errors are asserted below
export const stubs = [{ match: 'https://accounts.google.com/gsi/client', body: GSI, contentType: 'application/javascript' }];

const SHOTS = process.env.PROBE_SHOTS || 'C:/Users/Adam/AppData/Local/Temp/claude/f5883c2306ec2df6/f7b5aca2-91d1-4005-9166-4eb7f6af5f70/scratchpad/shots';
const ID = 'stub-client.example';
const BASE = 'https://health.googleapis.com/v4/users/me';
const TOKEN = 'TEST-TOKEN-NOT-REAL';
const WORKOUT = { dataPoints: [{ name: 'users/me/dataTypes/exercise/dataPoints/TEST-ID-0001', exercise: { interval: { startTime: '2026-11-14T07:15:00Z', startUtcOffset: '0s', endTime: '2026-11-14T07:45:00Z', endUtcOffset: '0s' }, exerciseType: 'RUNNING', displayName: 'Morning run with Pat Example', activeDuration: '1800s', hasGps: true, metricsSummary: { caloriesKcal: 412.5, distanceMillimeters: '5234000', steps: '5120', averageHeartRateBeatsPerMinute: '151' } } }], nextPageToken: '' };
const SECRETS = ['Pat Example', 'TEST-ID-0001', '2026-11-14T07', '412.5', '5234000', '5120', '151', '1800s'];
const EX_URL = d => `${BASE}/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%22${d}%22`;
const ERR403 = { error: { code: 403, message: 'Insufficient scope', status: 'PERMISSION_DENIED' } };
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const GSI_ROUTE = 'https://accounts.google.com/gsi/client';

export default async function ({ page, url, check, screenshot }) {
  mkdirSync(SHOTS, { recursive: true });
  const failures = [];
  const soft = (cond, msg) => { if (!cond) failures.push(msg); };
  let seen = [], health = {}, healthHits = 0;
  const shot = async name => { await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: true }); await screenshot(name); };

  await page.addInitScript(() => { window.__copied = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied.push(t); } }, configurable: true }); } catch {} });
  await page.clock.setFixedTime(new Date(2026, 10, 14, 20, 0, 0));
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('https://health.googleapis.com/v4/**', async route => {
    const r = route.request(); const u = r.url();
    healthHits++;
    seen.push({ method: r.method(), url: u, headers: r.headers(), body: r.postData() });
    const key = u.includes('/identity') ? 'identity' : u.includes('dailyRollUp') ? 'steps' : u.includes('reconcile') ? 'sleep' : u.includes('dataTypes/exercise') ? 'exercise' : 'other';
    const h = health[key];
    if (!h) return route.fulfill({ status: 404, body: '{}' });
    if (h === 'abort') return route.abort();
    return route.fulfill(h);
  });

  const base = () => ({ identity: json(200, { name: 'users/me/identity' }), steps: json(200, { rollupDataPoints: [] }), sleep: json(200, { dataPoints: [] }), exercise: json(200, WORKOUT) });
  const open = async (h = {}) => { seen = []; healthHits = 0; health = { ...base(), ...h }; await page.goto(url + '/tools/google-health-probe/'); await page.waitForSelector('#signIn'); };
  const waitGoogle = () => page.waitForFunction(() => window.google && window.google.accounts);
  const text = sel => page.$eval(sel, e => e.textContent);
  const TOKEN_CB = `window.__cfg.callback({access_token:'${TOKEN}', expires_in:3599, scope:'s1 s2', token_type:'Bearer'})`;
  const run = async ({ ticked = false, days } = {}) => {
    await waitGoogle();
    if (days) await page.selectOption('#days', days);
    if (ticked) await page.check('#showNumbers');
    await page.fill('#clientId', ID); await page.click('#signIn');
    await page.evaluate(TOKEN_CB);
    await page.waitForFunction(() => /^Done\./.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  };
  const lines = async () => (await text('#summary')).split('\n');
  const html = () => page.evaluate(() => document.documentElement.outerHTML);
  const hasBlock = (ls, block) => { for (let i = 0; i + block.length <= ls.length; i++) if (block.every((b, j) => ls[i + j] === b)) return true; return false; };

  // C1: Google script blocked
  await page.route(GSI_ROUTE, r => r.abort());
  await open();
  await page.fill('#clientId', ID); await page.click('#signIn');
  const ex1 = await text('#check-exercise');
  soft(ex1.startsWith('Exercise') && ex1.endsWith('not run yet.'), 'C1: #check-exercise starts "Exercise" and ends "not run yet.", got "' + ex1 + '"');
  soft((await text('#signIn')) === 'Sign in with Google', 'C1: #signIn text');
  soft((await text('#copySummary')) === 'Copy result summary', 'C1: #copySummary text');
  soft((await text('#status')) === 'The Google sign-in script did not load. Check the network and try again.', 'C1: #status text, got "' + await text('#status') + '"');
  soft(healthHits === 0, 'C1: no request to health.googleapis.com, got ' + healthHits);
  await page.unroute(GSI_ROUTE);

  // C2: nothing sent without a click
  await open(); await waitGoogle();
  await page.waitForTimeout(2000);
  await page.fill('#clientId', ID);
  soft(healthHits === 0, 'C2: zero health requests, got ' + healthHits);
  soft(await page.evaluate(() => window.__cfg === undefined), 'C2: window.__cfg undefined');
  soft(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'C2: storage empty');

  // C3: four requests, same token, exercise last
  await open();
  await run();
  soft(seen.length === 4, 'C3: exactly 4 health requests, got ' + seen.length);
  const order = seen.map(s => s.method + ' ' + (s.url.includes('/identity') ? 'identity' : s.url.includes('dailyRollUp') ? 'rollup' : s.url.includes('reconcile') ? 'reconcile' : s.url.includes('dataTypes/exercise') ? 'exercise' : '?'));
  soft(JSON.stringify(order) === JSON.stringify(['GET identity', 'POST rollup', 'GET reconcile', 'GET exercise']), 'C3: order, got ' + JSON.stringify(order));
  soft(seen.length > 0 && seen.every(s => s.headers.authorization === 'Bearer ' + TOKEN), 'C3: every request has Bearer ' + TOKEN);
  soft(seen[3] && seen[3].url === EX_URL('2026-11-12'), 'C3: exercise URL, got ' + (seen[3] && seen[3].url));
  soft(await page.evaluate(() => window.__cfg.scope) === SCOPES, 'C3: scope exactly the two readonly scopes');
  await shot('workouts-C3');

  // C4: workout, numbers unticked
  await open();
  await run();
  const s4 = await lines();
  const block4 = ['Exercise: HTTP 200 - ok', 'Exercise shape:'];
  soft(hasBlock(s4, block4), 'C4: #summary has "Exercise: HTTP 200 - ok" then "Exercise shape:" contiguously, got ' + JSON.stringify(s4));
  const i4 = s4.indexOf('Exercise shape:');
  const shapeLines4 = i4 >= 0 ? s4.slice(i4 + 1).filter(l => l.startsWith('  ')) : [];
  soft(i4 >= 0 && s4.slice(i4 + 1).length === shapeLines4.length && shapeLines4.length > 0, 'C4: every line after "Exercise shape:" starts with two spaces');
  for (const l of ['  exercise.exerciseType: string = RUNNING', '  exercise.interval.startTime: string', '  exercise.metricsSummary.caloriesKcal: number', '  exercise.metricsSummary.distanceMillimeters: string', '  exercise.hasGps: boolean']) soft(s4.includes(l), 'C4: summary has line "' + l + '"');
  const c4 = await text('#check-exercise');
  soft(c4.includes('Exercise: HTTP 200 - ok') && c4.includes('Exercise shape:'), 'C4: #check-exercise has verdict and shape heading, got "' + c4 + '"');
  soft(!s4.some(l => l.startsWith('Exercise numbers:')) && !c4.split('\n').some(l => l.startsWith('Exercise numbers:')), 'C4: no "Exercise numbers:" line');
  const h4 = await html();
  for (const s of SECRETS) soft(!h4.includes(s), 'C4: "' + s + '" appears in the page html');
  await shot('workouts-C4');

  // C5: ticked (also toggling after the run, no refetch)
  await open();
  await run({ ticked: true });
  const s5 = await lines();
  const num5 = s5.find(l => l.startsWith('Exercise numbers:')) || '';
  soft(num5.includes('RUNNING') && num5.includes('2026-11-14T07:15:00') && num5.includes('2026-11-14T07:45:00'), 'C5: "Exercise numbers:" line has RUNNING and both times, got "' + num5 + '"');
  soft(JSON.stringify(s5.filter(l => l.startsWith('  '))) === JSON.stringify(s4.filter(l => l.startsWith('  '))), 'C5: shape lines unchanged compared with unticked');
  const h5 = await html();
  for (const s of ['Pat Example', 'TEST-ID-0001', '412.5', '5234000', '5120', '151']) soft(!h5.includes(s), 'C5: "' + s + '" appears in the page html');
  const before5 = seen.length;
  await page.uncheck('#showNumbers');
  soft(!(await lines()).some(l => l.startsWith('Exercise numbers:')), 'C5: untick hides numbers');
  await page.check('#showNumbers');
  soft((await lines()).some(l => l.startsWith('Exercise numbers:')), 'C5: tick shows numbers again');
  soft(seen.length === before5, 'C5: no extra request on toggling, ' + before5 + ' -> ' + seen.length);
  await shot('workouts-C5');

  // C6: no workouts
  await open({ exercise: json(200, {}) });
  await run({ ticked: true });
  const s6 = await lines();
  soft(hasBlock(s6, ['Exercise: HTTP 200 - ok', 'Exercise shape:', '  no data points']), 'C6: verdict, shape heading, "  no data points" contiguous, got ' + JSON.stringify(s6));
  soft(s6.includes('Exercise numbers: no exercise records'), 'C6: "Exercise numbers: no exercise records"');

  // C7: exercise refused
  await open({ exercise: json(403, ERR403) });
  await run();
  const c7 = await text('#check-exercise');
  soft(c7.split('\n')[0] === 'Exercise: HTTP 403 - failed: PERMISSION_DENIED (403): Insufficient scope', 'C7: first line, got "' + c7 + '"');
  soft((await text('#check-identity')).trim() === 'identity: HTTP 200 - ok' && (await text('#check-steps')).includes('steps: HTTP 200 - ok') && (await text('#check-sleep')).trim() === 'sleep: HTTP 200 - ok', 'C7: other three checks show usual lines');
  soft((await text('#status')) === 'Done. The token is dropped. Copy the result summary below.', 'C7: #status done message, got "' + await text('#status') + '"');
  await shot('workouts-C7');

  // C8: network failure and HTML
  await open({ exercise: 'abort' });
  await run();
  const c8a = await text('#check-exercise');
  soft(c8a.startsWith('Exercise: no response - failed:'), 'C8: network failure line, got "' + c8a + '"');
  await open({ exercise: { status: 500, contentType: 'text/html', body: '<h1>oops</h1>' } });
  await run();
  const c8b = await text('#check-exercise');
  soft(c8b.startsWith('Exercise: HTTP 500 - failed:'), 'C8: HTTP 500 line, got "' + c8b + '"');
  soft(await page.evaluate(() => document.querySelectorAll('h1').length === 1), 'C8: exactly one h1 element');

  // C9: hostile answer
  const scriptsBefore = [];
  await open({ exercise: json(200, { dataPoints: [{ '<img src=x onerror=alert(1)>': '<b>x</b>', exercise: { exerciseType: 'RUNNING', '<script>': 1 } }] }) });
  const scriptCount = await page.evaluate(() => document.querySelectorAll('script').length);
  await run({ ticked: true });
  const s9 = await lines();
  soft(s9.includes('  ?: string'), 'C9: summary has "  ?: string", got ' + JSON.stringify(s9));
  soft(s9.includes('  exercise.?: number'), 'C9: summary has "  exercise.?: number"');
  soft(await page.evaluate(() => document.querySelectorAll('img, b').length) === 0, 'C9: no img or b element');
  soft(await page.evaluate(() => document.querySelectorAll('script').length) === scriptCount, 'C9: script element count unchanged (' + scriptCount + ')');
  soft(!(await html()).includes('onerror=alert'), 'C9: no "onerror=alert" in html');
  await shot('workouts-C9');

  // C10: privacy, copy
  await open();
  await run({ ticked: true });
  await page.click('#copySummary');
  const copied = await page.evaluate(() => window.__copied);
  const sum10 = await text('#summary');
  soft(copied.length === 1 && copied[0] === sum10, 'C10: copied text equals #summary, got ' + JSON.stringify(copied).slice(0, 200));
  soft(copied.length === 1 && !copied[0].includes(TOKEN) && !copied[0].includes('Pat Example') && !copied[0].includes('@'), 'C10: copied text has no token, name or @');
  soft(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''), 'C10: nothing in localStorage, sessionStorage, cookies');
  soft(await page.$eval('#signIn', e => !e.disabled), 'C10: #signIn enabled again');

  // C11: 31 days
  await open();
  await run({ days: '31' });
  soft(seen.length === 4, 'C11: exactly 4 requests, got ' + seen.length);
  const wantBody = { range: { start: { date: { year: 2026, month: 10, day: 15 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }, end: { date: { year: 2026, month: 11, day: 15 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } } }, windowSizeDays: 1 };
  const roll = seen.find(s => s.url.includes('dailyRollUp')), rec = seen.find(s => s.url.includes('reconcile')), exr = seen.find(s => s.url.includes('dataTypes/exercise')), idr = seen.find(s => s.url.includes('/identity'));
  soft(roll && roll.method === 'POST' && JSON.stringify(JSON.parse(roll.body || 'null')) === JSON.stringify(wantBody), 'C11: dailyRollUp body, got ' + (roll && roll.body));
  soft(rec && rec.url.endsWith('filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-10-15%22'), 'C11: reconcile URL, got ' + (rec && rec.url));
  soft(exr && exr.url === EX_URL('2026-10-15'), 'C11: exercise URL, got ' + (exr && exr.url));
  soft(idr && idr.url === BASE + '/identity' && idr.method === 'GET', 'C11: identity request unchanged');

  // C12: the days control, value read at the click
  await open(); await waitGoogle();
  const d = await page.evaluate(() => { const l = document.querySelector('label[for="days"]'), s = document.getElementById('days'); return { label: l && l.textContent, tag: s && s.tagName, opts: s && [...s.options].map(o => o.value), val: s && s.value }; });
  soft(d.label === 'Days to read', 'C12: label text, got ' + d.label);
  soft(d.tag === 'SELECT', 'C12: #days is a select, got ' + d.tag);
  soft(JSON.stringify(d.opts) === JSON.stringify(['3', '7', '14', '31']), 'C12: option values, got ' + JSON.stringify(d.opts));
  soft(d.val === '3', 'C12: default value 3, got ' + d.val);
  await page.selectOption('#days', '7');
  await page.fill('#clientId', ID); await page.click('#signIn');
  await page.selectOption('#days', '31');
  await page.evaluate(TOKEN_CB);
  await page.waitForFunction(() => /^Done\./.test(document.getElementById('status').textContent), null, { timeout: 5000 });
  const exr12 = seen.find(s => s.url.includes('dataTypes/exercise'));
  soft(exr12 && exr12.url === EX_URL('2026-11-08'), 'C12: exercise URL carries 2026-11-08, got ' + (exr12 && exr12.url));

  soft(pageErrors.length === 0, 'uncaught page errors: ' + pageErrors.join(','));
  for (const f of failures) console.log('FINDING: ' + f);
  if (failures.length) throw new Error('Check failed: ' + failures.join(' | '));
  check(true, 'C1-C12: all workouts probe checks passed');
}
