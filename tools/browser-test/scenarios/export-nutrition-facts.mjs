// Extra nutrients in the exports (docs/specs/export-nutrition-facts.md, checklist C1..C6). Open Food Facts is stubbed with invented products.
const prod = (name, nutriments, code) => ({ product_name: name, brands: 'Acme', serving_quantity: 50, serving_size: '1 bar (50 g)', ...(code ? { code } : {}), nutriments });
const FULL = { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20, fiber_100g: 7, sugars_100g: 12, 'saturated-fat_100g': 3, sodium_100g: 0.5, cholesterol_100g: 0.02 };
const PLAIN = { 'energy-kcal_100g': 200, proteins_100g: 5, carbohydrates_100g: 30, fat_100g: 4 };
export const stubs = [
  { match: /search_terms=Test%20bar/, json: { products: [prod('Test bar', FULL, '810030518914')] } },
  { match: /search_terms=Plain%20thing/, json: { products: [prod('Plain thing', PLAIN)] } },
];

const pad = n => String(n).padStart(2, '0');
const d0 = new Date(); const TODAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
const seed = days => ({ schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', useUSDA: false, useOFF: true,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 0, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days });

// Minimal RFC-4180 parser (quotes, doubled quotes, CRLF/LF).
const parseCSV = text => {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
};
const ENT_TAIL = ['Fiber (g)', 'Sugars (g)', 'Saturated fat (g)', 'Sodium (mg)', 'Cholesterol (mg)'];
const SUM_TAIL = [...ENT_TAIL, 'Items logged', 'Fiber items', 'Sugars items', 'Saturated fat items', 'Sodium items', 'Cholesterol items'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text() + ' ' + (m.location().url || '')); });
  const start = async (days = {}) => {
    await page.goto(url + '/index.html');
    await page.evaluate(s => localStorage.setItem('macrodiary.v1', JSON.stringify(s)), seed(days));
    await page.reload(); await page.waitForSelector('#summary');
  };
  const addFood = async (query, grams) => {
    await page.click('[data-add="Lunch"]');
    await page.fill('#q', query); await page.click('#goSearch');
    await page.waitForSelector('#results .res', { timeout: 10000 });
    await page.locator('#results .res', { hasText: query }).first().click();
    await page.waitForSelector('#amt');
    await page.selectOption('#unit', 'w:g'); await page.fill('#amt', String(grams));
    await page.click('#addGo'); await page.waitForSelector('#meals .entry');
  };
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
  const openExport = async () => {
    await page.click('[data-tab="more"]'); await page.click('#moreExport');
    await page.waitForSelector('#xEntries', { state: 'visible' });
    await page.selectOption('#xKind', { label: 'Daily' }).catch(() => page.selectOption('#xKind', 'day'));
    await page.fill('#xDate', TODAY); await page.dispatchEvent('#xDate', 'change');
  };
  const csv = f => parseCSV(f.text.replace(/^﻿/, '')).filter(r => r.length > 1 || r[0] !== '');
  const rowOf = (rows, name) => rows.find(r => r[2] === name);

  // C1
  await start(); await addFood('Test bar', 200);
  await openExport();
  const e1 = await grab(() => page.click('#xEntries'));
  console.log('C1 file: ' + e1.name + '\n' + e1.text);
  let rows = csv(e1);
  check(e1.name.startsWith('macro-diary-entries-day-'), 'C1: file name starts macro-diary-entries-day-, got ' + e1.name);
  check(rows[0].length === 17 && same(rows[0].slice(-5), ENT_TAIL), 'C1: header 17 columns ending with the five nutrient names, got ' + rows[0].length + ' ' + JSON.stringify(rows[0].slice(-5)));
  let tb = rowOf(rows, 'Test bar');
  check(tb && tb[7] === '800', 'C1: Test bar Calories 800, got ' + (tb && tb[7]));
  check(tb && same(tb.slice(-5), ['14', '24', '6', '1000', '40']), 'C1: Test bar last five 14,24,6,1000,40, got ' + (tb && JSON.stringify(tb.slice(-5))));

  // C2
  await page.click('[data-tab="diary"]').catch(() => {});
  await page.goto(url + '/index.html'); await page.waitForSelector('#summary');
  await addFood('Plain thing', 100);
  await openExport();
  const e2 = await grab(() => page.click('#xEntries'));
  console.log('C2 file:\n' + e2.text);
  rows = csv(e2); tb = rowOf(rows, 'Test bar'); const pt = rowOf(rows, 'Plain thing');
  check(!!pt && pt.length === 17 && same(pt.slice(-5), ['', '', '', '', '']), 'C2: Plain thing five empty trailing cells, got ' + (pt && JSON.stringify(pt.slice(-5))));
  check(!!pt && /,,,,,\s*$/.test(e2.text.split(/\r?\n/).find(l => l.includes('Plain thing'))), 'C2: Plain thing line ends ,,,,,');
  check(tb && same(tb.slice(-5), ['14', '24', '6', '1000', '40']) && tb[7] === '800', 'C2: Test bar row as in C1, got ' + (tb && JSON.stringify(tb.slice(7))));

  // C3
  const s3 = await grab(() => page.click('#xSummary'));
  console.log('C3 file (' + s3.name + '):\n' + s3.text);
  rows = csv(s3);
  check(rows[0].length === 18 && same(rows[0].slice(-11), SUM_TAIL), 'C3: summary header 18 columns ending as specified, got ' + rows[0].length + ' ' + JSON.stringify(rows[0].slice(-11)));
  check(rows.length === 2 && same(rows[1].slice(-11), ['14', '24', '6', '1000', '40', '2', '1', '1', '1', '1', '1']), 'C3: data row ends 14,24,6,1000,40,2,1,1,1,1,1, got ' + JSON.stringify(rows[1] && rows[1].slice(-11)));

  // C4
  const j = await grab(() => page.click('#xJson'));
  console.log('C4 file (' + j.name + '):\n' + j.text);
  let doc = null; try { doc = JSON.parse(j.text.replace(/^﻿/, '')); } catch (e) { check(false, 'C4: JSON parses: ' + e); }
  const list = doc && doc.days && doc.days[TODAY];
  check(Array.isArray(list) && list.length === 2, 'C4: days[today] has two entries, got ' + (list && list.length));
  const jt = list && list.find(e => e.name === 'Test bar'), jp = list && list.find(e => e.name === 'Plain thing');
  check(jt && same(jt.nut, { fiber: 7, sugars: 12, satFat: 3, sodium: 500, cholesterol: 20 }), 'C4: Test bar nut per 100 g, got ' + (jt && JSON.stringify(jt.nut)));
  check(jt && same(jt.nutTotal, { fiber: 14, sugars: 24, satFat: 6, sodium: 1000, cholesterol: 40 }), 'C4: Test bar nutTotal, got ' + (jt && JSON.stringify(jt.nutTotal)));
  check(jp && !('nutTotal' in jp) && !('nut' in jp), 'C4: Plain thing has no nutTotal and no nut, keys ' + (jp && Object.keys(jp)));

  // C6 (state of C2, still on the export screen)
  await page.reload(); await page.waitForSelector('#summary');
  await openExport();
  const ths = await page.locator('#xTable th').allInnerTexts();
  const stats = await page.innerText('#xStats'), table = await page.innerText('#xTable');
  console.log('C6 th: ' + JSON.stringify(ths) + ' stats: ' + JSON.stringify(stats.replace(/\s+/g, ' ')));
  check(same(ths.map(s => s.trim()), ['Day', 'kcal', 'P', 'C', 'F', '']), 'C6: table headers Day,kcal,P,C,F,"" got ' + JSON.stringify(ths));
  check(await page.locator('#xStats .stats > div').filter({ hasText: 'Days logged' }).locator('b').innerText() === '1', 'C6: Days logged 1');
  check(!/Fiber|Sodium|Cholesterol/i.test(stats + table), 'C6: no Fiber/Sodium/Cholesterol in #xStats or #xTable');
  console.log('screenshot: ' + await screenshot('export-nutrition-c6'));

  // C5
  const toast = { id: 't', meal: 'Lunch', name: 'Plain toast', brand: '', source: '', per100: { k: 250, p: 8, c: 45, f: 3 }, grams: 50, unitKey: 'w:g', amount: 50 };
  await start({ [TODAY]: [toast] });
  await openExport();
  const e5 = await grab(() => page.click('#xEntries'));
  rows = csv(e5);
  check(rows[0].length === 17, 'C5: entries header 17 columns, got ' + rows[0].length);
  check(rows.length === 2 && rows[1].length === 17 && same(rows[1].slice(-5), ['', '', '', '', '']) && /,,,,,\s*$/.test(e5.text.split(/\r?\n/).filter(Boolean).pop()), 'C5: entries row ends ,,,,,  got ' + JSON.stringify(rows[1]));
  const s5 = await grab(() => page.click('#xSummary'));
  console.log('C5 summary:\n' + s5.text);
  rows = csv(s5);
  check(rows[0].length === 18, 'C5: summary header 18 columns, got ' + rows[0].length);
  check(same(rows[1].slice(-11), ['', '', '', '', '', '1', '0', '0', '0', '0', '0']), 'C5: summary row ends ,,,,,,1,0,0,0,0,0 got ' + JSON.stringify(rows[1].slice(-11)));
  check(/,,,,,,1,0,0,0,0,0\s*$/.test(s5.text.split(/\r?\n/).filter(Boolean).pop()), 'C5: raw summary line ends ,,,,,,1,0,0,0,0,0');

  await page.goto(url + '/index.html'); await page.waitForSelector('.tabs');
  check(errs.length === 0, 'no page or console errors: ' + errs.join(' | '));
};
