// Sync the USDA key (docs/specs/sync-usda-key.md, checklist C1..C11).
const pad = n => String(n).padStart(2, '0');
const TODAY = (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());

const seed = (extra = {}) => ({
  schemaVersion: 6, theme: 'auto', weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: false,
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
  const openSettings = async () => { await page.click('[data-tab="more"]'); await page.click('#moreSettings'); await page.waitForSelector('#syncApiKey', { state: 'visible' }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const toast = async () => (await page.locator('#toast').textContent()).trim();
  const near = t => Math.abs(t - Date.now()) < 60000;
  const typeKey = async v => { await page.fill('#apiKey', v); await page.press('#apiKey', 'Tab'); };

  // C1
  await start(seed()); await openSettings();
  check(await page.locator('#syncApiKey').isVisible(), 'C1: #syncApiKey visible');
  check(!(await page.locator('#syncApiKey').isChecked()), 'C1: not checked by default');
  check((await page.locator('label[for="syncApiKey"]').textContent()).trim() === 'Sync my USDA key to my other devices', 'C1: label text');
  check(await page.getByText('The key is stored in your sync account, readable only by you.', { exact: true }).isVisible(), 'C1: sentence visible');
  check(await page.locator('.card', { has: page.locator('h2', { hasText: 'Food databases' }) }).locator('#syncApiKey, #apiKey').count() === 2, 'C1: switch in Food databases card with #apiKey');
  let st = await stored();
  console.log('C1 info: stored schemaVersion=' + st.schemaVersion + ' syncApiKey=' + JSON.stringify(st.syncApiKey) + ' (not required before a save)');
  console.log('screenshot settings card: ' + await screenshot('sync-usda-key-settings'));
  const lay = await page.evaluate(() => {
    const r = el => el.getBoundingClientRect();
    const cb = r(document.getElementById('syncApiKey')), lb = r(document.querySelector('label[for="syncApiKey"]'));
    const sent = [...document.querySelectorAll('#v-settings p.muted')].find(p => /sync account/.test(p.textContent));
    const sr = r(sent), card = r(sent.closest('.card')), ak = r(document.getElementById('apiKey'));
    const lh = parseFloat(getComputedStyle(sent).lineHeight) || 20;
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { vw: innerWidth, labelLines: Math.round(lb.height / (parseFloat(getComputedStyle(document.querySelector('label[for="syncApiKey"]')).lineHeight) || 20)), labelH: lb.height, sentH: sr.height, sentLines: Math.round(sr.height / lh),
      overlapCbLabel: hit(cb, lb), overlapLabelSent: hit(lb, sr), overlapKeySwitch: hit(ak, cb) || hit(ak, lb), sentOutsideCard: sr.right > card.right + 1 || sr.left < card.left - 1, hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  console.log('LAYOUT ' + JSON.stringify(lay));
  check(!lay.overlapCbLabel && !lay.overlapLabelSent && !lay.overlapKeySwitch && !lay.sentOutsideCard && !lay.hScroll, 'layout: no overlap, nothing outside card, no horizontal scroll');

  // C2
  await start(seed()); await openSettings();
  await page.click('#syncApiKey');
  check(await toast() === 'Saved', 'C2: toast Saved, got ' + await toast());
  st = await stored();
  check(st.syncApiKey === true && st.settingsUpdatedAt > 1000 && near(st.settingsUpdatedAt), 'C2: stored syncApiKey true, settingsUpdatedAt now: ' + st.syncApiKey + ' ' + st.settingsUpdatedAt);
  await page.reload(); await openSettings();
  check(await page.locator('#syncApiKey').isChecked(), 'C2: checked after reload');

  // C3
  await start(seed()); await openSettings();
  await typeKey('  abc123KEY  ');
  check(await toast() === 'Saved', 'C3: toast Saved, got ' + await toast());
  st = await stored();
  check(st.apiKey === 'abc123KEY' && !st.syncApiKey && st.settingsUpdatedAt === 1000, 'C3: apiKey trimmed, flag off, settingsUpdatedAt 1000: ' + JSON.stringify([st.apiKey, st.syncApiKey, st.settingsUpdatedAt]));

  // C4
  await start(seed({ syncApiKey: true, apiKey: 'old' })); await openSettings();
  await typeKey('newKEY');
  st = await stored();
  check(st.apiKey === 'newKEY' && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000, 'C4: apiKey newKEY, timestamp bumped: ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt]));
  check(await page.locator('#syncApiKey').isChecked(), 'C4: switch still checked');

  // C5
  await start(seed({ syncApiKey: true, apiKey: 'old' })); await openSettings();
  await typeKey('');
  st = await stored();
  check(st.apiKey === '' && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000, 'C5: apiKey empty, timestamp bumped: ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt]));

  // C6
  await start(seed({ syncApiKey: true, apiKey: 'keepME' })); await openSettings();
  await page.click('#syncApiKey');
  st = await stored();
  check(st.syncApiKey === false && st.apiKey === 'keepME' && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000, 'C6: stored flag false, key kept, timestamp bumped: ' + JSON.stringify([st.syncApiKey, st.apiKey, st.settingsUpdatedAt]));
  await page.reload(); await openSettings();
  check(!(await page.locator('#syncApiKey').isChecked()) && (await page.inputValue('#apiKey')) === 'keepME', 'C6: after reload unchecked, key keepME');

  // C7
  await start(seed({ syncApiKey: true, apiKey: 'loadedKEY' })); await openSettings();
  check(await page.locator('#syncApiKey').isChecked() && (await page.inputValue('#apiKey')) === 'loadedKEY', 'C7: checked and key loadedKEY');

  // C8
  const evil = '<img src=x onerror=window.__x=1>';
  await start(seed()); await openSettings();
  await typeKey(evil);
  await page.reload(); await openSettings();
  check((await page.inputValue('#apiKey')) === evil, 'C8: #apiKey value is the literal text');
  check(await page.evaluate(() => window.__x) === undefined, 'C8: window.__x undefined');
  check(await page.locator('#v-settings img').count() === 0, 'C8: no img in Settings');

  // C9 / C10
  // The harness cannot close cleanly after a real browser download, so the page's download() is intercepted:
  // the anchor click is swallowed and the Blob text it would have saved is read instead (same bytes, no file written).
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
  check(seen.length === 3, 'C9: three export files captured: ' + JSON.stringify(seen.map(f => f.name)));
  check(seen.every(f => !/SECRETKEY999|apiKey|syncApiKey/.test(f.text)), 'C9: no export file contains the key, apiKey or syncApiKey');

  await page.click('[data-more]'); await openSettings();
  const bk = await grab(() => page.click('#bkExport'));
  console.log('C10 REPORT (' + bk.name + '): contains "syncApiKey":true = ' + /"syncApiKey":\s*true/.test(bk.text) + '; contains SECRETKEY999 = ' + bk.text.includes('SECRETKEY999'));

  await page.goto(url + '/index.html'); await page.waitForSelector('.tabs');   // settle after downloads so closing the context is clean

  // C11
  check(errs.length === 0, 'C11: no page or console errors: ' + errs.join(' | '));
};
