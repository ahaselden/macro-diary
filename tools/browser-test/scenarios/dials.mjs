// docs/specs/dials-simplify.md headless checklist H1..H15 (one Diary card, optional single-ring dials, rows with bars, pencil panel). All data is seeded into localStorage; no network.
// Set DIALS_SHOTS=<folder> to also save the named screenshots into a folder of your choice (otherwise they go to the runner's temp folder).
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
const seed = (o = {}) => ({
  schemaVersion: 13, theme: 'light', weightUnit: 'g', measures: {}, dials: ['k'],
  goals: { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 5, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [RICE(800)] }, activity: { [TODAY]: ACT }, ...o,
});

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  const fails = [];
  console.log('device viewport at start: ' + JSON.stringify(page.viewportSize()));
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  shot: ' + await screenshot('dials-' + id + '-failed')); } catch { /* ignore */ } }
  };
  const shot = async name => {
    const p = await screenshot(name);
    if (process.env.DIALS_SHOTS) { mkdirSync(process.env.DIALS_SHOTS, { recursive: true }); const f = join(process.env.DIALS_SHOTS, name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; }
    return p;
  };
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(s)]);
    await page.reload(); await page.waitForSelector('#dials #dialsEdit');
  };
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const dialsText = async () => norm(await page.locator('#dials').innerText());
  const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
  const isOpen = () => page.evaluate(() => document.getElementById('dlg').open);
  const order = () => page.evaluate(() => [...document.querySelectorAll('#dials [data-dial]')].map(e => e.dataset.dial));
  const active = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const rowTexts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#dials [data-row]')].map(r => [r.dataset.row, r.innerText.replace(/\s+/g, ' ').trim()])));
  const rowInfo = () => page.evaluate(() => {
    const probe = document.createElement('i'); document.body.appendChild(probe);
    const col = v => { probe.style.backgroundColor = ''; probe.style.backgroundColor = v; return getComputedStyle(probe).backgroundColor; };
    const out = [...document.querySelectorAll('#dials [data-row]')].map(r => {
      const bar = r.querySelector('.bar'), fill = bar.querySelector('i');
      return { key: r.dataset.row, ratio: fill.getBoundingClientRect().width / bar.getBoundingClientRect().width, w: fill.getBoundingClientRect().width, over: bar.classList.contains('over'), bg: getComputedStyle(fill).backgroundColor, text: r.innerText.replace(/\s+/g, ' ').trim() };
    });
    const vars = { k: col('var(--kcal)'), p: col('var(--p)'), c: col('var(--c)'), f: col('var(--f)'), over: col('var(--over)') };
    probe.remove(); return { rows: out, vars };
  });
  const arcs = () => page.evaluate(() => {
    const probe = document.createElement('i'); document.body.appendChild(probe);
    const col = v => { probe.style.color = ''; probe.style.color = v; return getComputedStyle(probe).color; };
    const res = [...document.querySelectorAll('#dials [data-dial]')].map(d => {
      const a = d.querySelector('.ring-arc'), lab = d.querySelector('[aria-label]');
      if (!a) return { key: d.dataset.dial, label: lab && lab.getAttribute('aria-label'), arc: false };
      const r = Number(a.getAttribute('r'));
      return { key: d.dataset.dial, label: lab && lab.getAttribute('aria-label'), arc: true, frac: Number(a.getAttribute('stroke-dasharray').split(' ')[0]) / (2 * Math.PI * r), tf: a.getAttribute('transform'), stroke: getComputedStyle(a).stroke };
    });
    const vars = { over: col('var(--over)'), kcal: col('var(--kcal)') };
    probe.remove(); return { res, vars };
  });
  const centre = () => page.evaluate(() => { const d = document.querySelector('#dials [data-dial="k"]'); return d ? [...d.querySelectorAll('svg text')].map(t => t.textContent.trim()).join(' | ') : null; });
  const toDiary = () => page.click('[data-tab="diary"]');
  const toSettings = () => page.click('[data-tab="settings"]');
  const nothingWide = (w, n) => page.evaluate(([w, n]) => {
    const d = document.getElementById('dials').getBoundingClientRect();
    const sw = document.documentElement.scrollWidth;
    const els = [...document.querySelectorAll('#dials .dial-name, #dials .dial b, #dials .mrow-top > *, #dials .dial-num, #dials .dial-cap')];
    const boxes = els.map(e => { const b = e.getBoundingClientRect(); return { t: e.textContent.trim(), l: b.left, r: b.right, tp: b.top, bt: b.bottom }; }).filter(b => b.r - b.l > 0);
    const outside = boxes.filter(b => b.l < d.left - 0.5 || b.r > d.right + 0.5 || b.tp < d.top - 0.5 || b.bt > d.bottom + 0.5).map(b => b.t);
    // overlap among the dial texts only (dial names/values/centre); rows are checked separately
    const dialEls = [...document.querySelectorAll('#dials .dial')].map(x => { const b = x.getBoundingClientRect(); return { t: x.dataset.dial, l: b.left, r: b.right, tp: b.top, bt: b.bottom }; });
    const ov = [];
    for (let i = 0; i < dialEls.length; i++) for (let j = i + 1; j < dialEls.length; j++) {
      const a = dialEls[i], b = dialEls[j];
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.bt, b.bt) - Math.max(a.tp, b.tp) > 1) ov.push(a.t + '<>' + b.t);
    }
    const txtOv = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.bt, b.bt) - Math.max(a.tp, b.tp) > 1) txtOv.push(a.t + '<>' + b.t);
    }
    const clipped = [...document.querySelectorAll('#dials .dial b, #dials .dial-name, #dials .mrow-top > *')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
    return { n, sw, dr: d.right, dl: d.left, outside, ov, txtOv, clipped, rows: [...document.querySelectorAll('#dials .dial')].map(x => Math.round(x.getBoundingClientRect().top)) };
  }, [w, n]);

  await item('H1', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    const s = seed({ schemaVersion: 11 }); delete s.dials;
    await start(s);
    check(JSON.stringify(await order()) === '["k"]', 'H1: dials ' + JSON.stringify(await order()));
    const c = await centre(); check(/1200/.test(c) && /kcal left/.test(c), 'H1: centre ' + c);
    const r = await rowTexts();
    check(r.k.includes('800 / 2000 kcal') && r.p.includes('80 / 150 g') && r.c.includes('160 / 200 g') && r.f.includes('40 / 65 g'), 'H1: rows ' + JSON.stringify(r));
    check(JSON.stringify(Object.keys(r)) === '["k","p","c","f"]', 'H1: row order ' + Object.keys(r));
    check(await page.evaluate(() => document.querySelector('#summary')) === null, 'H1: #summary exists');
    const al = await page.evaluate(() => { const e = document.getElementById('activityLine'); return { vis: !!e && e.offsetWidth > 0 && !e.hidden && getComputedStyle(e).display !== 'none', t: e && e.textContent }; });
    check(al.vis && /^From Google Health: /.test(al.t) && /6,120/.test(al.t) && /7 h 53 min/.test(al.t), 'H1: activityLine ' + JSON.stringify(al));
  });

  await item('H2', async () => {
    await start(seed());
    const { rows, vars } = await rowInfo();
    const exp = { k: 0.4, p: 0.533, c: 0.8, f: 0.615 };
    for (const r of rows) {
      check(Math.abs(r.ratio - exp[r.key]) <= 0.01, `H2: ${r.key} ratio ${r.ratio}`);
      check(r.bg === vars[r.key], `H2: ${r.key} bg ${r.bg} vs var ${vars[r.key]}`);
      check(!r.over, 'H2: over class on ' + r.key);
    }
    check(!(await dialsText()).includes('over goal'), 'H2: "over goal" present');
  });

  await item('H3', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start(seed({ days: { [TODAY]: [RICE(2200)] } }));
    const { rows, vars } = await rowInfo();
    for (const r of rows) {
      check(r.over && Math.abs(r.ratio - 1) < 0.01 && r.bg === vars.over, `H3: ${r.key} ${JSON.stringify(r)} over=${vars.over}`);
      check(/over goal/.test(r.text), `H3: ${r.key} text "${r.text}"`);
    }
    check(rows[0].text.includes('2200 / 2000 kcal'), 'H3: k text ' + rows[0].text);
    const c = await centre(); check(/200/.test(c) && /kcal over/.test(c), 'H3: centre ' + c);
    const a = await arcs(); check(a.res[0].arc && a.res[0].stroke === a.vars.over, 'H3: arc stroke ' + JSON.stringify(a));
    console.log('  shot over-goal 375: ' + await shot('dials-simplify-375-over-goal'));
    await page.setViewportSize({ width: 320, height: 700 });
    console.log('  shot over-goal 320: ' + await shot('dials-simplify-320-over-goal'));
  });

  await item('H4', async () => {
    const n = errs.length;
    await start(seed({ goals: { k: 0, p: 0, c: 0, f: 0, steps: 10000, sleepH: 8 } }));
    const r = await rowTexts();
    check(r.k.includes('800 kcal') && !/\/ /.test(r.k) && r.p.includes('80 g') && r.c.includes('160 g') && r.f.includes('40 g'), 'H4: rows ' + JSON.stringify(r));
    const { rows } = await rowInfo(); check(rows.every(x => x.w === 0), 'H4: fills ' + JSON.stringify(rows.map(x => x.w)));
    const html = await page.locator('#dials').innerHTML(); check(!/NaN|Infinity/.test(html + await dialsText()), 'H4: NaN/Infinity');
    check(errs.length === n, 'H4: page errors ' + errs.slice(n));
  });

  await item('H5', async () => {
    await start(seed());
    await page.click('#dialsEdit');
    check(await page.locator('#dialsPanel').isVisible(), 'H5: panel not visible');
    const at = await page.evaluate(() => { const e = document.getElementById('dialsEdit'); return [e.getAttribute('aria-expanded'), e.getAttribute('aria-label')]; });
    check(at[0] === 'true' && at[1] === 'Choose dials', 'H5: pencil attrs ' + at);
    check(!(await isOpen()), 'H5: details opened');
    const ch = await page.evaluate(k => k.map(x => document.getElementById('dialPick-' + x).checked), ALL);
    check(JSON.stringify(ch) === '[true,false,false,false,false,false]', 'H5: checked ' + ch);
    const labs = await page.evaluate(() => [...document.querySelectorAll('#dialsPanel label')].map(l => l.textContent));
    check(JSON.stringify(labs) === '["Calories","Protein","Carbs","Fat","Steps","Sleep"]', 'H5: labels ' + JSON.stringify(labs));
    await page.click('#dialsPanel label[for="dialPick-c"]');
    check(await page.isChecked('#dialPick-c'), 'H5: label click did not tick');
    await page.click('#dialsPanel label[for="dialPick-c"]');
    check(!(await page.isChecked('#dialPick-c')), 'H5: label click did not untick');
    check(!(await isOpen()), 'H5: details opened by label');
    await page.click('#dialsDone');
    check(await page.locator('#dialsPanel').count() === 0, 'H5: panel still there');
    check(await page.getAttribute('#dialsEdit', 'aria-expanded') === 'false', 'H5: aria-expanded after done');
    check(await active() === 'dialsEdit', 'H5: focus ' + await active());
  });

  await item('H6', async () => {
    await start(seed());
    await page.focus('#dialsEdit'); await page.keyboard.press('Enter');
    check(await page.locator('#dialsPanel').isVisible() && !(await isOpen()), 'H6: Enter on pencil: panel/details');
    await page.keyboard.press('Tab');
    const first = await active();
    if (first !== 'dialPick-k') { console.log('H6 FINDING: first Tab after the pencil lands on #' + first + ' (the panel is after #dialsOpen in DOM order), not #dialPick-k'); fails.push('H6: first Tab after pencil reaches #' + first + ', spec says #dialPick-k'); await page.keyboard.press('Tab'); }
    check(await active() === 'dialPick-k', 'H6: Tab reached ' + await active());
    await page.keyboard.press('Space');
    check(!(await page.isChecked('#dialPick-k')), 'H6: Space did not uncheck');
    check(await active() === 'dialPick-k', 'H6: focus after toggle ' + await active());
    await page.click('#dialsDone');
    const at = await page.evaluate(() => { const e = document.getElementById('dialsOpen'); return [e.getAttribute('role'), e.getAttribute('tabindex'), e.getAttribute('aria-label')]; });
    check(at[0] === 'button' && at[1] === '0' && /^Nutrition details/.test(at[2]), 'H6: dialsOpen attrs ' + at);
    await page.focus('#dialsOpen'); await page.keyboard.press('Enter');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'H6: Enter opens');
    await page.click('#dClose'); check(!(await isOpen()), 'H6: closed');
    await page.focus('#dialsOpen'); await page.keyboard.press('Space');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'H6: Space opens');
    await page.keyboard.press('Escape');
  });

  await item('H7', async () => {
    await start(seed());
    await page.click('#dialsEdit');
    await page.click('#dialPick-sleep'); check(await active() === 'dialPick-sleep', 'H7: focus 1 ' + await active());
    await page.click('#dialPick-p'); check(await active() === 'dialPick-p', 'H7: focus 2 ' + await active());
    check(JSON.stringify(await order()) === '["k","p","sleep"]', 'H7: order ' + JSON.stringify(await order()));
    const s = await saved(); check(JSON.stringify(s.dials) === '["k","p","sleep"]' && s.settingsUpdatedAt > 5, 'H7: saved ' + JSON.stringify(s.dials) + ' ' + s.settingsUpdatedAt);
    const t = await dialsText(); check(t.includes('Protein') && t.includes('80 / 150 g') && t.includes('Sleep') && t.includes('7 h 53 min / 8 h'), 'H7: text ' + t);
    await page.reload(); await page.waitForSelector('#dialsEdit');
    check(JSON.stringify(await order()) === '["k","p","sleep"]', 'H7: after reload ' + JSON.stringify(await order()));
  });

  const sixLabels = ['Calories: 800 of 2000 kcal', 'Protein: 80 of 150 g', 'Carbs: 160 of 200 g', 'Fat: 40 of 65 g', 'Steps: 6,120 of 10,000', 'Sleep: 7 h 53 min of 8 h'];
  const allSix = async (w, h, tag) => {
    await page.setViewportSize({ width: w, height: h });
    await start(seed({ dials: ALL }));
    check(JSON.stringify(await order()) === JSON.stringify(ALL), `${tag}: order ${await order()}`);
    const t = await dialsText();
    for (const s of ['800 / 2000 kcal', '80 / 150 g', '160 / 200 g', '40 / 65 g', '6,120 / 10,000', '7 h 53 min / 8 h']) check(t.includes(s), `${tag}: "${s}" missing in "${t}"`);
    const a = await arcs();
    check(JSON.stringify(a.res.map(x => x.label)) === JSON.stringify(sixLabels), `${tag}: labels ${JSON.stringify(a.res.map(x => x.label))}`);
    const exp = [0.4, 0.533, 0.8, 0.615, 0.612, 0.985];
    a.res.forEach((x, i) => { check(x.arc && Math.abs(x.frac - exp[i]) <= 0.01 && /^rotate\(-90 /.test(x.tf), `${tag}: arc ${x.key} ${JSON.stringify(x)}`); });
    const m = await nothingWide(w, tag);
    console.log(`${tag} metrics: ` + JSON.stringify(m));
    check(m.sw <= w, `${tag}: scrollWidth ${m.sw} > ${w}`);
    check(m.dr <= w + 0.5 && m.dl >= -0.5, `${tag}: #dials edges ${m.dl}..${m.dr}`);
    check(m.outside.length === 0, `${tag}: outside ${JSON.stringify(m.outside)}`);
    if (m.txtOv.length) console.log(`${tag} NOTE text boxes overlap: ` + JSON.stringify(m.txtOv));
    check(m.ov.length === 0 && m.txtOv.every(x => /kcal left|kcal over/.test(x)), `${tag}: overlap ${JSON.stringify([m.ov, m.txtOv])}`);
    check(m.clipped.length === 0, `${tag}: clipped ${JSON.stringify(m.clipped)}`);
    check(new Set(m.rows).size > 1, `${tag}: dials did not wrap, tops ${m.rows}`);
  };
  await item('H8-375', async () => { try { await allSix(375, 800, 'H8@375'); } finally { console.log('  shot all-six 375: ' + await shot('dials-simplify-375-all-six')); } });
  await item('H8-320', async () => { try { await allSix(320, 700, 'H8@320'); } finally { console.log('  shot all-six 320: ' + await shot('dials-simplify-320-all-six')); } });

  const none = async (w, h) => {
    await page.setViewportSize({ width: w, height: h });
    await start(seed({ dials: [] }));
    check((await order()).length === 0 && await page.locator('#dials .dial-area').count() === 0, `H9@${w}: dial elements present`);
    check(await page.locator('#dials [data-row]').count() === 4 && await page.locator('#dialsEdit').count() === 1, `H9@${w}: rows/pencil`);
    check(await page.evaluate(() => document.documentElement.scrollWidth) <= w, `H9@${w}: sideways scroll`);
  };
  await item('H9', async () => {
    await none(375, 800); await none(320, 700);
    await page.click('#dialsOpen'); check(await isOpen(), 'H9: card does not open details'); await page.click('#dClose');
    await page.click('#dialsEdit');
    const ch = await page.evaluate(k => k.map(x => document.getElementById('dialPick-' + x).checked), ALL);
    check(ch.every(x => !x), 'H9: checked ' + ch);
    await page.click('#dialPick-f'); await page.click('#dialPick-f');
    check(JSON.stringify((await saved()).dials) === '[]', 'H9: saved ' + JSON.stringify((await saved()).dials));
    await page.reload(); await page.waitForSelector('#dialsEdit');
    check((await order()).length === 0, 'H9: dial reappeared after reload ' + await order());
    await page.click('#dialsEdit');
    const ch2 = await page.evaluate(k => k.map(x => document.getElementById('dialPick-' + x).checked), ALL);
    check(ch2.every(x => !x), 'H9: panel after reload ' + ch2);
  });

  await item('H10', async () => {
    await start(seed());
    await page.click('#dials .mrow[data-row="p"] >> text=Protein');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'H10: row click');
    await page.click('#dClose');
    await page.click('#dials [data-dial="k"]');
    check(await isOpen(), 'H10: dial click'); await page.click('#dClose');
    await page.click('#dialsEdit'); check(!(await isOpen()), 'H10: pencil opened details');
    await page.click('#dialPick-steps'); check(!(await isOpen()), 'H10: checkbox opened details');
    await page.click('#dialsDone'); check(!(await isOpen()), 'H10: Done opened details');
  });

  await item('H11', async () => {
    await start(seed({ dials: ['steps', 'sleep'], activity: {} }));
    const t = await dialsText();
    check((t.match(/no data/g) || []).length === 2, 'H11: no data count in "' + t + '"');
    const l = await page.evaluate(() => [...document.querySelectorAll('#dials [data-dial] [aria-label]')].map(e => e.getAttribute('aria-label')));
    check(l.includes('Steps: no data') && l.includes('Sleep: no data'), 'H11: labels ' + JSON.stringify(l));
    const dt = norm(await page.locator('#dials .dial-area').innerText()); check(!/0 \//.test(dt), 'H11: "0 /" in dials: ' + dt);
    const r = await rowTexts(); check(r.k.includes('800 / 2000 kcal'), 'H11: rows ' + JSON.stringify(r));
    await start(seed({ dials: ['steps', 'sleep'], activity: { [TODAY]: { ...ACT, steps: 0 } } }));
    const t2 = await dialsText(); check(t2.includes('0 / 10,000'), 'H11: steps 0 "' + t2 + '"');
  });

  await item('H12', async () => {
    await start(seed({ dials: ALL, activity: { [TODAY]: ACT, [YEST]: { updatedAt: 1, source: 'google-health', steps: 3000, sleepMinutes: 400 } } }));
    const lbl = norm(await page.innerText('#dateLbl'));
    await page.click('#prev');
    check(norm(await page.innerText('#dateLbl')) !== lbl, 'H12: label unchanged');
    const r = await rowTexts();
    check(r.k.includes('0 / 2000 kcal') && r.p.includes('0 / 150 g') && r.c.includes('0 / 200 g') && r.f.includes('0 / 65 g'), 'H12: rows ' + JSON.stringify(r));
    const c = await centre(); check(/2000/.test(c) && /kcal left/.test(c), 'H12: centre ' + c);
    const t = await dialsText(); check(t.includes('3,000 / 10,000') && t.includes('6 h 40 min / 8 h'), 'H12: text ' + t);
    check(JSON.stringify(await order()) === JSON.stringify(ALL), 'H12: dials changed');
    await page.click('#next');
    check(norm(await page.innerText('#dateLbl')) === lbl && (await dialsText()).includes('6,120 / 10,000'), 'H12: back to today');
  });

  await item('H13', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start(seed({ dials: ALL }));
    for (const t of ['light', 'dark', 'ocean', 'contrast']) {
      await toSettings();
      if (await page.locator('#themePanel').isHidden()) await page.click('#themeToggle');
      await page.click(`#themes [data-t="${t}"]`);
      await toDiary(); await page.waitForSelector('#dials .ring-arc');
      const r = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme, sw: document.documentElement.scrollWidth,
        card: getComputedStyle(document.getElementById('dials')).backgroundColor,
        arcs: [...document.querySelectorAll('#dials .ring-arc')].map(x => getComputedStyle(x).stroke),
        fills: [...document.querySelectorAll('#dials .bar > i')].map(x => getComputedStyle(x).backgroundColor) }));
      check(r.theme === t, 'H13: theme ' + r.theme);
      check(r.arcs.length === 6 && r.arcs.every(s => s && s !== 'rgba(0, 0, 0, 0)' && s !== 'none'), `H13 ${t}: arcs ${JSON.stringify(r.arcs)}`);
      check(r.fills.every(s => s !== 'rgba(0, 0, 0, 0)' && s !== r.card), `H13 ${t}: fills ${JSON.stringify(r.fills)} card ${r.card}`);
      check(r.sw <= 375, `H13 ${t}: scrollWidth ${r.sw}`);
    }
  });

  await item('H14', async () => {
    await start(seed());
    await toSettings();
    const v = await page.evaluate(() => ['gK', 'gP', 'gC', 'gF', 'gSteps', 'gSleep'].map(i => document.getElementById(i) && document.getElementById(i).value));
    check(JSON.stringify(v) === '["2000","150","200","65","10000","8"]', 'H14: values ' + JSON.stringify(v));
    check(await page.evaluate(() => document.querySelector('#summary')) === null, 'H14: #summary exists');
  });

  await item('H15', async () => {
    await start(seed());
    await page.click('#dialsEdit'); await page.click('#dialPick-steps');
    await toSettings();
    await page.evaluate(() => {
      window.__dl = null;
      if (!window.__blobs) {
        window.__blobs = new Map();
        const mk = URL.createObjectURL.bind(URL);
        URL.createObjectURL = b => { const u = mk(b); window.__blobs.set(u, b); return u; };
        HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = window.__blobs.get(this.href); window.__dl = b.text().then(t => ({ name: this.download, text: t })); } };
      }
    });
    await page.locator('#bkExport').scrollIntoViewIfNeeded(); await page.click('#bkExport');
    await page.waitForFunction(() => window.__dl !== null, null, { timeout: 5000 });
    const d = await page.evaluate(() => window.__dl);
    const j = JSON.parse(d.text.replace(/^﻿/, ''));
    check(j.schemaVersion === 13 && JSON.stringify(j.dials) === '["k","steps"]', `H15: ${d.name} schemaVersion ${j.schemaVersion} dials ${JSON.stringify(j.dials)}`);
  });

  // Extra screenshots for the look: default and edit panel at both widths.
  await item('shots', async () => {
    for (const [w, h] of [[375, 800], [320, 700]]) {
      await page.setViewportSize({ width: w, height: h });
      await start(seed());
      const g = await page.evaluate(() => { const p = document.getElementById('dialsEdit').getBoundingClientRect(), d = document.querySelector('#dials [data-dial]').getBoundingClientRect(), c = document.getElementById('dials').getBoundingClientRect(); return { pencil: [p.left, p.top, p.width, p.height].map(Math.round), firstDial: [d.left, d.top, d.width, d.height].map(Math.round), card: [c.left, c.top, c.width, c.height].map(Math.round) }; });
      console.log(`pencil geometry @${w}: ` + JSON.stringify(g));
      console.log(`  shot default ${w}: ` + await shot(`dials-simplify-${w}-default`));
      await page.click('#dialsEdit');
      console.log(`  shot edit ${w}: ` + await shot(`dials-simplify-${w}-edit`));
    }
  });

  check(fails.length === 0, 'failed items: ' + fails.join(' || '));
  check(errs.length === 0, 'page/console errors: ' + errs.join(' | '));
};
