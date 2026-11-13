// Sync the USDA key (docs/specs/sync-usda-key.md intent, rewritten for the collapsed key area of
// docs/specs/usda-key-safeguards.md: the key and the switch change only through Edit then Save).
const pad = n => String(n).padStart(2, '0');
const TODAY = (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());
const LEGIT = 'abcdefghijklmnopqrstuvwxyz0123456789f3a9';

const seed = (extra = {}) => ({
  schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: {}, ...extra,
});
const withEntry = extra => seed({ days: { [TODAY]: [
  { id: 'e1', meal: 'Breakfast', name: 'Test oats', brand: '', source: 'Custom', per100: { k: 370, p: 13, c: 60, f: 7 }, servingG: 0, servingLabel: '', grams: 50, unitKey: 'w:g', amount: 50, disp: '', updatedAt: 1000 }] }, ...extra });

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), s);
    await page.reload();
    await page.waitForSelector('.tabs');
  };
  const openSettings = async () => { await page.click('[data-tab="more"]'); await page.click('#moreSettings'); await page.waitForSelector('#keyEdit', { state: 'visible' }); };
  const edit = async () => { await page.click('#keyEdit'); await page.waitForSelector('#apiKey', { state: 'visible' }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const toast = async () => { const l = page.locator('#toast'); return (await l.isVisible()) ? (await l.textContent()).trim() : ''; };
  const near = t => Math.abs(t - Date.now()) < 60000;
  const saveKey = async v => { await edit(); await page.fill('#apiKey', v); await page.click('#keySave'); };
  const records = () => page.evaluate(async () => {
    const m = await import('/js/domain/sync-records.js');
    return m.toRecords(JSON.parse(localStorage.getItem('macrodiary.v1')));
  });
  // find the settings record whatever the exact record envelope is
  const settingsValue = recs => {
    const arr = Array.isArray(recs) ? recs : Object.values(recs);
    const r = arr.find(x => JSON.stringify(x).includes('syncApiKey'));
    return r && (r.value || r.data || r);
  };
  let st;

  // switch is only visible in the editor
  await start(seed()); await openSettings();
  check(!(await page.locator('#syncApiKey').isVisible()), 'S1: switch hidden while collapsed');
  await edit();
  check(await page.locator('#syncApiKey').isVisible() && !(await page.locator('#syncApiKey').isChecked()), 'S1: switch visible and off after Edit');
  check((await page.locator('label[for="syncApiKey"]').textContent()).trim() === 'Sync my USDA key to my other devices', 'S1: label text');
  check(await page.getByText('The key is stored in your sync account, readable only by you.', { exact: true }).isVisible(), 'S1: sentence visible');
  check(await page.locator('.card', { has: page.locator('h2', { hasText: 'Food databases' }) }).locator('#syncApiKey, #apiKey').count() === 2, 'S1: both in Food databases card');
  const lay = await page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const cb = r(document.getElementById('syncApiKey')), lb = r(document.querySelector('label[for="syncApiKey"]'));
    const sent = [...document.querySelectorAll('#v-settings p.muted')].find(p => /sync account/.test(p.textContent));
    const sr = r(sent), card = r(sent.closest('.card')), ak = r(document.getElementById('apiKey'));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { vw: innerWidth, overlapCbLabel: hit(cb, lb), overlapLabelSent: hit(lb, sr), overlapKeySwitch: hit(ak, cb) || hit(ak, lb),
      sentOutsideCard: sr.right > card.right + 1 || sr.left < card.left - 1, hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  console.log('LAYOUT ' + JSON.stringify(lay));
  console.log('screenshot editor: ' + await screenshot('sync-usda-key-editor'));
  check(!lay.overlapCbLabel && !lay.overlapLabelSent && !lay.overlapKeySwitch && !lay.sentOutsideCard && !lay.hScroll, 'S1: layout no overlap, inside card, no horizontal scroll');

  // switch on via Save
  await start(seed({ apiKey: LEGIT })); await openSettings();
  await edit(); await page.click('#syncApiKey'); await page.click('#keySave');
  st = await stored();
  check(await toast() === 'Saved' && st.syncApiKey === true && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000, 'S2: switch on stored, ts now: ' + JSON.stringify([st.syncApiKey, st.settingsUpdatedAt]));
  await page.reload(); await openSettings(); await edit();
  check(await page.locator('#syncApiKey').isChecked(), 'S2: checked after reload');

  // key save, switch off: trimmed, no bump
  await start(seed()); await openSettings();
  await saveKey('  abc123KEY  ');
  st = await stored();
  check(st.apiKey === 'abc123KEY' && !st.syncApiKey && st.settingsUpdatedAt === 1000, 'S3: trimmed, flag off, ts 1000: ' + JSON.stringify([st.apiKey, st.syncApiKey, st.settingsUpdatedAt]));

  // key change with switch on bumps
  await start(seed({ syncApiKey: true, apiKey: 'old' })); await openSettings();
  await saveKey('newKEY');
  st = await stored();
  check(st.apiKey === 'newKEY' && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000 && st.syncApiKey === true, 'S4: key changed, ts bumped: ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt]));

  // switch off keeps the key
  await start(seed({ syncApiKey: true, apiKey: 'keepME' })); await openSettings();
  await edit(); await page.click('#syncApiKey'); await page.click('#keySave');
  st = await stored();
  check(st.syncApiKey === false && st.apiKey === 'keepME' && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000, 'S5: off, key kept, ts bumped: ' + JSON.stringify([st.syncApiKey, st.apiKey, st.settingsUpdatedAt]));

  // key in the sync record
  await start(seed({ syncApiKey: true, apiKey: LEGIT }));
  let recs = await records(); let sv = settingsValue(recs);
  check(sv && sv.apiKey === LEGIT && sv.syncApiKey === true, 'S6: switch on + real key: record carries apiKey: ' + JSON.stringify(sv));
  await start(seed({ syncApiKey: false, apiKey: LEGIT }));
  recs = await records(); sv = settingsValue(recs);
  check(sv && !('apiKey' in sv) && sv.syncApiKey === false && !JSON.stringify(recs).includes(LEGIT), 'S7: switch off: no apiKey anywhere in records');
  await start(seed({ syncApiKey: true, apiKey: 'DEMO_KEY' }));
  sv = settingsValue(await records());
  check(sv && !('apiKey' in sv), 'S8: switch on + demo key: no apiKey in record');
  await start(seed({ syncApiKey: true, apiKey: '' }));
  sv = settingsValue(await records());
  check(sv && !('apiKey' in sv), 'S8: switch on + empty key: no apiKey in record');

  // hostile text through Save
  const evil = '<img src=x onerror=window.__x=1>';
  await start(seed()); await openSettings();
  await saveKey(evil);
  await page.reload(); await openSettings(); await edit();
  check(await page.inputValue('#apiKey') === evil && await page.evaluate(() => window.__x) === undefined && await page.locator('#v-settings img').count() === 0, 'S9: hostile key literal, no img, no script');

  // exports and backup file (download intercepted: same bytes, no file written)
  const grab = async click => {
    await page.evaluate(() => {
      window.__dl = null;
      if (!window.__blobs) {
        window.__blobs = new Map();
        const mk = URL.createObjectURL.bind(URL);
        URL.createObjectURL = b => { const u = mk(b); window.__blobs.set(u, b); return u; };
        HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = window.__blobs.get(this.href); window.__dl = b.text().then(t => ({ name: this.download, text: t })); } };
      }
    });
    await click();
    await page.waitForFunction(() => window.__dl !== null, null, { timeout: 5000 });
    return await page.evaluate(() => window.__dl);
  };
  await start(withEntry({ apiKey: 'SECRETKEY999', syncApiKey: true }));
  await page.click('[data-tab="more"]'); await page.click('#moreExport');
  await page.waitForSelector('#xEntries', { state: 'visible' });
  const seen = [];
  for (const id of ['#xEntries', '#xSummary', '#xJson']) seen.push(await grab(() => page.click(id)));
  check(seen.length === 3 && seen.every(f => !/SECRETKEY999|apiKey|syncApiKey/.test(f.text)), 'S10: three report exports contain no key/apiKey/syncApiKey');
  await page.click('[data-more]'); await openSettings();
  const bk = await grab(() => page.click('#bkExport'));
  console.log('S11 REPORT (' + bk.name + '): "syncApiKey":true = ' + /"syncApiKey":\s*true/.test(bk.text) + '; contains SECRETKEY999 = ' + bk.text.includes('SECRETKEY999'));
  check(/"syncApiKey":\s*true/.test(bk.text) && bk.text.includes('SECRETKEY999'), 'S11: backup file contains the key and the switch (documented current behaviour)');
  await page.goto(url + '/index.html'); await page.waitForSelector('.tabs');

  check(errs.length === 0, 'S12: no page or console errors: ' + errs.join(' | '));
};
