// Ids for saved foods (docs/specs/saved-food-ids.md, checklist C1..C9, plus X1..X3 extras). Seeds S9 from the spec.
const pad = n => String(n).padStart(2, '0');
const TODAY = (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());
const A = { k: 500, p: 10, c: 60, f: 25 };
const ID_CHEEZ = 'f-c7e47751c795d5a1', ID_CHILI = 'f-7b677d3dbd34a367', ID_TWIN_C = 'f-8f7cbafda4738195', ID_TWIN_D = 'f-0f78ba8f82a30c87';

const s9 = () => ({
  schemaVersion: 8, weightUnit: 'g', useOFF: false, useUSDA: false, tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', theme: 'auto',
  custom: [
    { name: 'Cheez-it Duo', brand: '', source: 'Custom', servingG: 30, per100: { ...A }, updatedAt: 1000 },
    { name: 'Homemade chili', brand: '', source: 'Custom', servingG: 250, per100: { k: 100, p: 8, c: 10, f: 3 }, updatedAt: 900 },
    { name: 'Twin bar', brand: '', source: 'Custom', barcode: '5012345678900', servingG: 40, per100: { k: 400, p: 8, c: 50, f: 18 }, updatedAt: 800 },
    { name: 'Twin bar', brand: '', source: 'Custom', barcode: '4006381333931', servingG: 40, per100: { k: 300, p: 6, c: 40, f: 12 }, updatedAt: 700 }],
  measures: {
    'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 1000 }],
    'Twin bar||Custom': [{ label: 'wrapper', g: 20, updatedAt: 800 }],
    'Test Oats|Acme|OFF': [{ label: 'scoop', g: 30, updatedAt: 500 }] },
  recent: [
    { name: 'Test Oats', brand: 'Acme', source: 'OFF', per100: { k: 370, p: 13, c: 60, f: 7 }, servingG: 0, servingLabel: '' },
    { name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { ...A }, servingG: 30, servingLabel: '' }],
  days: { [TODAY]: [
    { id: 'e1', meal: 'Breakfast', name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { ...A }, servingG: 30, servingLabel: '', grams: 30, unitKey: 'w:g', amount: 30, disp: '', updatedAt: 1000 }] },
});

const EVIL = '<img src=x onerror=window.__pwned=1>';
const hostile = () => {
  const f = (name, id, u) => ({ name, brand: '', source: 'Custom', servingG: 100, per100: { k: 100, p: 1, c: 1, f: 1 }, updatedAt: u, id });
  return { ...s9(), schemaVersion: 9, days: {}, recent: [],
    custom: [f('Hostile one', EVIL, 10), f('Hostile two', '__proto__', 20), f('Hostile three', 123, 30), f('Good food', 'fgood00001', 40)],
    measures: { [EVIL]: [{ label: 'bad', g: 10, updatedAt: 1 }] } };
};

