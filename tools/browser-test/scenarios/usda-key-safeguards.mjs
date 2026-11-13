// USDA key safeguards (docs/specs/usda-key-safeguards.md, checklist C1..C15).
const LEGIT = 'abcdefghijklmnopqrstuvwxyz0123456789f3a9';
const seed = (extra = {}) => ({
  schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 },
  apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false, recent: [], custom: [], tombstones: {},
  settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days: {}, ...extra,
});

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
  const openSettings = async () => { await page.click('[data-tab="more"]'); await page.click('#moreSettings'); await page.waitForSelector('#keyLine', { state: 'visible' }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const toast = async () => { const l = page.locator('#toast'); return (await l.isVisible()) ? (await l.textContent()).trim() : ''; };
  const near = t => Math.abs(t - Date.now()) < 60000;
  const line = async () => (await page.locator('#keyLine').textContent()).trim();
  const vis = sel => page.locator(sel).isVisible();
  const active = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const aria = () => page.getAttribute('#keyEdit', 'aria-expanded');
  const edit = async () => { await page.click('#keyEdit'); await page.waitForSelector('#keyEditor', { state: 'visible' }); };
  const bodyText = () => page.evaluate(() => document.body.innerText);
  let st;

  // C1
  await start(seed({ apiKey: LEGIT })); await openSettings();
  check(await line() === 'USDA key: set (ends …f3a9)', 'C1: line: ' + await line());
  check(await vis('#keyEdit') && (await page.locator('#keyEdit').textContent()).trim() === 'Edit' && await aria() === 'false', 'C1: Edit visible, text Edit, aria-expanded false');
  check(!(await vis('#apiKey')) && !(await vis('#syncApiKey')) && !(await vis('#keySave')) && !(await vis('#keyCancel')), 'C1: editor controls hidden');
  const bt = await bodyText();
  check(!bt.includes(LEGIT) && !bt.includes('ghijklmnopqrstuvwxyz'), 'C1: key not in visible page text');

  // C2
  await start(seed()); await openSettings();
  check(await line() === 'USDA key: not set' && !(await vis('#keyEditor')), 'C2: not set line, editor hidden: ' + await line());
  // C3
  await start(seed({ apiKey: 'demo_key' })); await openSettings();
  check(await line() === 'USDA key: using the shared demo key', 'C3: ' + await line());
  // C4
  await start(seed({ apiKey: 'abc123' })); await openSettings();
  check(await line() === 'USDA key: set' && !(await bodyText()).includes('abc123'), 'C4: ' + await line());

  // C5
  await start(seed({ apiKey: LEGIT, syncApiKey: true })); await openSettings();
  await page.click('#keyEdit');
  check(await vis('#keyEditor'), 'C5: editor visible');
  check(await page.inputValue('#apiKey') === LEGIT && await page.locator('#syncApiKey').isChecked(), 'C5: key loaded, switch checked');
  check((await page.locator('label[for="syncApiKey"]').textContent()).trim() === 'Sync my USDA key to my other devices' && await vis('label[for="syncApiKey"]'), 'C5: label visible');
  check(await page.getByText('The key is stored in your sync account, readable only by you.', { exact: true }).isVisible(), 'C5: sentence visible');
  check(await vis('#keySave') && (await page.locator('#keySave').textContent()).trim() === 'Save' && await vis('#keyCancel') && (await page.locator('#keyCancel').textContent()).trim() === 'Cancel', 'C5: Save and Cancel visible');
  check(!(await vis('#keyEdit')) && await aria() === 'true', 'C5: Edit hidden, aria-expanded true');
  check(await active() === 'apiKey', 'C5: focus on apiKey, got ' + await active());
  console.log('screenshot editor open: ' + await screenshot('usda-key-editor-open'));

  // C6
  await start(seed({ apiKey: LEGIT })); await openSettings();
  await edit(); await page.fill('#apiKey', 'zzzzzzzzzzzzzzzzzzzzzzzz'); await page.press('#apiKey', 'Tab'); await page.click('#keyCancel');
  st = await stored();
  check(!(await vis('#keyEditor')) && await line() === 'USDA key: set (ends …f3a9)', 'C6: collapsed, line unchanged');
  check(st.apiKey === LEGIT && st.settingsUpdatedAt === 1000, 'C6: stored unchanged ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt]));
  check(await toast() !== 'Saved', 'C6: toast not Saved, got "' + await toast() + '"');
  check(await active() === 'keyEdit' && await aria() === 'false', 'C6: focus keyEdit, aria false, active=' + await active());
  await edit();
  check(await page.inputValue('#apiKey') === LEGIT, 'C6: typed text discarded');

  // C7
  await start(seed({ apiKey: LEGIT })); await openSettings();
  await edit(); await page.fill('#apiKey', '  NEWKEYabcdefghij1234567890WXYZ  '); await page.click('#keySave');
  st = await stored();
  check(await toast() === 'Saved', 'C7: toast Saved, got "' + await toast() + '"');
  check(st.apiKey === 'NEWKEYabcdefghij1234567890WXYZ' && st.settingsUpdatedAt === 1000, 'C7: stored ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt]));
  check(await line() === 'USDA key: set (ends …WXYZ)' && !(await vis('#keyEditor')) && await active() === 'keyEdit' && await aria() === 'false', 'C7: line/collapse/focus: ' + await line() + ' ' + await active());

  // C8
  await start(seed({ apiKey: LEGIT, syncApiKey: true })); await openSettings();
  await edit(); await page.fill('#apiKey', ''); await page.click('#keySave');
  st = await stored();
  check(st.apiKey === '' && st.settingsUpdatedAt > 1000 && near(st.settingsUpdatedAt) && st.syncApiKey === true, 'C8: stored ' + JSON.stringify([st.apiKey, st.settingsUpdatedAt, st.syncApiKey]));
  check(await line() === 'USDA key: not set', 'C8: line ' + await line());

  // C9
  await start(seed({ apiKey: LEGIT })); await openSettings();
  await page.fill('#gK', '2100'); await page.press('#gK', 'Tab');
  st = await stored();
  check(await toast() === 'Saved' && st.goals.k === 2100 && st.apiKey === LEGIT, 'C9a: ' + JSON.stringify([st.goals.k, st.apiKey, await toast()]));
  await page.reload(); await page.waitForSelector('.tabs'); await openSettings(); await edit();
  await page.fill('#apiKey', 'typedButNotSaved123456'); await page.fill('#gK', '2200'); await page.press('#gK', 'Tab');
  st = await stored();
  check(st.goals.k === 2200 && st.apiKey === LEGIT, 'C9b: stored ' + JSON.stringify([st.goals.k, st.apiKey]));
  check(await page.inputValue('#apiKey') === 'typedButNotSaved123456' && await vis('#keyEditor'), 'C9b: typed text kept, editor still open');

  // C10
  await start(seed({ apiKey: LEGIT })); await openSettings();
  check(!(await vis('#syncApiKey')), 'C10: switch hidden');
  await edit(); await page.click('#syncApiKey'); await page.click('#keyCancel');
  st = await stored();
  check(!st.syncApiKey && st.settingsUpdatedAt === 1000, 'C10: after Cancel ' + JSON.stringify([st.syncApiKey, st.settingsUpdatedAt]));
  await edit(); await page.click('#syncApiKey'); await page.click('#keySave');
  st = await stored();
  check(st.syncApiKey === true && near(st.settingsUpdatedAt) && st.settingsUpdatedAt > 1000 && await toast() === 'Saved' && st.apiKey === LEGIT, 'C10: after Save ' + JSON.stringify([st.syncApiKey, st.settingsUpdatedAt, st.apiKey, await toast()]));
  await page.reload(); await page.waitForSelector('.tabs'); await openSettings(); await edit();
  check(await page.locator('#syncApiKey').isChecked(), 'C10: checked after reload');

  // C11
  await start(seed({ apiKey: LEGIT })); await openSettings();
  await edit(); await page.fill('#apiKey', 'unsavedTextUnsavedText12');
  await page.click('.tabs button >> nth=0');
  await openSettings();
  st = await stored();
  check(!(await vis('#keyEditor')) && await line() === 'USDA key: set (ends …f3a9)' && st.apiKey === LEGIT, 'C11: collapsed, line, stored');
  await edit();
  check(await page.inputValue('#apiKey') === LEGIT, 'C11: input reset to saved');

  // C12
  await start(seed({ apiKey: LEGIT })); await openSettings();
  const info = await page.evaluate(() => { const e = document.getElementById('keyEdit'); return [e.tagName, e.getAttribute('type')]; });
  check(info[0] === 'BUTTON' && info[1] === 'button', 'C12: real button ' + info);
  await page.focus('#keyEdit'); await page.keyboard.press('Enter');
  check(await vis('#keyEditor') && await active() === 'apiKey', 'C12: Enter opens, focus apiKey, got ' + await active());
  await page.focus('#keyCancel'); await page.keyboard.press('Enter');
  check(!(await vis('#keyEditor')) && await active() === 'keyEdit', 'C12: Enter on Cancel closes, focus ' + await active());

  // C13
  await start(seed()); await openSettings();
  await edit(); await page.fill('#apiKey', 'DEMO_KEY'); await page.click('#keySave');
  st = await stored();
  check(st.apiKey === 'DEMO_KEY' && await line() === 'USDA key: using the shared demo key', 'C13: ' + st.apiKey + ' / ' + await line());

  // C14
  const evil = '<img src=x onerror=window.__x=1>';
  await start(seed({ apiKey: evil })); await openSettings();
  check(await line() === 'USDA key: set (ends …x=1>)', 'C14: line ' + await line());
  await edit();
  check(await page.evaluate(() => window.__x) === undefined && await page.locator('#v-settings img').count() === 0, 'C14: no script, no img');
  check(await page.inputValue('#apiKey') === evil, 'C14: input value literal');

  // C15 (current viewport; phone when --device is used)
  await start(seed({ apiKey: LEGIT })); await openSettings();
  const lay = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const a = r('keyLine'), b = r('keyEdit');
    const card = document.getElementById('keyLine').closest('.card').getBoundingClientRect();
    return { vw: innerWidth, hScroll: document.documentElement.scrollWidth > innerWidth,
      overlap: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
      outside: Math.max(a.right, b.right) > card.right + 1 || b.right > innerWidth, lineH: a.height, editH: b.height, editW: b.width };
  });
  console.log('LAYOUT ' + JSON.stringify(lay));
  console.log('screenshot collapsed: ' + await screenshot('usda-key-collapsed'));
  check(!lay.hScroll && !lay.overlap && !lay.outside, 'C15: no horizontal scroll, no overlap, inside card');
  await page.setViewportSize({ width: 375, height: 800 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'C15: no horizontal scroll at 375 wide');
  await page.click('#keyEdit');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'C15: no horizontal scroll at 375 with editor open');
  console.log('screenshot editor 375: ' + await screenshot('usda-key-editor-375'));
  check(errs.length === 0, 'C15: no page or console errors: ' + errs.join(' | '));
};
