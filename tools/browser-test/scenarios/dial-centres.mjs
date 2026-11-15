// docs/specs/dial-centres.md headless checklist H1..H10 (centre number + caption inside every Diary dial). All data seeded into localStorage; no network.
// Screenshots go to the runner's temp folder, and also to DIAL_CENTRES_SHOTS=<folder> when set.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = shift(0), YEST = shift(-1);
const KEY = 'macrodiary.v1';
const RICE = grams => ({ id: 'e1', meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, grams, updatedAt: 1 });
const ACT = { updatedAt: 1, source: 'google-health', steps: 6120, sleepMinutes: 473 };
const ALL = ['k', 'p', 'c', 'f', 'steps', 'sleep'];
const GOALS = { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8, waterCups: 8 };
const seed = (o = {}) => ({
  schemaVersion: 13, theme: 'light', weightUnit: 'g', measures: {}, dials: ALL,
  goals: { ...GOALS }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 5, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [RICE(800)] }, activity: { [TODAY]: ACT }, ...o,
});
const act = (steps, sleepMinutes) => ({ [TODAY]: { updatedAt: 1, source: 'google-health', steps, sleepMinutes } });

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  const fails = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  shot: ' + await screenshot('dial-centres-' + id + '-failed')); } catch { /* ignore */ } }
  };
  const shot = async name => {
    const p = await screenshot(name);
    if (process.env.DIAL_CENTRES_SHOTS) { mkdirSync(process.env.DIAL_CENTRES_SHOTS, { recursive: true }); const f = join(process.env.DIAL_CENTRES_SHOTS, name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; }
    return p;
  };
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(s)]);
    await page.reload(); await page.waitForSelector('#dials #dialsEdit');
  };
  const centres = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#dials [data-dial]')].map(d => [d.dataset.dial, {
    n: d.querySelectorAll('svg text.dial-num').length, c: d.querySelectorAll('svg text.dial-cap').length,
    num: (d.querySelector('svg text.dial-num') || {}).textContent, cap: (d.querySelector('svg text.dial-cap') || {}).textContent,
    small: !!d.querySelector('svg text.dial-num-s'),
    name: d.querySelector('.dial-name').textContent, val: d.querySelector('b').textContent.replace(/\s+/g, ' ').trim(),
    aria: d.querySelector('[aria-label]').getAttribute('aria-label'),
  }])));
  const expectC = (tag, got, exp) => {
    for (const [k, [num, cap]] of Object.entries(exp)) {
      const g = got[k];
      check(!!g && g.n === 1 && g.c === 1, `${tag}: ${k} one number + one caption (${g && g.n}/${g && g.c})`);
      check(g.num === num && g.cap === cap, `${tag}: ${k} expected "${num}" / "${cap}", saw "${g.num}" / "${g.cap}"`);
    }
  };
  const geom = () => page.evaluate(() => {
    const out = { sw: document.documentElement.scrollWidth, vw: window.innerWidth, dials: {} };
    const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const R = r => ({ l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
    for (const d of document.querySelectorAll('#dials [data-dial]')) {
      const svg = d.querySelector('svg'), sr = svg.getBoundingClientRect(), k = Math.min(sr.width, sr.height) / 100;
      const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2, inner = 37.5 * k;
      const num = d.querySelector('svg text.dial-num'), cap = d.querySelector('svg text.dial-cap');
      const nr = num.getBoundingClientRect(), cr = cap.getBoundingClientRect();
      const far = r => Math.max(...[[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      const nm = d.querySelector('.dial-name').getBoundingClientRect(), vb = d.querySelector('b').getBoundingClientRect();
      out.dials[d.dataset.dial] = {
        svg: R(sr), scale: +k.toFixed(3), innerR: +inner.toFixed(1), num: R(nr), cap: R(cr),
        numFarthest: +far(nr).toFixed(1), capFarthest: +far(cr).toFixed(1),
        numInside: far(nr) <= inner + 1, capInside: far(cr) <= inner + 1,
        numCapOverlap: inter(nr, cr), nameOverlapSvg: inter(nm, sr) || inter(vb, sr),
        numFont: getComputedStyle(num).fontSize, capFont: getComputedStyle(cap).fontSize,
        numTextW: +num.getComputedTextLength().toFixed(1) * 1, small: num.classList.contains('dial-num-s'),
        numBoxHalfW: +(nr.width / 2).toFixed(1),
      };
    }
    return out;
  });
  const fitCheck = (tag, g) => {
    check(g.sw <= g.vw, `${tag}: scrollWidth ${g.sw} > ${g.vw}`);
    for (const [k, d] of Object.entries(g.dials)) {
      check(d.numInside, `${tag}: ${k} number box leaves the inner circle (farthest corner ${d.numFarthest} > ${d.innerR}+1) box ${JSON.stringify(d.num)}`);
      check(d.capInside, `${tag}: ${k} caption box leaves the inner circle (farthest corner ${d.capFarthest} > ${d.innerR}+1) box ${JSON.stringify(d.cap)}`);
      check(!d.numCapOverlap, `${tag}: ${k} number and caption boxes intersect ${JSON.stringify([d.num, d.cap])}`);
      check(!d.nameOverlapSvg, `${tag}: ${k} name/value text intersects the svg box`);
    }
  };
  const report = (tag, g) => console.log(`  METRICS ${tag}: ` + JSON.stringify(Object.fromEntries(Object.entries(g.dials).map(([k, d]) => [k, { svg: [d.svg.w, d.svg.h], innerR: d.innerR, num: d.num, cap: d.cap, farN: d.numFarthest, farC: d.capFarthest, font: [d.numFont, d.capFont], small: d.small }]))));
  const shotAt = async (tag, name) => { const f = join(shotsDir, name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; };
  const shotsDir = process.env.DIAL_CENTRES_SHOTS || process.cwd();
  if (process.env.DIAL_CENTRES_SHOTS) mkdirSync(shotsDir, { recursive: true });
  const take = async (tag, name) => console.log(`  shot ${tag}: ` + (process.env.DIAL_CENTRES_SHOTS ? await shotAt(tag, name) : await screenshot(name)));
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const html = async () => (await page.locator('#dials').innerHTML()) + ' ' + norm(await page.locator('#dials').innerText());

  const A_EXP = { k: ['1200', 'kcal left'], p: ['70', 'g left'], c: ['40', 'g left'], f: ['25', 'g left'], steps: ['6.1k/10k', 'steps'], sleep: ['7.9/8h', 'sleep'] };
  const dev = async (w, h) => page.setViewportSize({ width: w, height: h });

  await item('H1', async () => {
    await dev(375, 800); await start(seed());
    const g = await centres();
    expectC('C-H1', g, A_EXP);
    const names = { k: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat', steps: 'Steps', sleep: 'Sleep' };
    const vals = { k: '800 / 2000 kcal', p: '80 / 150 g', c: '160 / 200 g', f: '40 / 65 g', steps: '6,120 / 10,000', sleep: '7 h 53 min / 8 h' };
    const labs = { k: 'Calories: 800 of 2000 kcal', p: 'Protein: 80 of 150 g', c: 'Carbs: 160 of 200 g', f: 'Fat: 40 of 65 g', steps: 'Steps: 6,120 of 10,000', sleep: 'Sleep: 7 h 53 min of 8 h' };
    for (const k of ALL) {
      check(g[k].name === names[k] && g[k].val === vals[k], `H1: ${k} name/value "${g[k].name}" / "${g[k].val}"`);
      check(g[k].aria === labs[k], `H1: ${k} aria-label "${g[k].aria}"`);
    }
  });

  const sizes = [[375, 800], [320, 700]];
  await item('H2', async () => {
    for (const [w, h] of sizes) {
      await dev(w, h); await start(seed());
      const g = await geom(); report('H2@' + w, g); fitCheck('H2@' + w, g);
      await take('H2 ' + w, `dial-centres-${w}`);
    }
  });

  await item('H3', async () => {
    const run1 = seed({ goals: { ...GOALS, steps: 99499, sleepH: 9.5 }, activity: act(99499, 570) });
    const run2 = seed({ days: { [TODAY]: [RICE(1e12)] }, goals: { ...GOALS, steps: 1e15, sleepH: 1e12 }, activity: act(1e12, 1e12) });
    for (const [w, h] of sizes) {
      await dev(w, h);
      await start(run1);
      let c = await centres();
      check(c.steps.num === '99k/99k' && c.sleep.num === '9.5/9.5h', `H3 run1@${w}: steps "${c.steps.num}" sleep "${c.sleep.num}"`);
      let g = await geom(); report(`H3run1@${w}`, g); fitCheck(`H3 run1@${w}`, g);
      await take(`H3 run1 ${w}`, `dial-centres-longest-run1-${w}`);
      const n = errs.length;
      // Run 2 as seeded: the store's sanitiser clamps/drops absurd activity and goals on load (steps > 200000 and sleep out of range become "no data", goals fall back), so the spec's 99M+/99+ cannot arrive through localStorage.
      await start(run2);
      c = await centres();
      console.log(`  H3 run2 as seeded@${w}: steps "${c.steps.num}" sleep "${c.sleep.num}" p "${c.p.num}"/"${c.p.cap}" k "${c.k.num}"/"${c.k.cap}"`);
      check(c.p.num === '99999+' && c.p.cap === 'g over', `H3 run2@${w}: p "${c.p.num}"/"${c.p.cap}"`);
      g = await geom(); report(`H3run2@${w}`, g); fitCheck(`H3 run2 seeded@${w}`, g);
      // Largest values that survive the store (steps 200000 / goal 1000000, sleep 24 h / goal 24 h)
      await start(seed({ goals: { ...GOALS, steps: 1000000, sleepH: 24 }, activity: act(200000, 1440) }));
      c = await centres();
      console.log(`  H3 max-valid@${w}: steps "${c.steps.num}" sleep "${c.sleep.num}"`);
      g = await geom(); report(`H3max@${w}`, g); fitCheck(`H3 max-valid@${w}`, g);
      // The module's own hostile path: render the real ui with an unsanitised state straight into #dials.
      const raw = await page.evaluate(async ([today]) => {
        const { dialModel } = await import('/js/domain/dials.js'); const { dialsHtml } = await import('/js/ui/dials.js');
        const st = { goals: { k: 2000, p: 150, c: 200, f: 65, steps: 1e15, sleepH: 1e12 }, dials: ['k', 'p', 'c', 'f', 'steps', 'sleep'],
          days: { [today]: [{ id: 'e1', meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, grams: 1e12, updatedAt: 1 }] },
          activity: { [today]: { steps: 1e12, sleepMinutes: 1e12 } } };
        document.getElementById('dials').innerHTML = dialsHtml(dialModel(st, today), false);
        return true;
      }, [TODAY]);
      c = await centres();
      check(raw && c.steps.num === '99M+/99M+' && c.sleep.num === '99+/99+h' && c.p.num === '99999+' && c.p.cap === 'g over', `H3 raw-render@${w}: steps "${c.steps.num}" sleep "${c.sleep.num}" p "${c.p.num}"/"${c.p.cap}"`);
      g = await geom(); report(`H3raw@${w}`, g); fitCheck(`H3 raw-render@${w}`, g);
      const t = await html();
      check(!/NaN|Infinity|undefined|e\+/.test(t), `H3 raw@${w}: bad word in #dials`);
      check(errs.length === n, 'H3: page errors ' + errs.slice(n));
      await take(`H3 raw-render ${w}`, `dial-centres-longest-99M-${w}`);
    }
  });

  await item('H4', async () => {
    await dev(375, 800);
    await start(seed({ days: { [TODAY]: [RICE(2200)] }, activity: act(12400, 540) }));
    const c = await centres();
    expectC('H4', c, { p: ['70', 'g over'], c: ['240', 'g over'], f: ['45', 'g over'], k: ['200', 'kcal over'], steps: ['12k/10k', 'steps'], sleep: ['9/8h', 'sleep'] });
    const r = await page.evaluate(() => {
      const probe = document.createElement('i'); document.body.appendChild(probe);
      const col = v => { probe.style.color = ''; probe.style.color = v; return getComputedStyle(probe).color; };
      const over = col('var(--over)'), text = col('var(--text)');
      const res = [...document.querySelectorAll('#dials [data-dial]')].map(d => ({ k: d.dataset.dial, stroke: getComputedStyle(d.querySelector('.ring-arc')).stroke, numFill: getComputedStyle(d.querySelector('.dial-num')).fill, capFill: getComputedStyle(d.querySelector('.dial-cap')).fill, ariaOk: true }));
      probe.remove(); return { over, text, res };
    });
    for (const d of r.res) {
      check(d.stroke === r.over, `H4: ${d.k} arc stroke ${d.stroke} vs --over ${r.over}`);
      check(d.numFill !== r.over && d.capFill !== r.over, `H4: ${d.k} centre fill is the over colour (${d.numFill}, ${d.capFill})`);
    }
    console.log('  H4 info: --over ' + r.over + ', centre fills ' + JSON.stringify(r.res.map(d => [d.k, d.numFill, d.capFill])));
    check(!/over/.test(c.steps.num + c.steps.cap + c.sleep.num + c.sleep.cap), 'H4: steps/sleep centre has the word over');
    const g = await geom(); report('H4@375', g); fitCheck('H4@375', g);
    await take('H4 over 375', 'dial-centres-over-375');
    await dev(320, 700);
    const g2 = await geom(); report('H4@320', g2); fitCheck('H4@320', g2);
    await take('H4 over 320', 'dial-centres-over-320');
  });

  await item('H5', async () => {
    await dev(375, 800);
    await start(seed({ days: { [TODAY]: [RICE(1500)] } }));
    const c = await centres();
    expectC('H5', c, { p: ['0', 'g left'] });
    const red = await page.evaluate(() => {
      const probe = document.createElement('i'); document.body.appendChild(probe); probe.style.color = 'var(--over)'; const over = getComputedStyle(probe).color; probe.remove();
      const a = document.querySelector('#dials [data-dial="p"] .ring-arc'); return { over, stroke: a ? getComputedStyle(a).stroke : null };
    });
    check(red.stroke !== red.over, 'H5: p arc is red at exactly the goal ' + JSON.stringify(red));
  });

  await item('H6', async () => {
    const n = errs.length;
    await dev(375, 800);
    await start(seed({ goals: { k: 0, p: 0, c: 0, f: 0, steps: 0, sleepH: 0, waterCups: 8 } }));
    const c = await centres();
    expectC('H6', c, { k: ['800', 'kcal eaten'], p: ['80', 'g eaten'], c: ['160', 'g eaten'], f: ['40', 'g eaten'], steps: ['6.1k', 'steps'], sleep: ['7.9h', 'sleep'] });
    check(!/NaN|Infinity/.test(await html()), 'H6: NaN/Infinity');
    const g = await geom(); report('H6@375', g); fitCheck('H6@375', g);
    check(errs.length === n, 'H6: page errors ' + errs.slice(n));
  });

  await item('H7', async () => {
    await dev(375, 800);
    await start(seed({ activity: {} }));
    const c = await centres();
    expectC('H7', c, { steps: ['--', 'no data'], sleep: ['--', 'no data'] });
    check(c.steps.val === 'no data' && c.sleep.val === 'no data', `H7: value texts "${c.steps.val}" / "${c.sleep.val}"`);
    check(!/0\//.test(c.steps.num + c.sleep.num + c.steps.val + c.sleep.val), 'H7: "0/" present');
    const g = await geom(); report('H7@375', g); fitCheck('H7@375', g);
    await take('H7 no data 375', 'dial-centres-nodata-375');
    await dev(320, 700);
    const g2 = await geom(); fitCheck('H7@320', g2);
    await take('H7 no data 320', 'dial-centres-nodata-320');
    await dev(375, 800);
    await start(seed({ activity: act(0, 473) }));
    expectC('H7b', await centres(), { steps: ['0/10k', 'steps'] });
  });

  await item('H8', async () => {
    await dev(375, 800);
    for (const [s, exp] of [[2350, '2.4k/10k'], [2300, '2.3k/10k'], [850, '850/10k']]) {
      await start(seed({ activity: act(s, 473) }));
      expectC('H8 ' + s, await centres(), { steps: [exp, 'steps'] });
    }
  });

  await item('H9', async () => {
    await dev(375, 800);
    await start(seed({ activity: { [TODAY]: ACT, [YEST]: { updatedAt: 1, source: 'google-health', steps: 3000, sleepMinutes: 400 } } }));
    await page.click('#prev');
    expectC('H9', await centres(), { k: ['2000', 'kcal left'], p: ['150', 'g left'], c: ['200', 'g left'], f: ['65', 'g left'], steps: ['3k/10k', 'steps'], sleep: ['6.7/8h', 'sleep'] });
    await page.click('#next');
    for (const t of ['light', 'dark', 'ocean', 'contrast']) {
      await page.click('[data-tab="settings"]');
      if (await page.locator('#themePanel').isHidden()) await page.click('#themeToggle');
      await page.click(`#themes [data-t="${t}"]`);
      await page.click('[data-tab="diary"]'); await page.waitForSelector('#dials .ring-arc');
      const r = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, card: getComputedStyle(document.getElementById('dials')).backgroundColor,
        fills: [...document.querySelectorAll('#dials .dial-num, #dials .dial-cap')].map(x => getComputedStyle(x).fill), n: document.querySelectorAll('#dials .dial-num, #dials .dial-cap').length }));
      check(r.theme === t && r.n === 12, `H9 ${t}: theme ${r.theme}, ${r.n} centre texts`);
      check(r.fills.every(f => f && f !== 'none' && f !== 'rgba(0, 0, 0, 0)' && f !== r.card), `H9 ${t}: fills ${JSON.stringify([...new Set(r.fills)])} card ${r.card}`);
      console.log(`  H9 ${t}: card ${r.card}, fills ${JSON.stringify([...new Set(r.fills)])}`);
    }
  });

  await item('H10', async () => {
    await dev(375, 800); await start(seed());
    const open = () => page.evaluate(() => document.getElementById('dlg').open);
    await page.locator('#dials [data-dial="steps"] svg text.dial-num').click();
    check(await open() && /Nutrition details/.test(await page.innerText('#dTitle')), 'H10: centre text click did not open Nutrition details');
    await page.click('#dClose');
    await page.click('#dialsEdit');
    check(!(await open()) && await page.locator('#dialsPanel').isVisible(), 'H10: pencil opened details or no panel');
  });

  // Extra screenshot: edit panel closed (default view) at both widths is H2; also with the panel open for reference.
  await item('shots-edit', async () => {
    for (const [w, h] of sizes) { await dev(w, h); await start(seed()); await page.click('#dialsEdit'); await take('edit open ' + w, `dial-centres-editopen-${w}`); }
  });

  check(fails.length === 0, 'failed items: ' + fails.join(' || '));
  check(errs.length === 0, 'page/console errors: ' + errs.join(' | '));
};