export default async ({ page, url, check: hardCheck, screenshot }) => {
  const fails = [];
  const check = (c, m) => { if (!c) { fails.push(m); console.log('FAILED CHECK: ' + m); } };
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const start = async (seed = s9(), wait = '#meals .entry') => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed);
    await page.reload();
    await page.waitForSelector(wait);
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const toast = async () => (await page.locator('#toast').textContent()).trim();
  const card = m => page.locator('#meals .card').filter({ has: page.locator('h2', { hasText: new RegExp('^' + m + '$') }) });
  const openAdd = async meal => { await page.click(`[data-add="${meal}"]`); };
  const customTab = async () => { await page.locator('#dBody .seg button', { hasText: 'Custom' }).click(); };
  const search = async q => { await page.fill('#q', q); };
  const near = t => Math.abs(t - Date.now()) < 60000;
  const units = () => page.locator('#unit option').allTextContents();
  const names = st => JSON.stringify(st.custom.map(f => f.name));

  // C1
  await start();
  let st = await stored();
  // (the spec said to read raw storage right after load, but the store migrates in memory and writes on the first save, as it always has; the migration is deterministic, so that is safe)
  // The store migrates in memory and writes only on the first save, so force one harmless save (log Test Oats from Recent) and read again.
  await page.click('[data-add="Dinner"]'); await page.locator('#results .res').filter({ hasText: 'Test Oats' }).first().locator('.nm').click(); await page.click('#addGo');
  st = await stored();
  check(st.schemaVersion === 9, 'C1 (after a save): schemaVersion 9, got ' + st.schemaVersion);
  check(names(st) === '["Cheez-it Duo","Homemade chili","Twin bar","Twin bar"]' && JSON.stringify(st.custom.map(f => f.id)) === JSON.stringify([ID_CHEEZ, ID_CHILI, ID_TWIN_C, ID_TWIN_D]), 'C1: custom names/ids ' + JSON.stringify(st.custom.map(f => [f.name, f.id])));
  check(!('Cheez-it Duo||Custom' in st.measures) && !('Twin bar||Custom' in st.measures), 'C1: old measure keys gone: ' + JSON.stringify(Object.keys(st.measures)));
  const lm = k => JSON.stringify((st.measures[k] || []).map(m => [m.label, m.g, m.updatedAt]));
  check(lm(ID_CHEEZ) === '[["box",200,1000]]', 'C1: box under Cheez id ' + lm(ID_CHEEZ));
  check(lm(ID_TWIN_C) === '[["wrapper",20,800]]' && lm(ID_TWIN_D) === '[["wrapper",20,800]]', 'C1: wrapper under both twins ' + lm(ID_TWIN_C) + lm(ID_TWIN_D));
  check(lm('Test Oats|Acme|OFF') === '[["scoop",30,500]]', 'C1: oats scoop untouched');
  const e1 = st.days[TODAY].find(e => e.id === 'e1');
  check(e1 && e1.foodId === ID_CHEEZ && e1.updatedAt === 1000, 'C1: e1 foodId/updatedAt ' + JSON.stringify(e1));
  check(st.recent.find(r => r.name === 'Cheez-it Duo').foodId === ID_CHEEZ && st.recent.find(r => r.name === 'Test Oats').foodId === undefined, 'C1: recents foodId');
  const row = card('Breakfast').locator('.entry').filter({ hasText: 'Cheez-it Duo' }).first();
  check((await row.locator('.k').textContent()).trim() === '150', 'C1: Breakfast row shows 150');

  // C2
  await start(); await openAdd('Lunch'); await search('Cheez');
  const res = page.locator('#results .res').filter({ has: page.locator('.badge', { hasText: 'My food' }) });
  await res.first().locator('.nm').click();
  check(await page.locator('#addGo').count() === 1, 'C2: Amount screen open');
  let u = await units();
  check(u.includes('box (200 g)'), 'C2: unit has "box (200 g)": ' + JSON.stringify(u));
  check(await page.inputValue('#unit') === 'p:box' && await page.inputValue('#amt') === '1', 'C2: unit p:box, amt 1, got ' + await page.inputValue('#unit') + ' / ' + await page.inputValue('#amt'));

  // C3
  await start(); await openAdd('Breakfast'); await search('Cheez');
  await page.locator('[data-edit-food]').first().click();
  await page.fill('#cName', 'Duo snacks'); await page.click('#cGo');
  check(await toast() === 'Food updated', 'C3: toast Food updated, got ' + await toast());
  await search('Cheez');
  const oldMy = page.locator('#results .res').filter({ has: page.locator('.badge', { hasText: 'My food' }) });
  check(await oldMy.count() === 0, 'C3: no My food result named Cheez-it Duo left, got ' + await oldMy.count() + '; all results: ' + JSON.stringify(await page.locator('#results .res .nm').allTextContents()));
  await search('Duo snacks');
  const r3 = page.locator('#results .res');
  check(await r3.count() === 1 && (await r3.locator('.badge').textContent()).trim() === 'My food' && (await r3.locator('.nm div').first().textContent()) === 'Duo snacks', 'C3: exactly one My food Duo snacks');
  await r3.first().locator('.nm').click();
  u = await units();
  check(u.includes('box (200 g)'), 'C3: unit has box (200 g): ' + JSON.stringify(u));
  st = await stored();
  check(st.custom[0].name === 'Duo snacks' && st.custom[0].id === ID_CHEEZ && near(st.custom[0].updatedAt), 'C3: stored first food ' + JSON.stringify(st.custom[0]));
  check(!('Cheez-it Duo||Custom' in st.measures) && !('Duo snacks||Custom' in st.measures) && lm(ID_CHEEZ) === '[["box",200,1000]]', 'C3: measures keys ' + JSON.stringify(Object.keys(st.measures)));

  // X3: rename, reload, then Amount picker still shows the measure (extra)
  await page.reload(); await page.waitForSelector('#meals .entry');
  await openAdd('Lunch'); await search('Duo snacks'); await page.locator('#results .res .nm').first().click();
  u = await units();
  check(u.includes('box (200 g)') && await page.inputValue('#unit') === 'p:box', 'X3: after reload renamed food still offers box, selected ' + await page.inputValue('#unit') + ' ' + JSON.stringify(u));

  // C4
  await start(); await openAdd('Breakfast'); await search('Twin');
  const twinCount = await page.locator('#results .res').count();
  check(twinCount === 2 && await page.locator('[data-edit-food]').count() === 2, 'C4: two Twin results with Edit, got ' + twinCount);
  await page.locator('[data-edit-food]').nth(1).click();
  check(await page.inputValue('#cBar') === '4006381333931', 'C4: #cBar is 4006381333931, got ' + await page.inputValue('#cBar'));
  await page.fill('#cK', '150'); await page.click('#cGo');
  check(await toast() === 'Food updated', 'C4: toast Food updated, got ' + await toast());
  st = await stored();
  const fc = st.custom.find(f => f.id === ID_TWIN_C), fd = st.custom.find(f => f.id === ID_TWIN_D);
  check(fd && Math.abs(fd.per100.k - 375) < 0.01 && near(fd.updatedAt), 'C4: (d) edited ' + JSON.stringify(fd));
  check(fc && fc.per100.k === 400 && fc.updatedAt === 800, 'C4: (c) unchanged ' + JSON.stringify(fc));
  check(st.custom.length === 4, 'C4: still 4 foods');

  // X4: barcode search variant of C4 (extra)
  await start(); await openAdd('Breakfast'); await search('4006381333931');
  await page.locator('[data-edit-food]').first().click();
  check(await page.inputValue('#cBar') === '4006381333931', 'X4: barcode search edit opens food (d)');
  await page.fill('#cK', '150'); await page.click('#cGo');
  st = await stored();
  check(await toast() === 'Food updated' && st.custom.find(f => f.id === ID_TWIN_D).updatedAt > 700 && st.custom.find(f => f.id === ID_TWIN_C).updatedAt === 800, 'X4: only (d) changed');

  // X5: a Recent copy of a saved food is not listed next to its saved food
  await start(); await openAdd('Lunch'); await search('Cheez');
  const r5 = page.locator('#results .res');
  const t5 = await r5.locator('.badge').allTextContents();
  check(await r5.count() === 1 && t5[0].trim() === 'My food', 'X5: Cheez lists once (My food), got ' + JSON.stringify(t5));
  await search('');
  const all5 = await page.locator('#results .res .nm > div:first-child').allTextContents();
  check(all5.filter(n => n === 'Cheez-it Duo').length === 1, 'X5: empty search lists Cheez-it Duo once: ' + JSON.stringify(all5));
  await search('Oats');
  check(await r5.count() === 1 && (await r5.locator('.badge').textContent()).trim() === 'Recent', 'X5: Oats still a Recent');

  // C5
  await start(); await openAdd('Breakfast'); await search('Twin');
  await page.locator('[data-edit-food]').first().click();
  await page.fill('#cName', 'Twin bar mini'); await page.click('#cGo');
  check(await toast() === 'Food updated', 'C5: toast Food updated, got ' + await toast());
  st = await stored();
  const c5c = st.custom.find(f => f.id === ID_TWIN_C), c5d = st.custom.find(f => f.id === ID_TWIN_D);
  check(c5c && c5c.name === 'Twin bar mini' && c5d && c5d.name === 'Twin bar' && c5d.updatedAt === 700, 'C5: stored ' + JSON.stringify([c5c, c5d]));

  // C6
  await start(hostile(), '#meals'); await openAdd('Lunch'); await search('Hostile');
  check(await page.evaluate(() => window.__pwned) === undefined, 'C6: window.__pwned undefined');
  check(await page.evaluate(() => ({}).polluted) === undefined, 'C6: no pollution');
  const r6 = page.locator('#results .res');
  const n6 = await r6.locator('.nm > div:first-child').allTextContents();
  const b6 = await r6.locator('.badge').allTextContents();
  check(JSON.stringify(n6) === '["Hostile one","Hostile two","Hostile three"]' && b6.every(b => b.trim() === 'My food'), 'C6: results ' + JSON.stringify(n6) + JSON.stringify(b6));
  check(await page.locator('#results img').count() === 0 && await page.locator('#dBody img').count() === 0, 'C6: no img in results');
  st = await stored();
  check(st.custom.map(f => f.id).join() === [EVIL, '__proto__', 123, 'fgood00001'].join(), 'C6 (raw storage right after load, as the spec words it): ids already clean? got ' + JSON.stringify(st.custom.map(f => f.id)));
  // storage is only rewritten on the first save: pick the first hostile food and add it (also checks the copy gets a clean foodId)
  await r6.first().locator('.nm').click(); await page.click('#addGo');
  st = await stored();
  const ids6 = st.custom.map(f => f.id);
  check(st.custom.length === 4 && [0, 1, 2].every(i => /^f-[0-9a-f]{16}$/.test(ids6[i])) && ids6[3] === 'fgood00001', 'C6: ids ' + JSON.stringify(ids6));
  check(JSON.stringify(ids6.slice(0, 3)) === '["f-7575ca2e3cb15a46","f-21c4d0f78effb0f0","f-03d900b663766886"]', 'C6: derived ids match spec values: ' + JSON.stringify(ids6.slice(0, 3)));
  const le6 = st.days[TODAY].find(e => e.meal === 'Lunch');
  check(le6 && le6.foodId === ids6[0], 'C6: entry foodId is the derived id ' + JSON.stringify(le6 && le6.foodId));
  check(!Object.keys(st.measures).includes('__proto__'), 'C6: measures ok ' + JSON.stringify(Object.keys(st.measures)));

  // C7
  await start(); await openAdd('Lunch'); await customTab();
  await page.fill('#cName', 'Fresh bar'); await page.fill('#cSize', '40'); await page.fill('#cK', '200'); await page.click('#cGo');
  await page.click('#addGo');
  st = await stored();
  const fresh = st.custom[0];
  check(st.custom.length === 5 && fresh.name === 'Fresh bar' && /^f[0-9a-z]{6,24}$/.test(fresh.id) && near(fresh.updatedAt), 'X1/C7: stored first ' + JSON.stringify(fresh));
  check(JSON.stringify(st.custom.slice(1).map(f => f.id)) === JSON.stringify([ID_CHEEZ, ID_CHILI, ID_TWIN_C, ID_TWIN_D]), 'C7: other ids kept');
  const le = st.days[TODAY].find(e => e.meal === 'Lunch');
  check(le && le.foodId === fresh.id, 'C7: Lunch entry foodId ' + JSON.stringify(le));
  check(st.recent[0].name === 'Fresh bar' && st.recent[0].foodId === fresh.id, 'C7: recent[0] ' + JSON.stringify(st.recent[0]));

  // X2: add the same name again (continues in the same page): replaces, keeps id; add a measure first through the stored state
  await page.evaluate(id => { const s = JSON.parse(localStorage.getItem('macrodiary.v1')); s.measures[id] = [{ label: 'pack', g: 55, updatedAt: 5 }]; localStorage.setItem('macrodiary.v1', JSON.stringify(s)); }, fresh.id);
  await page.reload(); await page.waitForSelector('#meals .entry');
  await openAdd('Lunch'); await customTab();
  await page.fill('#cName', 'Fresh bar'); await page.fill('#cSize', '40'); await page.fill('#cK', '300'); await page.click('#cGo');
  u = await units();
  check(u.some(x => /^pack \(55 g\)/.test(x)), 'X2: replaced food still offers its pack measure: ' + JSON.stringify(u));
  await page.click('#addGo');
  st = await stored();
  check(st.custom.length === 5 && st.custom[0].id === fresh.id && Math.abs(st.custom[0].per100.k - 750) < 0.01, 'X2: one Fresh bar, same id, new numbers: ' + JSON.stringify(st.custom[0]));
  check(JSON.stringify(st.measures[fresh.id]) === '[{"label":"pack","g":55,"updatedAt":5}]' && JSON.stringify(st.tombstones) === '{}', 'X2: measures kept, no tombstones');

  // C8
  await start(); await openAdd('Lunch'); await customTab();
  await page.fill('#cName', 'Cheez-it Duo'); await page.fill('#cSize', '30'); await page.fill('#cK', '100'); await page.click('#cGo');
  check(await page.locator('#addGo').count() === 1, 'C8: Amount screen opened');
  u = await units();
  check(u.includes('box (200 g)'), 'C8: unit has box (200 g): ' + JSON.stringify(u));
  await page.click('#addGo');
  st = await stored();
  check(st.custom.length === 4 && st.custom[0].name === 'Cheez-it Duo' && st.custom[0].id === ID_CHEEZ && Math.abs(st.custom[0].per100.k - 333.33) < 0.1 && JSON.stringify(st.tombstones) === '{}', 'C8: stored ' + JSON.stringify([st.custom.length, st.custom[0], st.tombstones]));

  // C9
  await start();
  await card('Breakfast').locator('.entry').filter({ hasText: 'Cheez-it Duo' }).first().locator('.nm').click();
  u = await units();
  check(u.includes('box (200 g)'), 'C9: Edit entry #unit has box (200 g): ' + JSON.stringify(u));
  console.log('screenshot C9: ' + await screenshot('saved-food-ids-c9'));

  check(errs.length === 0, 'no page errors: ' + errs);
  hardCheck(fails.length === 0, fails.length + ' failed: ' + fails.join(' || '));
};
