// Nutrition facts on the Amount screen + kept barcode (docs/specs/item-nutrition-facts.md, checklist C1..C12). Open Food Facts is stubbed with invented products.
const prod = (name, nutriments, code) => ({ product_name: name, brands: 'Acme', serving_quantity: 50, serving_size: '1 bar (50 g)', ...(code ? { code } : {}), nutriments });
const FULL = { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20, fiber_100g: 7, sugars_100g: 12, 'saturated-fat_100g': 3, sodium_100g: 0.5, cholesterol_100g: 0.02 };
const PLAIN = { 'energy-kcal_100g': 200, proteins_100g: 5, carbohydrates_100g: 30, fat_100g: 4 };
const HALF = { 'energy-kcal_100g': 300, proteins_100g: 5, carbohydrates_100g: 40, fat_100g: 10, fiber_100g: 0, sodium_100g: 0.4 };
export const stubs = [
  { match: /\/api\/v2\/product\/810030518914\.json/, json: { status: 1, product: prod('Test bar', FULL, '0810030518914') } },
  { match: /search_terms=Test%20bar/, json: { products: [prod('Test bar', FULL, '810030518914')] } },
  { match: /search_terms=Plain%20thing/, json: { products: [prod('Plain thing', PLAIN)] } },
  { match: /search_terms=Half%20bar/, json: { products: [prod('Half bar', HALF)] } },
];

const pad = n => String(n).padStart(2, '0');
const d0 = new Date(); const TODAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
const seed = (days, custom = []) => ({ schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: true,
  recent: [], custom, tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days });
const LABELS = ['Fiber', 'Sugars', 'Saturated fat', 'Sodium', 'Cholesterol'];

