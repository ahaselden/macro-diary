// Sync on launch (docs/specs/sync-on-launch.md, checklist C1..C10). The built-in Supabase host is stubbed with page.route (dynamic, counted).
// Expected console errors: the stubbed 400 (C4) and 500 (C5, C8) responses. They are checked in C10 instead of failing the run.
export const allowConsoleErrors = true;

const HOST = 'https://rblowifmbeokvwengabb.supabase.co';
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const validSession = () => ({ access_token: 'acc_seed', refresh_token: 'ref_seed', expires_at: nowSec() + 3600 });
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export default async ({ page, url, check, screenshot }) => {
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) consoleErrors.push(m.text()); });
  await page.addInitScript(() => {
    window.__toasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.getElementById('toast'); if (!t) return;
      new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true });
    });
  });

  let reqs = [], other = [];
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith(HOST)) reqs.push({ method: r.method(), url: u, auth: r.headers()['authorization'] || '' });
    else if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) other.push(u);
  });
  const gets = () => reqs.filter(r => r.method === 'GET' && r.url.includes('/rest/v1/records'));

  // handlers: recordsStatus(n) -> [status, body] for the nth records GET (1-based)
  const setup = async ({ recordsFn, refreshFn } = {}) => {
    await page.unroute('**/*').catch(() => {});   // no-op if nothing; context-level route stays
    let n = 0;
    await page.route(u => u.href.startsWith(HOST), route => {
      const u = route.request().url(), m = route.request().method();
      if (u.includes('/auth/v1/token')) { const [s, b] = (refreshFn || (() => [200, { access_token: 'acc_new', refresh_token: 'ref_new', expires_in: 3600 }]))(); return json(route, s, b); }
      if (u.includes('/rest/v1/rpc/push_record')) return json(route, 200, [{ accepted: true, rev: 1 }]);
      if (u.includes('/rest/v1/records') && m === 'GET') { n++; const [s, b] = (recordsFn || (() => [200, []]))(n); return json(route, s, b); }
      return json(route, 200, []);
    });
  };
  const start = async cfg => {
    reqs = []; other = [];
    await page.goto(url + '/index.html');
    await page.evaluate(c => { localStorage.clear(); localStorage.setItem('macrodiary.sync.v1', JSON.stringify(c)); }, cfg);
    reqs = []; other = [];
    await page.reload();
    await page.waitForSelector('.tabs');
  };
  const openSettings = async () => { await page.click('[data-tab="more"]'); await page.click('#moreSettings'); await page.waitForSelector('#syncBox', { state: 'visible' }); };
  const msg = async () => ((await page.locator('#syncMsg').textContent()) || '').trim();
  const toasts = () => page.evaluate(() => window.__toasts.slice());
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.sync.v1')));
  const E = 'me@example.test';
  const seedCfg = (extra = {}) => ({ email: E, session: validSession(), ...extra });

  // C1
  await setup(); await start(seedCfg()); await sleep(3000);
  check(gets().length === 1, 'C1: exactly one records GET, got ' + gets().length + ' ' + JSON.stringify(reqs.map(r => r.method + ' ' + r.url.slice(HOST.length))));
  check(gets()[0] && gets()[0].auth === 'Bearer acc_seed', 'C1: Authorization Bearer acc_seed, got ' + (gets()[0] && gets()[0].auth));
  check(other.length === 0, 'C1: no requests to other hosts: ' + other.join(' '));
  await openSettings();
  check((await msg()).startsWith('Last synced just now'), 'C1: syncMsg starts "Last synced just now", got "' + await msg() + '"');
  check(await page.locator('#syncAuto').isChecked(), 'C1: #syncAuto checked');
  console.log('screenshot C1: ' + await screenshot('sync-on-launch-C1'));

  // C2
  await setup(); await start(seedCfg({ auto: false })); await sleep(4000);
  check(reqs.length === 0, 'C2: zero Supabase requests, got ' + reqs.length);
  await openSettings();
  check(!(await page.locator('#syncAuto').isChecked()), 'C2: #syncAuto unchecked');
  await page.click('[data-act="sync"]'); await sleep(1000);
  check(gets().length === 1, 'C2: one records GET after Sync now, got ' + gets().length);
  check((await msg()).startsWith('Last synced just now'), 'C2: syncMsg "Last synced just now", got "' + await msg() + '"');

  // C3
  await setup(); await start({ email: E, session: { access_token: 'acc_seed', refresh_token: 'ref_seed', expires_at: 1 } }); await sleep(3000);
  check(reqs.length >= 2 && reqs[0].method === 'POST' && reqs[0].url.includes('/auth/v1/token?grant_type=refresh_token'), 'C3: first request is refresh POST: ' + JSON.stringify(reqs.map(r => r.method + ' ' + r.url.slice(HOST.length))));
  check(gets().length === 1 && gets()[0].auth === 'Bearer acc_new', 'C3: records GET with Bearer acc_new: ' + JSON.stringify(gets()));
  check(((await stored()).session || {}).refresh_token === 'ref_new', 'C3: stored refresh_token ref_new');
  await openSettings();
  check((await msg()).startsWith('Last synced'), 'C3: syncMsg starts "Last synced", got "' + await msg() + '"');

  // C4
  await setup({ refreshFn: () => [400, { error_description: 'Invalid Refresh Token' }] });
  await start({ email: E, session: { access_token: 'acc_seed', refresh_token: 'ref_seed', expires_at: 1 } }); await sleep(3000);
  check(gets().length === 0, 'C4: no records GET, got ' + gets().length);
  const t4 = await toasts();
  check(t4.includes('Sync failed: Signed out — please sign in again'), 'C4: toast text, toasts seen: ' + JSON.stringify(t4));
  check(((await stored()).session) === null, 'C4: stored session null, got ' + JSON.stringify((await stored()).session));
  await openSettings();
  check(await page.locator('#syncEmail').isVisible() && await page.locator('#syncPass').isVisible(), 'C4: sign-in form visible');
  check((await msg()).includes('Signed out — please sign in again'), 'C4: syncMsg contains signed-out text, got "' + await msg() + '"');
  console.log('screenshot C4: ' + await screenshot('sync-on-launch-C4'));

  // C5
  await setup({ recordsFn: () => [500, { message: 'boom' }] }); await start(seedCfg()); await sleep(3000);
  const t5 = await toasts();
  check(t5.includes('Sync failed: boom (HTTP 500)'), 'C5: toast, toasts seen: ' + JSON.stringify(t5));
  await openSettings();
  check((await msg()) === 'Last sync failed — boom (HTTP 500)', 'C5: syncMsg, got "' + await msg() + '"');
  check(await page.locator('[data-act="sync"]').isEnabled(), 'C5: Sync now enabled');
  console.log('screenshot C5: ' + await screenshot('sync-on-launch-C5'));

  // C6
  await setup(); await start({ email: E }); await sleep(3000);
  check(reqs.length === 0, 'C6: zero Supabase requests, got ' + reqs.length);
  check(!(await toasts()).some(t => /Sync failed/.test(t)), 'C6: no Sync failed toast: ' + JSON.stringify(await toasts()));
  await openSettings();
  check(await page.locator('#syncEmail').isVisible() && await page.locator('#syncPass').isVisible(), 'C6: sign-in form visible');

  // C7
  await setup(); await start(seedCfg()); await sleep(300);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(4000);
  check(gets().length === 1, 'C7: exactly one records GET, got ' + gets().length);

  // C8
  await setup({ recordsFn: n => n === 1 ? [500, { message: 'boom' }] : [200, []] }); await start(seedCfg()); await sleep(3000);
  check((await toasts()).filter(t => /Sync failed/.test(t)).length === 1, 'C8: one Sync failed toast first, toasts: ' + JSON.stringify(await toasts()));
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(3000);
  check(gets().length === 2, 'C8: second records GET, got ' + gets().length);
  await openSettings();
  check((await msg()).startsWith('Last synced just now'), 'C8: syncMsg "Last synced just now", got "' + await msg() + '"');
  check((await toasts()).filter(t => /Sync failed/.test(t)).length === 1, 'C8: no second Sync failed toast, toasts: ' + JSON.stringify(await toasts()));

  // C9
  await setup(); await start(seedCfg()); await sleep(3000);
  check(gets().length === 1, 'C9: first load one GET, got ' + gets().length);
  await page.reload(); await page.waitForSelector('.tabs'); await sleep(3000);
  check(gets().length === 2, 'C9: two GETs over two loads, got ' + gets().length);

  // C10
  const bad = consoleErrors.filter(c => !/status of (400|500)/.test(c));
  check(pageErrors.length === 0, 'C10: no page errors: ' + pageErrors.join(' | '));
  check(bad.length === 0, 'C10: no console errors besides stubbed 400/500: ' + bad.join(' | '));
  console.log('C10 info: expected console errors seen: ' + JSON.stringify(consoleErrors));
};
