// Copy diary entries to another meal / day (docs/specs/copy-to-meal.md, checklist C1..C13). Seeds the state S described there.
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = shift(0), YEST = shift(-1), TOM = shift(1);

const ent = (id, meal, name, brand, grams, per100) => ({ id, meal, name, brand, source: '', per100, servingG: 0, servingLabel: '', grams, unitKey: 'w:g', amount: grams, disp: '' });
const seed = (e1name = 'Test Oats') => ({
  schemaVersion: 6, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [
    ent('e1', 'Breakfast', e1name, 'Acme', 40, { k: 370, p: 13, c: 60, f: 7 }),
    ent('e2', 'Lunch', 'Test Rice', '', 150, { k: 130, p: 2.7, c: 28, f: 0.3 }),
    ent('e3', 'Lunch', 'Test Chicken', '', 100, { k: 165, p: 31, c: 0, f: 3.6 }) ] },
});

export default async ({ page, url, check, screenshot }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const start = async (e1name) => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed(e1name));
    await page.reload();
    await page.waitForSelector('#meals .entry');
  };
  const card = m => page.locator('#meals .card').filter({ has: page.locator('h2', { hasText: new RegExp('^' + m + '$') }) });
  const rows = (m, name) => card(m).locator('.entry').filter({ hasText: name });
  const total = async () => (await page.locator('#summary .big').first().textContent()).trim();
  const toastText = async () => (await page.locator('#toast').textContent()).trim();
  const dlgOpen = () => page.evaluate(() => document.getElementById('dlg').open);
  const nRows = () => page.locator('#meals .entry').count();
  const copyRow = name => page.locator('#meals .entry').filter({ hasText: name }).first().locator('[data-copy]').click();
  const go = () => page.click('#copyGo');
  const kcal = async (m, name, i = 0) => (await rows(m, name).nth(i).locator('.k').textContent()).trim();

  // C1
  await start();
  await copyRow('Test Oats');
  await page.selectOption('#copyMeal', 'Dinner'); await go();
  check(!(await dlgOpen()), 'C1: dialog closed');
  check((await toastText()) === 'Copied 1 item to Dinner', 'C1: toast "Copied 1 item to Dinner", got ' + await toastText());
  check(await rows('Dinner', 'Test Oats').count() === 1 && await kcal('Dinner', 'Test Oats') === '148', 'C1: Dinner lists Test Oats 148');
  check(await rows('Breakfast', 'Test Oats').count() === 1, 'C1: Breakfast still lists Test Oats');
  check((await total()) === '656', 'C1: day total 656, got ' + await total());
  check(!(await dlgOpen()), 'C1: edit dialog did not open');

  // C7 (after C1)
  await rows('Dinner', 'Test Oats').locator('.nm').click();
  check((await page.locator('#dTitle').textContent()) === 'Edit entry', 'C7: edit dialog opened');
  await page.fill('#amt', '80'); await page.click('#addGo');
  check(await kcal('Dinner', 'Test Oats') === '296', 'C7: Dinner Test Oats 296, got ' + await kcal('Dinner', 'Test Oats'));
  check(await kcal('Breakfast', 'Test Oats') === '148', 'C7: Breakfast Test Oats still 148');

  // C2
  await start();
  await copyRow('Test Rice');
  check((await page.locator('#dTitle').textContent()) === 'Copy to', 'C2: title "Copy to"');
  check((await page.inputValue('#copyMeal')) === 'Lunch', 'C2: meal preselected Lunch');
  const opts = await page.locator('#copyMeal option').allTextContents();
  check(JSON.stringify(opts) === '["Breakfast","Lunch","Dinner","Snacks"]', 'C2: options ' + opts);
  check((await page.inputValue('#copyDate')) === TODAY, 'C2: date is today ' + TODAY);
  check((await page.locator('#copyGo').textContent()).trim() === 'Copy', 'C2: Copy button');

  // C12 cancel
  await start();
  await copyRow('Test Oats'); await page.click('#dClose');
  check(!(await dlgOpen()), 'C12: dialog closed');
  check(!(await page.locator('#toast').evaluate(e => /Copied/.test(e.textContent) && getComputedStyle(e).opacity !== '0')), 'C12: no toast');
  check(await nRows() === 3, 'C12: still 3 rows');

  // C3 + C8
  await start();
  await copyRow('Test Rice'); await go();
  check((await toastText()) === 'Copied 1 item to Lunch', 'C3: toast, got ' + await toastText());
  check(await rows('Lunch', 'Test Rice').count() === 2 && await kcal('Lunch', 'Test Rice', 0) === '195' && await kcal('Lunch', 'Test Rice', 1) === '195', 'C3: Lunch lists Test Rice twice at 195');
  check(/555/.test(await card('Lunch').locator('.meal-h .muted').textContent()), 'C3: Lunch header 555 kcal');
  await rows('Lunch', 'Test Rice').first().locator('[data-del]').click();
  check(await rows('Lunch', 'Test Rice').count() === 1 && await kcal('Lunch', 'Test Rice') === '195' && await rows('Lunch', 'Test Chicken').count() === 1, 'C8: Rice once (195) and Chicken after deleting one');

  // C4
  await start();
  await copyRow('Test Chicken'); await page.fill('#copyDate', YEST); await page.selectOption('#copyMeal', 'Snacks'); await go();
  check(/Copied 1 item to Snacks/.test(await toastText()), 'C4: toast, got ' + await toastText());
  check(await rows('Lunch', 'Test Chicken').count() === 1 && await page.locator('#meals .entry').filter({ hasText: 'Test Chicken' }).count() === 1, 'C4: today unchanged, Chicken once');
  check((await page.locator('#dateLbl').textContent()) === 'Today', 'C4: still viewing Today');
  await page.click('#prev');
  check(await nRows() === 1 && await rows('Snacks', 'Test Chicken').count() === 1 && await kcal('Snacks', 'Test Chicken') === '165', 'C4: yesterday has only Chicken under Snacks, 165');

  // C5
  await start();
  await page.click('[data-copy-meal="Lunch"]'); await page.selectOption('#copyMeal', 'Dinner'); await go();
  check((await toastText()) === 'Copied 2 items to Dinner', 'C5: toast, got ' + await toastText());
  check(await kcal('Dinner', 'Test Rice') === '195' && await kcal('Dinner', 'Test Chicken') === '165', 'C5: Dinner has Rice 195 and Chicken 165');
  check(await rows('Lunch', 'Test Rice').count() === 1 && await rows('Lunch', 'Test Chicken').count() === 1 && await rows('Breakfast', 'Test Oats').count() === 1 && await nRows() === 5, "C5: Lunch and Breakfast untouched (5 rows)");

  // C6
  await start();
  await page.click('[data-copy-meal="Lunch"]');
  check((await page.inputValue('#copyMeal')) === 'Lunch', 'C6: meal preselected Lunch');
  await page.fill('#copyDate', TOM); await go();
  check((await toastText()) === 'Copied 2 items to Lunch', 'C6: toast, got ' + await toastText());
  check((await page.locator('#dateLbl').textContent()) === 'Today' && await nRows() === 3, 'C6: still viewing today until #next');
  await page.click('#next');
  check(await rows('Lunch', 'Test Rice').count() === 1 && await rows('Lunch', 'Test Chicken').count() === 1 && await nRows() === 2, 'C6: tomorrow shows Lunch with both items');

  // C9
  await start();
  await copyRow('Test Oats'); await page.selectOption('#copyMeal', 'Dinner'); await go();
  const t0 = Date.now();
  await page.reload(); await page.waitForSelector('#meals .entry');
  check(await rows('Dinner', 'Test Oats').count() === 1 && await rows('Breakfast', 'Test Oats').count() === 1, 'C9: after reload Oats in Dinner and Breakfast');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const list = st.days[TODAY], ids = new Set(list.map(e => e.id)), cp = list.find(e => e.meal === 'Dinner');
  check(list.length === 4 && ids.size === 4, 'C9: 4 entries, 4 distinct ids');
  check(cp && Math.abs(cp.updatedAt - t0) < 60000, 'C9: copy has meal Dinner and updatedAt near now');
  check(JSON.stringify(st.tombstones) === '{}', 'C9: tombstones empty');

  // C10
  const evil = '<img src=x onerror=window.__x=1>';
  await start(evil);
  await copyRow('Acme'); await page.selectOption('#copyMeal', 'Snacks'); await go();
  check((await card('Snacks').locator('.entry .nm > div').first().textContent()) === evil, 'C10: Snacks row shows literal text');
  check(await page.evaluate(() => window.__x) === undefined, 'C10: window.__x undefined');
  check(await page.locator('#meals img').count() === 0, 'C10: no img element injected');

  // C11
  await start();
  await page.click('[data-add="Breakfast"]');
  check(await dlgOpen() && (await page.locator('#dTitle').textContent()) !== 'Copy to', 'C11: + Add opens add dialog');
  check(!/Copied/.test(await toastText()), 'C11: no Copied toast after + Add');
  await page.click('#dClose');
  check(!(await dlgOpen()), 'C11: dialog closed by x');
  await rows('Lunch', 'Test Rice').locator('.nm').click();
  check((await page.locator('#dTitle').textContent()) === 'Edit entry' && (await page.locator('#dBody h2').first().textContent()) === 'Test Rice', 'C11: row click opens edit for Test Rice');
  check(!/Copied/.test(await toastText()), 'C11: no Copied toast after row click');

  // C13
  await start();
  await copyRow('Test Oats'); await page.fill('#copyDate', ''); await go();
  check(await nRows() === 3, 'C13: still 3 rows');
  console.log('C13 observed: dialog open=' + await dlgOpen() + ', toast="' + await toastText() + '"');

  // Layout evidence; review fix: no Copy meal on an empty meal
  await start();
  check(await card('Snacks').locator('[data-copy-meal]').count() === 0 && await card('Dinner').locator('[data-copy-meal]').count() === 0, 'Copy meal hidden on empty meals');
  const m = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const out = { vw: innerWidth, docScrollW: document.documentElement.scrollWidth, entries: [], heads: [] };
    document.querySelectorAll('#meals .entry').forEach(e => {
      const nm = r(e.querySelector('.nm')), k = r(e.querySelector('.k')), cp = r(e.querySelector('[data-copy]')), x = r(e.querySelector('[data-del]')), row = r(e);
      out.entries.push({ name: e.querySelector('.nm div').textContent, nmW: nm.r - nm.l, nmH: nm.b - nm.t, cp: [cp.r - cp.l, cp.b - cp.t], x: [x.r - x.l, x.b - x.t],
        overlap: hit(nm, cp) || hit(cp, x) || hit(k, cp) || hit(nm, k) || hit(nm, x), overflowRight: Math.max(cp.r, x.r) > row.r + 1 });
    });
    document.querySelectorAll('#meals .meal-h').forEach(h => {
      const kids = [...h.querySelectorAll('h2, [data-copy-meal], [data-add]')].map(r);
      out.heads.push({ title: h.querySelector('h2').textContent, h: r(h).b - r(h).t, overlap: kids.some((a, i) => kids.some((b, j) => i < j && hit(a, b))), btnTops: kids.map(a => a.t) });
    });
    return out;
  });
  console.log('LAYOUT ' + JSON.stringify(m));
  check(m.entries.every(e => !e.overlap) && m.heads.every(h => !h.overlap), 'layout: no overlap between name, kcal, Copy, delete, or in meal headers');
  check(m.docScrollW <= m.vw, 'layout: no horizontal page scroll');
  console.log('screenshot: ' + await screenshot('copy-to-meal-diary'));
  check(errs.length === 0, 'no page errors: ' + errs);
};