export default async ({ page, url, check, screenshot }) => {
  const errs = [], dialogs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const start = async (days = {}, custom = []) => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed(days, custom));
    await page.reload(); await page.waitForSelector('#summary');
  };
  const dlgText = async () => (await page.innerText('#dBody')).replace(/[ \t]+/g, ' ');
  const facts = async () => (await page.innerText('#itemFacts')).replace(/\s+/g, ' ');
  const row = async label => (await page.locator('#itemFacts .row').filter({ has: page.locator('span', { hasText: new RegExp('^' + label + '$') }) }).first().innerText()).replace(/\s+/g, ' ').trim();
  const rows = async () => { const o = {}; for (const l of LABELS) o[l] = await row(l); return o; };
  const prev = async () => (await page.innerText('#prev2')).replace(/\s+/g, ' ');
  const oneLine = () => page.locator('#itemFacts p').count();
  const layout = tag => page.evaluate(tag => {
    const dlg = document.getElementById('dlg'), r = dlg.getBoundingClientRect();
    const rs = [...document.querySelectorAll('#itemFacts .row')];
    const clipped = rs.filter(e => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > r.right + 1).map(e => e.innerText.replace(/\s+/g, ' '));
    const wrapped = rs.filter(e => e.getBoundingClientRect().height > 40).map(e => e.innerText.replace(/\s+/g, ' ') + ' h=' + Math.round(e.getBoundingClientRect().height));
    const add = document.getElementById('addGo').getBoundingClientRect();
    return { tag, vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth, dlgL: Math.round(r.left), dlgR: Math.round(r.right), dlgH: Math.round(r.height),
      addTop: Math.round(add.top), addBottom: Math.round(add.bottom), bodyScrollH: document.getElementById('dBody').scrollHeight, bodyClientH: document.getElementById('dBody').clientHeight, clipped, wrapped };
  }, tag);
  const checkLayout = async tag => {
    const L = await layout(tag); console.log('LAYOUT ' + JSON.stringify(L));
    check(L.docW <= L.vw && L.dlgL >= 0 && L.dlgR <= L.vw, `layout ${tag}: dialog inside viewport, no horizontal page scroll`);
    check(L.clipped.length === 0, `layout ${tag}: no clipped fact rows ${JSON.stringify(L.clipped)}`);
    check(L.wrapped.length === 0, `layout ${tag}: no wrapped fact rows ${JSON.stringify(L.wrapped)}`);
  };
  const openAmount = async (query, pickText) => {
    await page.click('[data-add="Lunch"]');
    await page.fill('#q', query); await page.click('#goSearch');
    await page.waitForSelector('#results .res', { timeout: 10000 });
    await page.locator('#results .res', pickText ? { hasText: pickText } : {}).first().click();
    await page.waitForSelector('#amt');
  };
  const setAmt = async v => { await page.fill('#amt', String(v)); };
  const exp1 = { Fiber: '7 g', Sugars: '12 g', 'Saturated fat': '3 g', Sodium: '500 mg', Cholesterol: '20 mg' };
  const eq = (r, e, tag) => { for (const l of LABELS) check(r[l] === l + ' ' + e[l], `${tag}: ${l} "${e[l]}", got "${r[l]}"`); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));

  // C1, C2, C5 and layout
  await start();
  await openAmount('Test bar', 'Test bar');
  await page.selectOption('#unit', 'w:g'); await setAmt(100);
  let p = await prev(), t = await dlgText();
  check(/400/.test(p) && /kcal/.test(p) && /Protein\s*10 g/.test(p) && /Carbs\s*50 g/.test(p) && /Fat\s*20 g/.test(p), 'C1: #prev2 kcal 400, P 10 g, C 50 g, F 20 g, got ' + p);
  check(t.includes('Nutrition facts'), 'C1: "Nutrition facts" heading');
  eq(await rows(), exp1, 'C1');
  check(!/Not recorded/.test(await facts()), 'C1: no "Not recorded"');
  console.log('C1 facts: ' + JSON.stringify(await facts()));
  await checkLayout('C1 amount');
  console.log('screenshot: ' + await screenshot('item-facts-c1'));
  await setAmt(50); eq(await rows(), { Fiber: '3.5 g', Sugars: '6 g', 'Saturated fat': '1.5 g', Sodium: '250 mg', Cholesterol: '10 mg' }, 'C2 at 50 g');
  await setAmt(250); eq(await rows(), { Fiber: '17.5 g', Sugars: '30 g', 'Saturated fat': '7.5 g', Sodium: '1250 mg', Cholesterol: '50 mg' }, 'C2 at 250 g');
  p = await prev(); check(/1000/.test(p), 'C2: kcal at 250 g reads 1000, got ' + p);
  await setAmt(0.1); const r5 = await rows(); console.log('C5 facts: ' + JSON.stringify(r5));
  check(r5.Cholesterol.endsWith('<0.1 mg'), 'C5: Cholesterol "<0.1 mg", got ' + r5.Cholesterol);
  check(r5.Fiber.endsWith('<0.1 g'), 'C5: Fiber "<0.1 g", got ' + r5.Fiber);
  check(r5.Sodium === 'Sodium 0.5 mg', 'C5: Sodium "0.5 mg", got ' + r5.Sodium);

  // C3
  await start(); await openAmount('Plain thing', 'Plain thing');
  await page.selectOption('#unit', 'w:g'); await setAmt(100);
  p = await prev(); t = await dlgText();
  check(/200/.test(p) && /Protein\s*5 g/.test(p) && /Carbs\s*30 g/.test(p) && /Fat\s*4 g/.test(p), 'C3: kcal and macros as before, got ' + p);
  check(t.includes('Nutrition facts'), 'C3: heading present');
  check(!LABELS.some(l => t.includes(l)), 'C3: none of the five row labels on screen');
  check(!/Not recorded/.test(t), 'C3: no "Not recorded"');
  console.log('C3 facts: ' + JSON.stringify(await facts()));
  check(await oneLine() === 1, 'C3: exactly one explanatory line, got ' + await oneLine());

  // C4
  await start(); await openAmount('Half bar', 'Half bar');
  await page.selectOption('#unit', 'w:g'); await setAmt(100);
  const r4 = await rows(); console.log('C4 facts: ' + JSON.stringify(r4));
  check(r4.Fiber === 'Fiber 0 g', 'C4: Fiber "0 g", got ' + r4.Fiber);
  check(r4.Sodium === 'Sodium 400 mg', 'C4: Sodium "400 mg", got ' + r4.Sodium);
  for (const l of ['Sugars', 'Saturated fat', 'Cholesterol']) check(r4[l] === l + ' Not recorded', `C4: ${l} Not recorded, got ${r4[l]}`);
  await checkLayout('C4 amount');
  console.log('screenshot: ' + await screenshot('item-facts-c4'));

  // C6 + C11 (custom food, no barcode)
  await start({}, [{ name: 'Home soup', brand: '', source: 'Custom', per100: { k: 50, p: 2, c: 6, f: 1 }, servingG: 0, servingLabel: '' }]);
  await page.click('[data-add="Lunch"]');
  await page.fill('#q', 'Home soup');
  await page.locator('#results .res', { hasText: 'Home soup' }).first().click();
  await page.waitForSelector('#amt');
  await page.selectOption('#unit', 'w:g'); await setAmt(100);
  p = await prev(); t = await dlgText();
  check(/50/.test(p) && /Protein\s*2 g/.test(p) && /Carbs\s*6 g/.test(p) && /Fat\s*1 g/.test(p), 'C6: kcal/macros as before, got ' + p);
  check(!LABELS.some(l => t.includes(l)) && !/Not recorded/.test(t), 'C6: no row labels, no Not recorded');
  check(await oneLine() === 1, 'C6: single honest line: ' + JSON.stringify(await facts()));
  check(!/Barcode/.test(t), 'C11: custom food without a barcode shows no Barcode line');
  await setAmt(100); await page.click('#addGo'); await page.waitForSelector('#meals .entry');
  let st = await stored(), ents = Object.values(st.days).flat();
  check(ents.length === 1 && !('barcode' in ents[0]), 'C11: saved custom entry has no barcode key');

  // C7
  const SAVED = { id: 's', meal: 'Lunch', name: 'Saved bar', brand: '', source: '', per100: { k: 100, p: 1, c: 1, f: 1 }, grams: 200, unitKey: 'w:g', amount: 200, nut: { fiber: 3, sugars: 4, satFat: 5, sodium: 600, cholesterol: 70 } };
  const OLD = { id: 'o', meal: 'Lunch', name: 'Old oat', brand: '', source: '', per100: { k: 380, p: 13, c: 66, f: 7 }, grams: 50, unitKey: 'w:g', amount: 50 };
  await start({ [TODAY]: [SAVED, OLD] });
  await page.locator('#meals .entry', { hasText: 'Saved bar' }).click(); await page.waitForSelector('#eName');
  check(await page.locator('#addGo', { hasText: 'Save changes' }).count() === 1, 'C7: Edit entry screen opened');
  eq(await rows(), { Fiber: '6 g', Sugars: '8 g', 'Saturated fat': '10 g', Sodium: '1200 mg', Cholesterol: '140 mg' }, 'C7 at 200 g');
  await checkLayout('C7 edit');
  await setAmt(100); eq(await rows(), { Fiber: '3 g', Sugars: '4 g', 'Saturated fat': '5 g', Sodium: '600 mg', Cholesterol: '70 mg' }, 'C7 at 100 g');
  await page.click('#dClose');
  await page.locator('#meals .entry', { hasText: 'Old oat' }).click(); await page.waitForSelector('#eName');
  t = await dlgText();
  check(!LABELS.some(l => t.includes(l)) && !/Not recorded/.test(t) && await oneLine() === 1, 'C7: Old oat shows the single honest line only, got ' + JSON.stringify(await facts()));
  await page.click('#dClose');

  // C8
  await start(); await openAmount('Test bar', 'Test bar');
  await page.selectOption('#unit', 'w:g'); await setAmt(100); await page.click('#addGo'); await page.waitForSelector('#meals .entry');
  await page.click('#summary');
  const dd = {};
  for (const l of LABELS) dd[l] = (await page.locator('#dBody .row').filter({ has: page.locator('span', { hasText: new RegExp('^' + l + '$') }) }).first().innerText()).replace(/\s+/g, ' ');
  console.log('C8 day rows: ' + JSON.stringify(dd));
  for (const l of LABELS) check(dd[l].includes(exp1[l]), `C8: day page ${l} "${exp1[l]}", got "${dd[l]}"`);
  await page.keyboard.press('Escape');

  // C9: scanned code kept
  await start(); await page.click('[data-add="Lunch"]');
  await page.fill('#q', '810030518914'); await page.click('#goSearch');
  await page.waitForSelector('#results .res', { timeout: 10000 });
  await page.locator('#results .res', { hasText: 'Test bar' }).first().click(); await page.waitForSelector('#amt');
  t = await dlgText();
  check(t.includes('Barcode 810030518914') && !t.includes('0810030518914'), 'C9: amount screen shows "Barcode 810030518914", not padded, got ' + (t.match(/Barcode\s*\d*/) || ['none'])[0]);
  console.log('screenshot: ' + await screenshot('item-facts-c9'));
  await page.selectOption('#unit', 'w:g'); await setAmt(100);
  await page.click('#addGo'); await page.waitForSelector('#meals .entry');
  await page.locator('#meals .entry').first().click(); await page.waitForSelector('#eName');
  check((await dlgText()).includes('Barcode 810030518914'), 'C9: Edit entry shows "Barcode 810030518914"');
  await page.click('#dClose');
  st = await stored(); ents = Object.values(st.days).flat();
  check(ents[0] && ents[0].barcode === '810030518914', 'C9: entry barcode in storage, got ' + (ents[0] && ents[0].barcode));
  check(st.recent[0] && st.recent[0].barcode === '810030518914', 'C9: recent[0] barcode in storage, got ' + (st.recent[0] && st.recent[0].barcode));

  // C10: text search with a code, no scan
  await start(); await openAmount('Test bar', 'Test bar');
  check((await dlgText()).includes('Barcode 810030518914'), 'C10: text-search result shows "Barcode 810030518914"');

  // C11: OFF product with no code
  await start(); await openAmount('Plain thing', 'Plain thing');
  check(!/Barcode/.test(await dlgText()), 'C11: no "Barcode" text for a product without a code');
  await setAmt(100); await page.click('#addGo'); await page.waitForSelector('#meals .entry');
  st = await stored(); ents = Object.values(st.days).flat();
  check(ents.length === 1 && !('barcode' in ents[0]) && !('barcode' in st.recent[0]), 'C11: saved entry and recent have no barcode key');

  // C12: hostile code
  const evil = '<img src=x onerror=alert(1)>';
  await start({ [TODAY]: [{ id: 'e', meal: 'Lunch', name: 'Odd', brand: '', source: '', per100: { k: 100, p: 1, c: 1, f: 1 }, grams: 100, unitKey: 'w:g', amount: 100, barcode: evil }] });
  await page.reload(); await page.waitForSelector('#summary');
  await page.locator('#meals .entry', { hasText: 'Odd' }).click(); await page.waitForSelector('#amt');
  t = await dlgText();
  check(!/Barcode/.test(t), 'C12: no Barcode line');
  check(await page.locator('#dlg img').count() === 0, 'C12: no img element in the dialog');
  check(dialogs.length === 0, 'C12: no alert fired');
  check(t.includes('Odd'), 'C12: entry opens normally');

  check(errs.length === 0, 'no page errors: ' + errs);
};
