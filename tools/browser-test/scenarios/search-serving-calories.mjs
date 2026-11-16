// docs/specs/search-serving-calories.md headless checklist C1..C11. USDA and Open Food Facts are answered by page.route handlers below (invented data);
// they sit on top of the runner's own blocking route, so any other external request is still aborted.
export const allowConsoleErrors = true;   // the stubbed 429 / 500 answers are logged by the browser itself
const KEY = 'macrodiary.v1';
const nut = (k, p, c, f) => [{ nutrientNumber: '208', unitName: 'KCAL', value: k }, { nutrientNumber: '203', value: p }, { nutrientNumber: '205', value: c }, { nutrientNumber: '204', value: f }];
const gen = (id, description, k, p = 0, c = 0, f = 0) => ({ description, fdcId: id, dataType: 'Foundation', foodNutrients: nut(k, p, c, f) });
const portion = (modifier, gramWeight) => ({ amount: 1, measureUnit: { name: 'undetermined' }, modifier, gramWeight });
const BANANA = gen(910001, 'Banana test, raw', 89, 1.1, 22.8, 0.3), APPLE = gen(910002, 'Apple test, raw', 52, 0.3, 13.8, 0.2);
const BAR = { description: 'Test Bar', brandOwner: 'Acme', fdcId: 910003, dataType: 'Branded', servingSize: 50, servingSizeUnit: 'g', householdServingFullText: '1 bar', foodNutrients: nut(400, 10, 40, 20) };
const eight = Array.from({ length: 8 }, (_, i) => gen(920001 + i, 'Eight test ' + (i + 1), 100 + i));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async ({ page, url, check, screenshot }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  let world, log, inflight, maxInflight, usdaHits, errs;
  const reset = w => { world = w; log = []; inflight = 0; maxInflight = 0; usdaHits = []; };
  await page.route(/api\.nal\.usda\.gov/, async route => {
    const u = route.request().url(); usdaHits.push(u);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.includes('/foods/search')) {
      const q = decodeURIComponent((u.match(/query=([^&]*)/) || [])[1] || '');
      const s = world.search[q] || { generic: [], branded: [] };
      return json({ foods: u.includes('dataType=Branded') ? s.branded : s.generic });
    }
    const id = +(u.match(/\/food\/(\d+)/) || [])[1];
    log.push(id); inflight++; maxInflight = Math.max(maxInflight, inflight);
    const d = world.detail[id] || {};
    try {
      await sleep(d.delay ?? world.delay ?? 0);
      if (d.status) return await json({ error: 'x' }, d.status);
      return await json({ foodPortions: d.portions || [] });
    } finally { inflight--; }
  });
  await page.route(/openfoodfacts\.org/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 0, count: 0, products: [] }) }));

  const start = async (w, seed) => {
    reset(w);
    await page.goto(url + '/index.html');
    await page.evaluate(([k, s]) => { localStorage.clear(); if (s) localStorage.setItem(k, JSON.stringify(s)); }, [KEY, seed || null]);
    await page.reload();
    await page.locator('button', { hasText: '+ Add' }).first().click();
  };
  const search = async q => { await page.fill('#q', q); await page.click('#goSearch'); };
  const row = name => page.locator('#results .res').filter({ hasText: name }).first();
  const rowText = async name => (await row(name).innerText()).replace(/\s+/g, ' ').trim();
  const waitText = async (name, re, ms = 6000) => { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { t = (await row(name).count()) ? await rowText(name) : ''; if (re.test(t)) return t; await sleep(100); } return t; };
  const names = () => page.locator('#results .res .nm > div:first-child').allInnerTexts();
  const count = id => log.filter(x => x === id).length;
  const toastShown = async () => page.evaluate(() => { const t = document.getElementById('toast'); return !!t && t.offsetParent !== null && (t.className || '').includes('show') ? t.textContent : ''; });

  const std = { search: { test: { generic: [BANANA, APPLE], branded: [BAR] } }, detail: { 910001: { portions: [{ amount: 1, measureUnit: { name: 'cup' }, modifier: 'sliced', gramWeight: 150 }, portion('medium', 118)] }, 910002: { portions: [portion('large', 200)] } } };

  // C1
  await start(std);
  await search('test');
  await page.waitForSelector('#results .res');
  const bar = await rowText('Test Bar');
  check(bar.includes('200 kcal per 1 bar · 400 kcal /100g'), 'C1: Test Bar row, got ' + bar);
  const b1 = await waitText('Banana test', /105 kcal per medium \(118 g\) · 89 kcal \/100g · P1\.1 C22\.8 F0\.3/);
  check(/105 kcal per medium \(118 g\) · 89 kcal \/100g · P1\.1 C22\.8 F0\.3/.test(b1), 'C1: Banana figure arrives, got ' + b1);
  const a1 = await waitText('Apple test', /104 kcal per large \(200 g\)/);
  check(a1.includes('104 kcal per large (200 g) · 52 kcal /100g · P0.3 C13.8 F0.2'), 'C1: Apple row, got ' + a1);
  const order = await names();
  check(order.join('|') === 'Banana test, raw|Apple test, raw|Test Bar', 'C1: order, got ' + order.join('|'));
  check((await page.inputValue('#q')) === 'test', 'C1: #q still test');
  await screenshot('c1-rows');

  // C2 (same page state as C1)
  await row('Banana test').click();
  await sleep(1200);
  const dlg = await page.innerText('#dlg');
  check(!dlg.includes('Loading cups, tablespoons and other measures'), 'C2: no loading text on amount screen');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#dlg option')].map(o => o.textContent.trim()).join('|') + '#' + document.getElementById('dlg').innerText);
  check(opts.includes('medium (118 g)'), 'C2: unit list has medium (118 g), got ' + opts.slice(0, 300));
  check(count(910001) === 1, 'C2: exactly one /food/910001 request, got ' + count(910001));
  await screenshot('c2-amount');

  // C4 (new search of the same foods, same page load, so the session cache is live): reopen search from C1 state
  await page.evaluate(() => document.getElementById('dlg').close());
  await page.locator('button', { hasText: '+ Add' }).first().click();
  const before = log.length;
  await search('test');
  await page.waitForSelector('#results .res');
  await sleep(1000);
  const b4 = await rowText('Banana test'), a4 = await rowText('Apple test');
  check(log.length === before && count(910001) === 1 && count(910002) === 1, 'C4: no new detail requests, log ' + JSON.stringify(log));
  check(b4.includes('105 kcal per medium (118 g)') && a4.includes('104 kcal per large (200 g)'), 'C4: figures as before, got ' + b4 + ' / ' + a4);

  // C3
  await start({ search: { test: { generic: eight, branded: [] } }, detail: {}, delay: 300 });
  await search('test');
  await page.waitForSelector('#results .res');
  await sleep(2500);
  check(log.length === 5 && log.join(',') === '920001,920002,920003,920004,920005', 'C3: detail requests 920001..920005 only, got ' + log.join(','));
  check(maxInflight <= 2 && maxInflight >= 1, 'C3: max outstanding <= 2, got ' + maxInflight);
  const r6 = await rowText('Eight test 6');
  check(!r6.includes(' per ') && r6.includes('/100g'), 'C3: row 6 only /100g, got ' + r6);

  // C5
  await start({
    search: { test: { generic: eight, branded: [] }, other: { generic: [gen(930001, 'Other test', 100)], branded: [] } },
    detail: { 920001: { delay: 2000 }, 930001: { portions: [portion('slice', 30)] } }, delay: 300 });
  await search('test');
  await page.fill('#q', 'other'); await page.click('#goSearch');
  await waitText('Other test', /Other test/);
  await sleep(3000);
  const n5 = await names();
  check(n5.length === 1 && n5[0] === 'Other test', 'C5: only Other test listed, got ' + n5.join('|'));
  const o5 = await rowText('Other test');
  check(o5.includes('30 kcal per slice (30 g) · 100 kcal /100g · P0 C0 F0'), 'C5: Other row, got ' + o5);

  // C6
  await start({ search: { test: { generic: eight, branded: [] } }, detail: { 920001: { status: 429 }, 920002: { status: 429 } }, delay: 200 });
  await search('test');
  await page.waitForSelector('#results .res');
  await sleep(2000);
  check(log.length >= 1 && log.length <= 2, 'C6: at most 2 detail requests, got ' + log.length);
  const texts = (await page.locator('#results .res').allInnerTexts()).join(' ');
  check(!/ per /.test(texts), 'C6: rows still /100g only');
  check(!/rate limit|error|fail/i.test(await page.innerText('#results')), 'C6: no error text in results: ' + (await page.innerText('#results')).slice(0, 200));
  check(!(await toastShown()), 'C6: no toast');
  await row('Eight test 1').click();
  await page.waitForSelector('#dlg #amt, #dlg input', { timeout: 5000 });
  check(/Eight test 1/.test(await page.innerText('#dlg')), 'C6: click opens the amount screen');

  // C7
  await start({ ...std, detail: { ...std.detail, 910001: { status: 500 } } });
  await search('test');
  await waitText('Apple test', /104 kcal per large/);
  const b7 = await rowText('Banana test'), a7 = await rowText('Apple test');
  check(/89 kcal \/100g · P1\.1 C22\.8 F0.3( USDA)?$/.test(b7) && !b7.includes(' per '), 'C7: Banana stays /100g, got ' + b7);
  check(a7.includes('104 kcal per large (200 g)'), 'C7: Apple gains its figure, got ' + a7);
  check(!(await toastShown()), 'C7: no toast');

  // C8
  await start(std, { schemaVersion: 13, useUSDA: false, useOFF: true });
  await search('test');
  await sleep(1500);
  check(usdaHits.length === 0, 'C8: zero USDA requests, got ' + usdaHits.length);

  // C9
  dialogs.length = 0;
  await start({ ...std, detail: { ...std.detail, 910001: { portions: [portion('<img src=x onerror=alert(1)>', 118)] } } });
  await search('test');
  await waitText('Apple test', /104 kcal per large/);
  await sleep(500);
  check((await page.locator('#results img').count()) === 0, 'C9: no img inside #results');
  const b9 = await rowText('Banana test');
  check(dialogs.length === 0, 'C9: no JS dialog, got ' + dialogs.join(','));
  check(!b9.includes('<'), 'C9: no raw markup in row text: ' + b9);
  console.log('C9 info: Banana row text = ' + b9);

  // C10
  await start({ ...std, delay: 1000 });
  await search('test');
  await page.waitForSelector('#results .res');
  const before10 = (await names()).join('|');
  await page.locator('#q').pressSequentially('x');
  check((await page.inputValue('#q')).length === 5 && (await page.inputValue('#q')).includes('x'), 'C10: typed text kept, got ' + await page.inputValue('#q'));
  // the typed text filters nothing in database results; figures must still arrive
  const b10 = await waitText('Banana test', /105 kcal per medium \(118 g\)/, 8000);
  check(b10.includes('105 kcal per medium (118 g)'), 'C10: figure still arrives, got ' + b10);
  check((await names()).join('|') === before10, 'C10: order unchanged, got ' + (await names()).join('|'));
  check((await page.inputValue('#q')).length === 5 && (await page.inputValue('#q')).includes('x'), 'C10: typed text kept after figures');

  // C11
  const seed = { schemaVersion: 13, useUSDA: true, useOFF: true, custom: [
    { id: 'f-0123456789abcdef', name: 'Home Bar', brand: '', source: '', per100: { k: 250, p: 5, c: 30, f: 10 }, servingG: 0, servingLabel: '', portions: [{ label: 'slice', g: 40 }] },
    { id: 'f-0123456789abcde0', name: 'Home Serve', brand: '', source: '', per100: { k: 300, p: 5, c: 30, f: 10 }, servingG: 50, servingLabel: '1 pot' }] };
  await start({ search: {}, detail: {} }, seed);
  await page.fill('#q', 'home');
  await sleep(500);
  const h1 = await rowText('Home Bar'), h2 = await rowText('Home Serve');
  check(h1.includes('100 kcal per slice (40 g) · 250 kcal /100g'), 'C11: Home Bar, got ' + h1);
  check(h2.includes('150 kcal per 1 pot · 300 kcal /100g'), 'C11: custom with servingG shows serving text, got ' + h2);
  await screenshot('c11-local');
};
