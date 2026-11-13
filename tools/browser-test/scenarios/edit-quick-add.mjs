// Edit quick adds (docs/specs/edit-quick-add.md, checklist C1..C17). Seeds the state S described there.
const pad = n => String(n).padStart(2, '0');
const TODAY = (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());
const A = { k: 500, p: 10, c: 60, f: 25 };

const seed = () => ({
  schemaVersion: 6, theme: 'auto', weightUnit: 'g', measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 1000 }] },
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: false,
  recent: [{ name: 'Test Oats', brand: 'Acme', source: 'OFF', per100: { k: 370, p: 13, c: 60, f: 7 }, servingG: 0, servingLabel: '' }],
  custom: [
    { name: 'Cheez-it Duo', brand: '', source: 'Custom', servingG: 30, per100: { ...A }, updatedAt: 1000 },
    { name: 'Homemade chili', brand: '', source: 'Custom', servingG: 250, per100: { k: 100, p: 8, c: 10, f: 3 }, updatedAt: 900 }],
  tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [
    { id: 'e1', meal: 'Breakfast', name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { ...A }, servingG: 0, servingLabel: '', grams: 30, unitKey: 'w:g', amount: 30, disp: '', updatedAt: 1000 },
    { id: 'e2', meal: 'Breakfast', name: 'Quick add', brand: '', source: 'Custom', per100: { k: 200, p: 5, c: 20, f: 10 }, servingG: 0, servingLabel: '', grams: 100, unitKey: 'w:g', amount: 100, disp: '', updatedAt: 1000 }] },
});

