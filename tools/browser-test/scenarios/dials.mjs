// docs/specs/dials.md headless checklist C1..C15 (ring dials on the Diary, steps and sleep goals). All data is seeded into localStorage; no network.
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
const seed = (o = {}) => ({
  schemaVersion: 11, theme: 'light', weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [RICE(800)] }, activity: { [TODAY]: ACT }, ...o,
});

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  const fails = [];
  const vp = page.viewportSize();
  console.log('device viewport at start: ' + JSON.stringify(vp));
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
    await page.reload(); await page.waitForSelector('#dials .dial-big');
  };
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const dialsText = async () => norm(await page.locator('#dials').innerText());
  const labels = () => page.evaluate(() => [...document.querySelectorAll('#dials [aria-label]')].map(e => e.getAttribute('aria-label')));
  const arcs = () => page.evaluate(() => [...document.querySelectorAll('#dials .ring-arc')].map(a => {
    const t = a.previousElementSibling, r = Number(a.getAttribute('r')), cs = getComputedStyle(a);
    const probe = document.createElement('i'); const col = v => { probe.style.color = v; document.body.appendChild(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
    const m = (a.getAttribute('stroke') || '').match(/^var\((--[\w-]+)\)$/);
    return { r, cx: Number(a.getAttribute('cx')), cy: Number(a.getAttribute('cy')), da: a.getAttribute('stroke-dasharray').split(' ').map(Number), tf: a.getAttribute('transform'),
      off: a.getAttribute('stroke-dashoffset'), stroke: cs.stroke, strokeAttr: a.getAttribute('stroke'), varColour: m ? col('var(' + m[1] + ')') : null, trackR: t && Number(t.getAttribute('r')),
      over: col('var(--over)'), kcal: col('var(--kcal)'), p: col('var(--p)'), c: col('var(--c)'), f: col('var(--f)'), rs: col('var(--ring-steps)'), rl: col('var(--ring-sleep)') };
  }));
  const frac = a => a.da[0] / (2 * Math.PI * a.r);
  const centre = async () => norm((await page.locator('#dials .dial-num').innerHTML()) + ' ' + (await page.locator('#dials .dial-cap').innerHTML()));
  const toDiary = () => page.click('[data-tab="diary"]');
  const toSettings = () => page.click('[data-tab="settings"]');
  const isOpen = () => page.evaluate(() => document.getElementById('dlg').open);
  const six = ['Calories: 800 of 2000 kcal', 'Protein: 80 of 150 g', 'Carbs: 160 of 200 g', 'Fat: 40 of 65 g', 'Steps: 6,120 of 10,000', 'Sleep: 7 h 53 min of 8 h'];

  await item('C1', async () => {
    await start(seed());
    const r = await page.evaluate(() => {
      const d = document.getElementById('dials'), s = document.getElementById('summary'), v = document.getElementById('v-diary');
      const db = d && d.getBoundingClientRect(), sb = s.getBoundingClientRect();
      return { exists: !!d, inDiary: !!d && v.contains(d), vis: !!d && db.width > 0 && db.height > 0 && getComputedStyle(d).visibility !== 'hidden', dBottom: db && db.bottom, sTop: sb.top, sText: s.innerText.replace(/\s+/g, ' ') };
    });
    check(r.exists && r.vis, 'C1: #dials exists and visible ' + JSON.stringify(r));
    check(r.dBottom <= r.sTop + 0.5, `C1: #dials bottom ${r.dBottom} should be <= #summary top ${r.sTop}`);
    check(/800/.test(r.sText) && /of 2000 kcal eaten/.test(r.sText), 'C1: summary text ' + r.sText);
  });

  await item('C2', async () => {
    await start(seed());
    const t = await dialsText();
    for (const s of ['800 / 2000 kcal', '80 / 150 g', '160 / 200 g', '40 / 65 g', '6,120 / 10,000', '7 h 53 min / 8 h']) check(t.includes(s), `C2: "${s}" missing in "${t}"`);
    const c = await centre();
    check(/1200/.test(c) && /kcal left/.test(c), 'C2: centre ' + c);
  });

  await item('C3', async () => {
    await start(seed());
    const l = await labels();
    for (const s of six) check(l.filter(x => x === s).length >= 1, `C3: aria-label "${s}" missing in ${JSON.stringify(l)}`);
    console.log('C3 note: all aria-labels inside #dials: ' + JSON.stringify(l));
    check(l.filter(x => six.includes(x)).length === 6, 'C3: exactly 6 matching ring labels, got ' + l.filter(x => six.includes(x)).length);
    const d = await page.evaluate(() => { const e = document.getElementById('dials'); return { role: e.getAttribute('role'), ti: e.getAttribute('tabindex'), al: e.getAttribute('aria-label') }; });
    check(d.role === 'button' && d.ti === '0' && d.al && d.al.length > 0, 'C3: #dials attrs ' + JSON.stringify(d));
  });

  await item('C4', async () => {
    await start(seed());
    const a = await arcs();
    check(a.length === 6, 'C4: 6 arcs, got ' + a.length);
    const [k, p, c, f, st, sl] = a;
    check(Math.abs(frac(k) - 0.4) <= 0.005, 'C4: kcal fraction ' + frac(k));
    check(Math.abs(frac(st) - 0.612) <= 0.005, 'C4: steps fraction ' + frac(st));
    check(Math.abs(frac(sl) - 0.985) <= 0.005, 'C4: sleep fraction ' + frac(sl));
    for (const x of a) {
      check(/^rotate\(-90 /.test(x.tf || ''), 'C4: transform ' + x.tf);
      check(x.off === null || Number(x.off) >= 0, 'C4: dashoffset ' + x.off);
    }
    check([k, p, c, f].every(x => x.cx === k.cx && x.cy === k.cy), 'C4: nutrition rings share a centre');
    check(k.r > p.r && p.r > c.r && c.r > f.r, `C4: radii not decreasing ${[k, p, c, f].map(x => x.r)}`);
    check([k, p, c, f].every(x => x.trackR === x.r), 'C4: track radius equals arc radius');
  });

  await item('C5', async () => {
    await start(seed());
    const a = await arcs();
    const eq = [a[0].stroke === a[0].kcal, a[1].stroke === a[0].p, a[2].stroke === a[0].c, a[3].stroke === a[0].f, a[4].stroke === a[0].rs, a[5].stroke === a[0].rl];
    console.log('C5 strokes: ' + JSON.stringify(a.map(x => x.stroke)) + ' vars ' + JSON.stringify([a[0].kcal, a[0].p, a[0].c, a[0].f, a[0].rs, a[0].rl]));
    check(eq.every(Boolean), 'C5: stroke vs var mismatch ' + eq);
    check(a[0].rs !== a[0].rl && a[0].rs && a[0].rl, 'C5: steps and sleep colours must differ');
  });

  const OVERSEED = () => seed({ days: { [TODAY]: [RICE(2200)] }, activity: { [TODAY]: { ...ACT, steps: 12000, sleepMinutes: 540 } } });
  await item('C6', async () => {
    await start(OVERSEED());
    const a = await arcs();
    check(a.every(x => x.stroke === x.over), 'C6: strokes not all --over ' + JSON.stringify(a.map(x => x.stroke)) + ' over=' + a[0].over);
    const t = await dialsText();
    for (const s of ['2200 / 2000 kcal', '12,000 / 10,000', '9 h / 8 h']) check(t.includes(s), `C6: "${s}" missing in "${t}"`);
    const c = await centre(); check(/200/.test(c) && /kcal over/.test(c), 'C6: centre ' + c);
    const l = (await labels()).filter(x => /^(Calories|Protein|Carbs|Fat|Steps|Sleep):/.test(x));
    check(l.length === 6 && l.every(x => x.endsWith(', over goal')), 'C6: labels ' + JSON.stringify(l));
    check(a.every(x => Math.abs(x.da[0] - 2 * Math.PI * x.r) < 0.5), 'C6: arcs not full ' + JSON.stringify(a.map(x => frac(x))));
    await page.setViewportSize({ width: 375, height: 800 });
    console.log('  shot over-goal 375: ' + await shot('dials-375-over-goal'));
  });

  await item('C7', async () => {
    await start(seed({ activity: {} }));
    const t = await dialsText();
    check((t.match(/no data/g) || []).length === 2, 'C7: "no data" count in "' + t + '"');
    const l = await labels();
    check(l.includes('Steps: no data') && l.includes('Sleep: no data'), 'C7: labels ' + JSON.stringify(l));
    check(!/0 \//.test(await page.locator('#dials .dials-side').innerText()), 'C7: side text contains "0 /"');
    check(t.includes('800 / 2000 kcal') && l.includes('Calories: 800 of 2000 kcal'), 'C7: nutrition unaffected');
    await page.setViewportSize({ width: 375, height: 800 });
    console.log('  shot no-activity 375: ' + await shot('dials-375-no-activity'));
  });

  await item('C8', async () => {
    await start(seed({ activity: { [TODAY]: { ...ACT, steps: 0 } } }));
    const t = await dialsText();
    check(t.includes('0 / 10,000') && !/Steps no data/.test(t), 'C8: steps text in "' + t + '"');
    check(!t.includes('no data'), 'C8: unexpected no data in "' + t + '"');
    check(t.includes('7 h 53 min / 8 h'), 'C8: sleep text');
  });

  await item('C9', async () => {
    const n = errs.length;
    await start(seed({ goals: { k: 2000, p: 150, c: 200, f: 65, steps: 0, sleepH: 0 } }));
    const side = norm(await page.locator('#dials .dials-side').innerText());
    check(/6,120/.test(side) && !/6,120 \//.test(side), 'C9: steps value alone, got ' + side);
    check(/7 h 53 min/.test(side) && !/7 h 53 min \//.test(side), 'C9: sleep value alone, got ' + side);
    const l = await labels();
    check(l.includes('Steps: 6,120, no goal set') && l.includes('Sleep: 7 h 53 min, no goal set'), 'C9: labels ' + JSON.stringify(l));
    const t = await dialsText(); check(!/NaN|Infinity/.test(t + l.join(' ')), 'C9: NaN/Infinity');
    const html = await page.locator('#dials').innerHTML(); check(!/NaN|Infinity/.test(html), 'C9: NaN/Infinity in markup');
    check(errs.length === n, 'C9: page errors ' + errs.slice(n));
  });

  await item('C10', async () => {
    await start(seed());
    await page.click('#dials');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'C10: click opens, title ' + await page.innerText('#dTitle'));
    await page.click('#dClose'); check(!(await isOpen()), 'C10: closed');
    await page.focus('#dials'); await page.keyboard.press('Enter');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'C10: Enter opens');
    await page.click('#dClose'); check(!(await isOpen()), 'C10: closed 2');
    await page.focus('#dials'); await page.keyboard.press('Space');
    check(await isOpen() && /Nutrition details/.test(await page.innerText('#dTitle')), 'C10: Space opens');
    await page.keyboard.press('Escape');
  });

  await item('C11', async () => {
    await start(seed({ activity: { [TODAY]: ACT, [YEST]: { updatedAt: 1, source: 'google-health', steps: 3000, sleepMinutes: 400 } } }));   // spec omits updatedAt+source; sanitize drops a record without a source
    const todayLbl = norm(await page.innerText('#dateLbl'));
    await page.click('#prev');
    const yl = norm(await page.innerText('#dateLbl'));
    console.log('C11 date labels: today="' + todayLbl + '" prev="' + yl + '"');
    check(yl && yl !== todayLbl && !/^Today/.test(yl), 'C11: label did not change ' + yl);
    const c = await centre(); check(/2000/.test(c) && /kcal left/.test(c), 'C11: centre ' + c);
    const t = await dialsText();
    check(t.includes('3,000 / 10,000') && t.includes('6 h 40 min / 8 h'), 'C11: yesterday text "' + t + '"');
    await page.click('#next');
    check(norm(await page.innerText('#dateLbl')) === todayLbl, 'C11: back to today label');
    const t2 = await dialsText(); check(t2.includes('6,120 / 10,000') && t2.includes('800 / 2000 kcal'), 'C11: today numbers back "' + t2 + '"');
  });

  const layout = id => async () => {
    await page.setViewportSize({ width: id.w, height: id.h });
    await start(seed());
    const m = await page.evaluate(() => {
      const d = document.getElementById('dials'), db = d.getBoundingClientRect();
      const svg = d.querySelector('.dial-big').getBoundingClientRect();
      const els = [...d.querySelectorAll('.dial-num, .dial-cap, .dials-side .muted, .dials-side b, .dials-legend > div')];
      const boxes = els.map(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { t: e.textContent.replace(/\s+/g, ' ').trim(), l: b.left, r: b.right, tp: b.top, bt: b.bottom, fs: parseFloat(cs.fontSize), scale: e.ownerSVGElement ? e.ownerSVGElement.getBoundingClientRect().width / 128 : 1 }; });
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.bt, b.bt) - Math.max(a.tp, b.tp);
        if (ox > 1 && oy > 1) overlaps.push(a.t + ' <> ' + b.t);
      }
      const outside = boxes.filter(b => b.l < db.left - 0.5 || b.r > db.right + 0.5 || b.tp < db.top - 0.5 || b.bt > db.bottom + 0.5).map(b => b.t);
      // text clipped by its own box
      const clipped = [...d.querySelectorAll('.dials-side b, .dials-legend b, .dials-legend span')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, l: db.left, r: db.right, svgW: svg.width, overlaps, outside, clipped,
        fonts: boxes.filter(b => /^\d+$|kcal (left|over)$/.test(b.t)).map(b => `${b.t}: css ${b.fs}px x scale ${b.scale.toFixed(2)} = ${(b.fs * b.scale).toFixed(1)}px`), dialsH: db.height };
    });
    console.log(`${id.n} metrics: ` + JSON.stringify(m));
    check(m.sw <= id.w, `${id.n}: page scrollWidth ${m.sw} > ${id.w}`);
    check(m.r <= id.w + 0.5 && m.l >= -0.5, `${id.n}: #dials edges ${m.l}..${m.r}`);
    check(m.svgW >= (id.w >= 375 ? 120 : 100), `${id.n}: nutrition svg width ${m.svgW}`);
    check(m.outside.length === 0, `${id.n}: text outside #dials ${JSON.stringify(m.outside)}`);
    check(m.overlaps.length === 0, `${id.n}: overlapping text ${JSON.stringify(m.overlaps)}`);
    check(m.clipped.length === 0, `${id.n}: clipped text ${JSON.stringify(m.clipped)}`);
    return m;
  };

  await item('C12', async () => {
    try { await layout({ w: 375, h: 800, n: 'C12@375' })(); } finally { console.log('  shot 375: ' + await shot('dials-375')); }
  });

  await item('C12-320', async () => {
    try { await layout({ w: 320, h: 700, n: 'C12@320' })(); } finally { console.log('  shot 320: ' + await shot('dials-320')); }
  });

  await item('C12-dark', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start(seed({ theme: 'dark' }));
    check(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme not applied');
    console.log('  shot 375 dark: ' + await shot('dials-375-dark'));
  });

  await item('C13', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start(seed());
    const themes = ['light', 'dark', 'black', 'midnight', 'forest', 'nord', 'dracula', 'ember', 'ocean', 'rose', 'solarized', 'paper', 'contrast'];
    for (const t of themes) {
      await toSettings();
      if (await page.locator('#themePanel').isHidden()) await page.click('#themeToggle');
      await page.click(`#themes [data-t="${t}"]`);
      await toDiary(); await page.waitForSelector('#dials .ring-arc');
      const r = await page.evaluate(() => {
        const rs = getComputedStyle(document.documentElement).getPropertyValue('--ring-steps').trim(), rl = getComputedStyle(document.documentElement).getPropertyValue('--ring-sleep').trim();
        const a = [...document.querySelectorAll('#dials .ring-arc')].slice(4).map(x => getComputedStyle(x).stroke);
        return { theme: document.documentElement.dataset.theme, rs, rl, a, card: getComputedStyle(document.getElementById('dials')).backgroundColor };
      });
      check(r.theme === t && r.rs && r.rl, `C13 ${t}: theme/vars ${JSON.stringify(r)}`);
      check(r.a.every(s => s && s !== 'rgba(0, 0, 0, 0)' && s !== 'none' && s !== r.card) && r.a[0] !== r.a[1], `C13 ${t}: strokes ${JSON.stringify(r)}`);
    }
  });

  let old14;
  await item('C14', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    old14 = seed({ schemaVersion: 10, goals: { k: 1800, p: 120, c: 150, f: 50 } });
    await start(old14);
    await toSettings();
    check(await page.inputValue('#gK') === '1800', 'C14: gK ' + await page.inputValue('#gK'));
    check(await page.inputValue('#gSteps') === '10000', 'C14: gSteps ' + await page.inputValue('#gSteps'));
    check(await page.inputValue('#gSleep') === '8', 'C14: gSleep ' + await page.inputValue('#gSleep'));
    await toDiary();
    let t = await dialsText();
    check(t.includes('6,120 / 10,000') && t.includes('7 h 53 min / 8 h') && t.includes('800 / 1800 kcal'), 'C14: old-save dials "' + t + '"');
    await toSettings();
    await page.fill('#gSteps', '7000'); await page.press('#gSteps', 'Tab');
    await page.fill('#gSleep', '7.5'); await page.press('#gSleep', 'Tab');
    await page.waitForTimeout(100);
    check(/Saved/.test(await page.locator('#toast').innerText()), 'C14: toast "' + await page.locator('#toast').innerText() + '"');
    await toDiary();
    t = await dialsText();
    check(t.includes('6,120 / 7,000') && t.includes('7 h 53 min / 7 h 30 min'), 'C14: new goals "' + t + '"');
    await page.reload(); await page.waitForSelector('#dials .dial-big');
    t = await dialsText(); check(t.includes('6,120 / 7,000') && t.includes('7 h 30 min'), 'C14: after reload "' + t + '"');
    await toSettings();
    check(await page.inputValue('#gSteps') === '7000' && await page.inputValue('#gSleep') === '7.5', 'C14: reload settings ' + await page.inputValue('#gSteps') + '/' + await page.inputValue('#gSleep'));
    await page.fill('#gSleep', '30'); await page.press('#gSleep', 'Tab');
    await page.fill('#gSteps', '-5'); await page.press('#gSteps', 'Tab');
    await page.waitForTimeout(100);
    const g = await page.evaluate(k => JSON.parse(localStorage.getItem(k)).goals, KEY);
    console.log('C14 goals after invalid entries: ' + JSON.stringify(g));
    check(g.sleepH === 7.5 && g.steps === 7000, 'C14: invalid values were saved ' + JSON.stringify(g));
    await page.reload(); await page.waitForSelector('#dials .dial-big'); await toSettings();
    check(await page.inputValue('#gSleep') === '7.5' && await page.inputValue('#gSteps') === '7000', 'C14: after invalid + reload ' + await page.inputValue('#gSleep') + '/' + await page.inputValue('#gSteps'));
  });

  await item('C15', async () => {
    // continues from C14's state (steps 7000, sleep 7.5); re-establish it in case C14 failed part-way
    await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); s.goals.steps = 7000; s.goals.sleepH = 7.5; localStorage.setItem(k, JSON.stringify(s)); }, KEY);
    await page.reload(); await page.waitForSelector('#dials .dial-big'); await toSettings();
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
    console.log('C15 file ' + d.name + ' goals ' + JSON.stringify(j.goals) + ' schemaVersion ' + j.schemaVersion);
    check(JSON.stringify(j.goals) === '{"k":1800,"p":120,"c":150,"f":50,"steps":7000,"sleepH":7.5}', 'C15: goals ' + JSON.stringify(j.goals));
    check(j.schemaVersion === 11, 'C15: schemaVersion ' + j.schemaVersion);
  });

  check(fails.length === 0, 'failed items: ' + fails.join(' || '));
  check(errs.length === 0, 'page/console errors: ' + errs.join(' | '));
};
