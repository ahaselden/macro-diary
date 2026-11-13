// Nutrition details page (docs/specs/nutrition-details.md, checklist C1..C8). Open Food Facts is stubbed with an invented product.
export const stubs = [
  { match: 'world.openfoodfacts.org', json: { products: [{ code: '1', product_name: 'Test bar', brands: 'Acme', serving_quantity: 50, serving_size: '1 bar (50 g)',
    nutriments: { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20, fiber_100g: 7, sugars_100g: 12, 'saturated-fat_100g': 3, sodium_100g: 0.5, cholesterol_100g: 0.02 } }] } },
];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = shift(0), YEST = shift(-1);
const ent = (id, name, per100, grams, nut, meal = 'Breakfast') => ({ id, meal, name, brand: '', source: '', per100, grams, ...(nut ? { nut } : {}) });
const OATS = ent('a', 'Oats', { k: 380, p: 13, c: 66, f: 7 }, 50, { fiber: 10, sugars: 1, satFat: 1.2, sodium: 5, cholesterol: 0 });
const COLA = ent('b', 'Cola', { k: 42, p: 0, c: 10.6, f: 0 }, 330);
const seed = days => ({ schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: true,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days });

export default async ({ page, url, check, screenshot }) => {
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const start = async days => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed(days));
    await page.reload();
    await page.waitForSelector('#summary');
  };
  const isOpen = () => page.evaluate(() => document.getElementById('dlg').open);
  const body = async () => (await page.innerText('#dBody')).replace(/[ \t]+/g, ' ');
  const row = async label => (await page.locator('#dBody .row').filter({ has: page.locator('span', { hasText: new RegExp('^' + label + '$') }) }).first().innerText()).replace(/\s+/g, ' ').trim();
  const labels = ['Fiber', 'Sugars', 'Saturated fat', 'Sodium', 'Cholesterol'];
  const layout = () => page.evaluate(() => {
    const dlg = document.getElementById('dlg'), r = dlg.getBoundingClientRect();
    const clipped = [...document.querySelectorAll('#dBody .row')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > r.right + 1).map(e => e.innerText.replace(/\s+/g, ' '));
    const wrapped = [...document.querySelectorAll('#dBody .row')].filter(e => e.getBoundingClientRect().height > 40).map(e => e.innerText.replace(/\s+/g, ' ') + ' h=' + Math.round(e.getBoundingClientRect().height));
    return { vw: innerWidth, docW: document.documentElement.scrollWidth, dlgL: Math.round(r.left), dlgR: Math.round(r.right), dlgH: Math.round(r.height), vh: innerHeight, bodyScroll: document.getElementById('dBody').scrollHeight, clipped, wrapped };
  });

  // C1 + C2 + layout
  await start({ [TODAY]: [OATS, COLA] });
  check(await page.getAttribute('#summary', 'role') === 'button' && await page.getAttribute('#summary', 'tabindex') === '0', 'C2: #summary has role=button and tabindex=0');
  await page.click('#summary');
  check(await isOpen(), 'C1: click opens the dialog');
  let t = await body();
  check(t.includes('Nutrition facts') && t.includes('Today'), 'C1: has "Nutrition facts" and today, got ' + t.slice(0, 80));
  for (const l of labels) check(new RegExp(l).test(t), 'C1: row label ' + l);
  const rv = {}; for (const l of labels) rv[l] = await row(l);
  console.log('C1 rows: ' + JSON.stringify(rv));
  check(/\b5 g/.test(rv.Fiber) && /from 1 of 2 items/.test(rv.Fiber), 'C1: Fiber 5 g from 1 of 2 items, got ' + rv.Fiber);
  check(/\b0\.5 g/.test(rv.Sugars), 'C1: Sugars 0.5 g, got ' + rv.Sugars);
  check(/\b0\.6 g/.test(rv['Saturated fat']), 'C1: Saturated fat 0.6 g, got ' + rv['Saturated fat']);
  check(/\b2\.5 mg/.test(rv.Sodium), 'C1: Sodium 2.5 mg, got ' + rv.Sodium);
  check(/\b0 mg/.test(rv.Cholesterol) && !/Not recorded/.test(rv.Cholesterol), 'C1: Cholesterol 0 mg not "Not recorded", got ' + rv.Cholesterol);
  const cal = await row('Calories');
  check(/329/.test(cal) && /2000/.test(cal), 'C1: Calories 329 of 2000, got ' + cal);
  const L = await layout(); console.log('LAYOUT C1 ' + JSON.stringify(L));
  check(L.docW <= L.vw && L.dlgL >= 0 && L.dlgR <= L.vw, 'layout: dialog inside the viewport, no horizontal page scroll');
  check(L.clipped.length === 0, 'layout: no clipped rows ' + JSON.stringify(L.clipped));
  console.log('screenshot: ' + await screenshot('nutrition-details-c1'));
  await page.keyboard.press('Escape');
  check(!(await isOpen()), 'C2: Escape closes');
  check(await page.locator('#meals .entry').count() === 2, 'C2: diary unchanged (2 entries)');

  // C2 keyboard: Tab reachability, Enter, Space
  await page.focus('body');
  let reached = false;
  for (let i = 0; i < 30 && !reached; i++) { await page.keyboard.press('Tab'); reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'summary'); }
  check(reached, 'C2: #summary reachable with Tab');
  await page.keyboard.press('Enter');
  check(await isOpen(), 'C2: Enter opens');
  await page.click('#dClose');
  check(!(await isOpen()), 'C2: close button closes');
  await page.focus('#summary'); await page.keyboard.press('Space');
  check(await isOpen(), 'C2: Space opens');
  await page.keyboard.press('Escape');
  check(!(await isOpen()) && await page.locator('#meals .entry').count() === 2, 'C2: closed again, diary unchanged');

  // C3
  await start({ [TODAY]: [COLA] });
  await page.click('#summary');
  t = await body();
  const nr = t.match(/Not recorded/g) || [];
  check(nr.length === 5, 'C3: five "Not recorded", got ' + nr.length);
  const facts = t.slice(t.indexOf('Nutrition facts'));
  check(!/\b0 ?(g|mg)\b/.test(facts.split('Older')[0]), 'C3: no "0 g"/"0 mg" in facts list');
  check(/139/.test(await row('Calories')), 'C3: calories 139, got ' + await row('Calories'));
  check(/Older entries/i.test(t) && /typed/i.test(t), 'C3: honesty note present');
  console.log('screenshot: ' + await screenshot('nutrition-details-c3'));

  // C4
  await start({});
  await page.click('#summary');
  t = await body();
  check(await isOpen(), 'C4: opens on an empty day');
  check(/^0\b/.test((await row('Calories')).replace(/^Calories\s*/, '')), 'C4: calories 0, got ' + await row('Calories'));
  check((t.match(/Not recorded/g) || []).length === 5, 'C4: five "Not recorded"');
  check(!/NaN|undefined|null/.test(t), 'C4: no NaN/undefined text');

  // C5
  await start({ [TODAY]: [ent('x', 'Thing', { k: 200, p: 20, c: 30, f: 10 }, 100)] });
  await page.click('#summary');
  const r5 = { k: await row('Calories'), p: await row('Protein'), c: await row('Carbs'), f: await row('Fat') };
  console.log('C5 rows: ' + JSON.stringify(r5));
  check(/200 kcal of 2000 kcal \(10%\)/.test(r5.k), 'C5: Calories 200 of 2000 (10%), got ' + r5.k);
  check(/20 g of 150 g \(13%\)/.test(r5.p), 'C5: Protein 20 / 150 g (13%), got ' + r5.p);
  check(/30 g of 200 g \(15%\)/.test(r5.c), 'C5: Carbs 30 / 200 g (15%), got ' + r5.c);
  check(/10 g of 65 g \(15%\)/.test(r5.f), 'C5: Fat 10 / 65 g (15%), got ' + r5.f);

  // C6
  const evil = '<img src=x onerror=alert(1)>';
  await start({ [TODAY]: [ent('h', evil, { k: 100, p: 1, c: 1, f: 1 }, 100, { fiber: '9', sodium: -5, sugars: 1e308 })] });
  await page.click('#summary');
  t = await body();
  check(dialogs.length === 0, 'C6: no alert dialog fired');
  check(await page.locator('#dBody img, #meals img').count() === 0, 'C6: no img element injected');
  for (const l of ['Fiber', 'Sodium', 'Sugars']) { const r = await row(l); check(/Not recorded/.test(r), `C6: ${l} Not recorded, got ${r}`); }
  await page.keyboard.press('Escape');
  check(/<img src=x/.test(await page.innerText('#meals')), 'C6: name shown as literal text in diary');

  // C7
  await start({ [TODAY]: [OATS], [YEST]: [ent('y', 'Rice', { k: 130, p: 2.7, c: 28, f: 0.3 }, 200, { fiber: 1, sodium: 1 }, 'Lunch')] });
  await page.click('#prev');
  await page.click('#summary');
  t = await body();
  const yl = (await page.innerText('#dBody .muted')).trim();
  console.log('C7 header: ' + yl);
  check(!/^Today/.test(yl) && /1 item/.test(yl), 'C7: header shows yesterday not Today, got ' + yl);
  check(/260/.test(await row('Calories')), 'C7: yesterday calories 260, got ' + await row('Calories'));
  check(/\b2 g/.test(await row('Fiber')), 'C7: yesterday fiber 2 g, got ' + await row('Fiber'));

  // C8
  await start({});
  await page.click('[data-add="Lunch"]');
  await page.fill('#q', 'Test bar');
  await page.click('#goSearch');
  await page.waitForSelector('#results .res', { timeout: 10000 });
  await page.click('#results .res');
  await page.waitForSelector('#amt');
  await page.selectOption('#unit', 'w:g');
  await page.fill('#amt', '100');
  await page.click('#addGo');
  await page.waitForSelector('#meals .entry');
  await page.click('#summary');
  const r8 = {}; for (const l of labels) r8[l] = await row(l);
  console.log('C8 rows: ' + JSON.stringify(r8));
  const exp = { Fiber: '7 g', Sugars: '12 g', 'Saturated fat': '3 g', Sodium: '500 mg', Cholesterol: '20 mg' };
  for (const l of labels) check(r8[l].includes(exp[l]) && /from 1 of 1 item/.test(r8[l]), `C8: ${l} ${exp[l]} from 1 of 1 items, got ${r8[l]}`);
  const L8 = await layout(); console.log('LAYOUT C8 ' + JSON.stringify(L8));
  console.log('screenshot: ' + await screenshot('nutrition-details-c8'));

  check(errs.length === 0, 'no page errors: ' + errs);
};