export default async ({ page, url, check, screenshot }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const start = async () => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed());
    await page.reload();
    await page.waitForSelector('#meals .entry');
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const toast = async () => (await page.locator('#toast').textContent()).trim();
  const dlgOpen = () => page.evaluate(() => document.getElementById('dlg').open);
  const title = async () => (await page.locator('#dTitle').textContent()).trim();
  const card = m => page.locator('#meals .card').filter({ has: page.locator('h2', { hasText: new RegExp('^' + m + '$') }) });
  const rows = (m, name) => card(m).locator('.entry').filter({ hasText: name });
  const kcal = async (m, name) => (await rows(m, name).first().locator('.k').textContent()).trim();
  const openAdd = async meal => { await page.click(`[data-add="${meal}"]`); };
  const customTab = async () => { await page.locator('#dBody .seg button', { hasText: 'Custom' }).click(); };
  const search = async q => { await page.fill('#q', q); };
  const openEditFood = async (q, meal = 'Breakfast') => { await openAdd(meal); await search(q); await page.locator('[data-edit-food]').first().click(); };
  const near = t => Math.abs(t - Date.now()) < 60000;

  // C1, C2
  for (const [id, val] of [['C1', ''], ['C2', '   ']]) {
    await start(); await openAdd('Lunch'); await customTab();
    await page.fill('#cName', val); await page.fill('#cK', '100'); await page.click('#cGo');
    check(await toast() === 'Enter a name', id + ': toast "Enter a name", got ' + await toast());
    check(await dlgOpen() && await page.locator('#cName').count() === 1 && await page.locator('#addGo').count() === 0, id + ': dialog still on the form, no Amount screen');
    check((await stored()).custom.length === 2, id + ': custom still 2 foods');
  }

  // C3
  await start(); await openAdd('Lunch'); await customTab();
  await page.fill('#cName', '  Peanut   bar  '); await page.fill('#cSize', '40'); await page.fill('#cK', '200'); await page.click('#cGo');
  const h2 = (await page.locator('#dBody h2').first().textContent()).trim();
  check(h2 === 'Peanut bar', 'C3: Amount h2 "Peanut bar", got "' + h2 + '"');
  await page.click('#addGo');
  check(await rows('Lunch', 'Peanut bar').count() === 1 && await kcal('Lunch', 'Peanut bar') === '200', 'C3: Lunch row Peanut bar 200 kcal');
  let st = await stored();
  check(st.custom.length === 3 && st.custom[0].name === 'Peanut bar', 'C3: 3 custom foods, first "Peanut bar", got ' + JSON.stringify(st.custom.map(f => f.name)));

  // C4
  await start(); await openAdd('Lunch'); await customTab();
  check(!/Quick add/.test(await page.locator('#dBody').innerText()), 'C4: no "Quick add" in dialog body');
  check((await page.inputValue('#cName')) === '' && !!(await page.getAttribute('#cName', 'placeholder')), 'C4: #cName empty with placeholder: ' + await page.getAttribute('#cName', 'placeholder'));

  // C5
  await start();
  await rows('Breakfast', 'Quick add').locator('.nm').click();
  check(await title() === 'Edit entry' && await page.inputValue('#eName') === 'Quick add', 'C5: Edit entry with #eName "Quick add"');
  await page.fill('#eName', 'Cheez-it Duo bites'); await page.click('#addGo');
  check(await toast() === 'Updated', 'C5: toast Updated, got ' + await toast());
  check(await rows('Breakfast', 'Cheez-it Duo bites').count() === 1 && await kcal('Breakfast', 'Cheez-it Duo bites') === '200' && await rows('Breakfast', 'Quick add').count() === 0, 'C5: renamed row 200 kcal, no Quick add');
  check(await kcal('Breakfast', 'Cheez-it Duo') === '150' || (await rows('Breakfast', 'Cheez-it Duo').first().locator('.k').textContent()).trim() === '150', 'C5: Cheez-it Duo row 150');
  st = await stored(); let e1 = st.days[TODAY].find(e => e.id === 'e1'), e2 = st.days[TODAY].find(e => e.id === 'e2');
  check(e2.name === 'Cheez-it Duo bites' && e2.grams === 100 && e2.per100.k === 200 && near(e2.updatedAt), 'C5: stored e2 name/grams/per100/updatedAt');
  check(e1.updatedAt === 1000 && JSON.stringify(st.custom.map(f => f.name)) === '["Cheez-it Duo","Homemade chili"]', 'C5: e1 updatedAt 1000, custom unchanged');
  const c5state = st;

  // C6
  await start();
  await rows('Breakfast', 'Quick add').locator('.nm').click();
  await page.fill('#eName', ''); await page.click('#addGo');
  check(await toast() === 'Enter a name' && await dlgOpen(), 'C6: toast "Enter a name", dialog open, got ' + await toast());
  await page.click('#dClose');
  check(await rows('Breakfast', 'Quick add').count() === 1, 'C6: row still Quick add');
  st = await stored(); e2 = st.days[TODAY].find(e => e.id === 'e2');
  check(e2.name === 'Quick add' && e2.updatedAt === 1000, 'C6: stored e2 unchanged');

  // C7
  await start();
  await rows('Breakfast', 'Cheez-it Duo').first().locator('.nm').click();
  await page.fill('#eName', 'Duo snack'); await page.fill('#amt', '60'); await page.click('#addGo');
  check(await rows('Breakfast', 'Duo snack').count() === 1 && await kcal('Breakfast', 'Duo snack') === '300', 'C7: Duo snack 300 kcal');

  // C8
  await start(); await openAdd('Breakfast'); await search('Cheez');
  const res = page.locator('#results .res');
  check(await res.count() === 1 && (await res.locator('.badge').textContent()).trim() === 'My food' && (await res.locator('button', { hasText: /^Edit$/ }).count()) === 1, 'C8: Cheez -> one My food result with Edit');
  await search('Oats');
  check(await res.count() === 1 && (await res.locator('.badge').textContent()).trim() === 'Recent' && await res.locator('button', { hasText: 'Edit' }).count() === 0, 'C8: Oats -> one Recent result, no Edit');

  // C9
  await start(); await openEditFood('Cheez');
  const v = async id => await page.inputValue(id);
  check(await title() === 'Edit food', 'C9: #dTitle Edit food, got ' + await title());
  check(await v('#cName') === 'Cheez-it Duo' && await v('#cSize') === '30' && await v('#cK') === '150' && await v('#cP') === '3' && await v('#cC') === '18' && await v('#cF') === '7.5',
    'C9: prefilled ' + [await v('#cName'), await v('#cSize'), await v('#cK'), await v('#cP'), await v('#cC'), await v('#cF')]);
  check((await page.locator('#cGo').textContent()).trim() === 'Save changes', 'C9: #cGo Save changes');
  check(!(await page.locator('#cSave').isVisible().catch(() => false)), 'C9: no #cSave checkbox visible');
  check((await page.locator('#dBody').innerText()).includes('Past diary entries keep the name and numbers they were logged with.'), 'C9: note shown');
  check(await page.locator('#addGo').count() === 0, 'C9: no #addGo');

  // C10
  await start(); await openEditFood('Cheez');
  await page.fill('#cName', 'Cheez-it Duo 2pk'); await page.fill('#cK', '300'); await page.click('#cGo');
  check(await toast() === 'Food updated', 'C10: toast Food updated, got ' + await toast());
  check(await page.locator('#q').count() === 1, 'C10: back on Search tab');
  await search('Cheez');
  check(await page.locator('#results .res').count() === 1 && (await page.locator('#results .res .nm div').first().textContent()) === 'Cheez-it Duo 2pk' && (await page.locator('#results .res .badge').textContent()).trim() === 'My food', 'C10: exactly one My food "Cheez-it Duo 2pk"');
  st = await stored();
  check(st.custom.length === 2 && st.custom[0].name === 'Cheez-it Duo 2pk' && near(st.custom[0].updatedAt) && st.custom[0].per100.k === 1000 && st.custom[0].source === 'Custom' && st.custom[1].name === 'Homemade chili' && st.custom[1].updatedAt === 900,
    'C10: stored ' + JSON.stringify(st.custom));

  // C11
  await page.click('#dClose');
  check(await rows('Breakfast', 'Cheez-it Duo').count() >= 1 && (await rows('Breakfast', 'Cheez-it Duo').first().locator('.nm div').first().textContent()) === 'Cheez-it Duo' && await kcal('Breakfast', 'Cheez-it Duo') === '150', 'C11: Breakfast row still Cheez-it Duo 150');
  e1 = (await stored()).days[TODAY].find(e => e.id === 'e1');
  check(e1.name === 'Cheez-it Duo' && e1.per100.k === 500 && e1.updatedAt === 1000, 'C11: stored e1 unchanged');

  // C12 (state from C10, after reload)
  await page.reload(); await page.waitForSelector('#meals .entry');
  st = await stored();
  check(JSON.stringify(st.measures['Cheez-it Duo 2pk||Custom'].map(m => [m.label, m.g])) === '[["box",200]]' && !('Cheez-it Duo||Custom' in st.measures), 'C12: measures moved: ' + JSON.stringify(st.measures));
  await openAdd('Breakfast'); await search('Cheez'); await page.locator('#results .res .nm').first().click();
  const units = await page.locator('#unit option').allTextContents();
  check(units.some(u => /box/.test(u)), 'C12: #unit offers box: ' + JSON.stringify(units));

  // C13
  await start(); await openEditFood('chili');
  await page.fill('#cName', 'Cheez-it Duo'); await page.click('#cGo');
  check(await toast() === 'You already have a food with that name', 'C13: toast, got "' + await toast() + '"');
  check(await dlgOpen() && await page.locator('#cName').count() === 1, 'C13: form stays open');
  st = await stored();
  check(JSON.stringify(st.custom.map(f => f.name)) === '["Cheez-it Duo","Homemade chili"]' && st.custom[0].updatedAt === 1000 && st.custom[1].updatedAt === 900, 'C13: stored foods unchanged');

  // C14
  await start(); await openEditFood('Cheez');
  await page.fill('#cName', ''); await page.click('#cGo');
  st = await stored();
  check(await toast() === 'Enter a name' && JSON.stringify(st.custom[0]) === JSON.stringify(seed().custom[0]), 'C14: toast Enter a name, stored food unchanged, got "' + await toast() + '"');

  // C15
  const evil = '<img src=x onerror=window.__x=1>';
  await start();
  await rows('Breakfast', 'Quick add').locator('.nm').click();
  await page.fill('#eName', evil); await page.click('#addGo');
  const rowTxt = await card('Breakfast').locator('.entry .nm > div').allTextContents();
  check(rowTxt.includes(evil), 'C15: diary row shows literal text');
  await openEditFood('Cheez');
  await page.fill('#cName', evil); await page.click('#cGo');
  await search('img');
  check((await page.locator('#results .res .nm div').first().textContent()) === evil, 'C15: search result shows literal text');
  check(await page.evaluate(() => window.__x) === undefined, 'C15: window.__x undefined');
  check(await page.locator('#meals img, #results img').count() === 0, 'C15: no img in #meals or #results');

  // C16: C10 + C5 then reload
  await start();
  await rows('Breakfast', 'Quick add').locator('.nm').click();
  await page.fill('#eName', 'Cheez-it Duo bites'); await page.click('#addGo');
  await openEditFood('Cheez');
  await page.fill('#cName', 'Cheez-it Duo 2pk'); await page.fill('#cK', '300'); await page.click('#cGo');
  await page.reload(); await page.waitForSelector('#meals .entry');
  check(await rows('Breakfast', 'Cheez-it Duo bites').count() === 1, 'C16: entry name persists');
  await openAdd('Breakfast'); await search('2pk');
  check(await page.locator('#results .res').count() === 1, 'C16: food name persists');

  // Phone layout evidence (meaningful with --device; harmless otherwise)
  await start(); await openAdd('Breakfast'); await search('Cheez');
  const lay = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const row = document.querySelector('#results .res'), nm = r(row.querySelector('.nm')), bd = r(row.querySelector('.badge')), eb = row.querySelector('[data-edit-food]'), e = r(eb), rr = r(row);
    return { vw: innerWidth, row: [rr.r - rr.l, rr.b - rr.t], nm: [nm.r - nm.l, nm.b - nm.t], badge: [bd.r - bd.l, bd.b - bd.t], edit: [e.r - e.l, e.b - e.t], editText: eb.textContent, editWrapsText: e.b - e.t > 60,
      overlapBadgeEdit: hit(bd, e), overlapNameEdit: hit(nm, e), overlapNameBadge: hit(nm, bd), editOutsideRow: e.r > rr.r + 1 || e.b > rr.b + 1, editFont: getComputedStyle(eb).fontSize, editBorder: getComputedStyle(eb).borderTopWidth + ' ' + getComputedStyle(eb).backgroundColor, editTop: e.t - rr.t, badgeTop: bd.t - rr.t, aria: eb.getAttribute('aria-label') };
  });
  console.log('LAYOUT ' + JSON.stringify(lay));
  check(!lay.overlapBadgeEdit && !lay.overlapNameEdit && !lay.overlapNameBadge && !lay.editOutsideRow, 'layout: Edit does not overlap badge/name or leave the row');
  check(lay.aria === 'Edit Cheez-it Duo', 'note: Edit aria-label is "' + lay.aria + '"');
  console.log('screenshot results: ' + await screenshot('edit-quick-add-results'));
  await page.locator('[data-edit-food]').first().click();
  console.log('screenshot edit form: ' + await screenshot('edit-quick-add-form'));

  // C17
  check(errs.length === 0, 'C17: no page errors: ' + errs);
};
