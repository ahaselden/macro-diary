// docs/specs/water.md headless checklist C1..C14. All data is seeded into localStorage; no network.
// Screenshots of the card go to WATER_SHOTS (a folder) when set, otherwise to the runner's temp folder.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = shift(0), YEST = shift(-1), PREV2 = shift(-2);
const KEY = 'macrodiary.v1';
const RICE = grams => ({ id: 'e1', meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, grams, updatedAt: 1 });
const seed = (o = {}) => ({
  schemaVersion: 13, theme: 'light', weightUnit: 'oz', measures: {}, dials: ['k'],
  goals: { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8, waterCups: 8 }, waterTap: 'half', water: {},
  apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 5, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: {}, activity: {}, ...o,
});
const withGoal = (n, o = {}) => seed({ goals: { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8, waterCups: n }, ...o });

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  const fails = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  shot: ' + await screenshot('water-' + id + '-failed')); } catch { /* ignore */ } }
  };
  const shot = async name => {
    const p = await screenshot(name);
    if (process.env.WATER_SHOTS) { mkdirSync(process.env.WATER_SHOTS, { recursive: true }); const f = join(process.env.WATER_SHOTS, name + '.png'); await page.screenshot({ path: f, fullPage: true }); return f; }
    return p;
  };
  const cardShot = async name => {
    if (process.env.WATER_SHOTS) { mkdirSync(process.env.WATER_SHOTS, { recursive: true }); const f = join(process.env.WATER_SHOTS, name + '.png'); await page.locator('#water').screenshot({ path: f }); return f; }
    return '';
  };
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(s)]);
    await page.reload(); await page.waitForSelector('#water');
  };
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const text = async () => norm(await page.locator('#waterText').innerText());
  const goal = async () => norm(await page.locator('#waterGoal').innerText());
  const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
  const labels = () => page.evaluate(() => [...document.querySelectorAll('#water [data-cup]')].map(b => b.getAttribute('aria-label')));
  const cupN = () => page.evaluate(() => [...document.querySelectorAll('#water [data-cup]')].map(b => b.dataset.cup));
  const tap = n => page.click(`#water [data-cup="${n}"]`);
  const geom = () => page.evaluate(() => {
    const cups = [...document.querySelectorAll('#water [data-cup]')].map(b => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: r.width, h: r.height }; });
    const c = document.getElementById('water').getBoundingClientRect();
    return { cups, card: { l: c.left, r: c.right }, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, rows: new Set(cups.map(x => Math.round(x.t))).size };
  });
  const toDiary = () => page.click('[data-tab="diary"]');
  const toSettings = () => page.click('[data-tab="settings"]');

  await page.setViewportSize({ width: 375, height: 800 });

  await item('C1', async () => {
    await start(seed());
    const o = await page.evaluate(() => {
      const w = document.getElementById('water'), ids = ['dials', 'activityLine', 'water', 'meals'].map(i => document.getElementById(i));
      const pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { tag: w.tagName, plainCard: w.classList.contains('card') && w.tagName !== 'BUTTON' && !w.closest('button'), order: pos(ids[0], ids[2]) && pos(ids[1], ids[2]) && pos(ids[2], ids[3]), title: w.innerText, fills: document.querySelectorAll('#water .cup-fill').length };
    });
    check(o.plainCard && o.order, 'C1: card/order ' + JSON.stringify(o));
    check(/\bWater\b/.test(o.title), 'C1: title ' + o.title);
    check(await text() === '0 of 8 cups, 0 oz', 'C1: text ' + await text());
    check(await goal() === 'Goal: 8 cups, 64 oz', 'C1: goal ' + await goal());
    check(JSON.stringify(await cupN()) === '["1","2","3","4","5","6","7","8"]', 'C1: data-cup ' + await cupN());
    const l = await labels();
    check(l.every((x, i) => x === `Cup ${i + 1} of 8, empty`), 'C1: labels ' + JSON.stringify(l));
    check(o.fills === 0, 'C1: cup-fill count ' + o.fills);
  });

  const fillH = n => page.evaluate(n => { const r = document.querySelector(`#water [data-cup="${n}"] .cup-fill`); return r ? r.getBoundingClientRect().height : null; }, n);

  await item('C2', async () => {
    await start(seed());
    await tap(3);
    check(await text() === '2.5 of 8 cups, 20 oz', 'C2: text ' + await text());
    const l = await labels();
    check(l[0] === 'Cup 1 of 8, full' && l[1] === 'Cup 2 of 8, full' && l[2] === 'Cup 3 of 8, half full' && l.slice(3).every((x, i) => x === `Cup ${i + 4} of 8, empty`), 'C2: labels ' + JSON.stringify(l));
    const h1 = await fillH(1), h3 = await fillH(3);
    check(h1 && h3 && Math.abs(h3 / h1 - 0.5) <= 0.1, `C2: fill heights cup1 ${h1} cup3 ${h3} ratio ${h3 / h1}`);
    let s = await saved(), r = s.water[TODAY];
    check(r && r.halves === 5 && typeof r.updatedAt === 'number' && r.updatedAt > 5, 'C2: saved ' + JSON.stringify(r));
    await tap(3);
    check(await text() === '3 of 8 cups, 24 oz', 'C2b: text ' + await text());
    check((await labels())[2] === 'Cup 3 of 8, full', 'C2b: cup3 ' + (await labels())[2]);
    check((await saved()).water[TODAY].halves === 6, 'C2b: halves');
    await tap(3);
    check(await text() === '2 of 8 cups, 16 oz', 'C2c: text ' + await text());
    const l3 = await labels();
    check(l3.slice(2).every((x, i) => x === `Cup ${i + 3} of 8, empty`), 'C2c: labels ' + JSON.stringify(l3));
    check((await saved()).water[TODAY].halves === 4, 'C2c: halves');
  });

  await item('C3', async () => {
    await start(seed({ waterTap: 'whole' }));
    await tap(2);
    check(await text() === '2 of 8 cups, 16 oz', 'C3: text ' + await text());
    const l = await labels();
    check(l[0].endsWith('full') && l[1].endsWith('full') && !/half/.test(l.join()), 'C3: labels ' + JSON.stringify(l));
    check((await saved()).water[TODAY].halves === 4, 'C3: halves ' + JSON.stringify((await saved()).water));
    await tap(1);
    check(await text() === '0 of 8 cups, 0 oz', 'C3b: text ' + await text());
    check((await labels()).every((x, i) => x === `Cup ${i + 1} of 8, empty`), 'C3b: all empty');
    const r = (await saved()).water[TODAY];
    check(r && r.halves === 0 && typeof r.updatedAt === 'number', 'C3b: record kept ' + JSON.stringify(r));
  });

  await item('C4', async () => {
    for (const [w, h] of [[375, 800], [320, 700]]) {
      await page.setViewportSize({ width: w, height: h });
      await start(withGoal(12));
      check((await cupN()).length === 12, `C4 ${w}: count ${(await cupN()).length}`);
      check(await goal() === 'Goal: 12 cups, 96 oz', `C4 ${w}: goal ${await goal()}`);
      const g = await geom();
      check(g.rows > 1, `C4 ${w}: rows ${g.rows}`);
      check(g.sw <= g.cw, `C4 ${w}: scrollWidth ${g.sw} > ${g.cw}`);
      check(g.cups.every(c => c.l >= g.card.l - 0.5 && c.r <= g.card.r + 0.5), `C4 ${w}: clipped ${JSON.stringify(g.cups.filter(c => c.l < g.card.l || c.r > g.card.r))}`);
      const small = g.cups.filter(c => c.w < 32 || c.h < 32);
      check(small.length === 0, `C4 ${w}: cups under 32px ${JSON.stringify(small)}`);
      console.log(`  cup size @${w} (12 cups): ${g.cups[0].w.toFixed(1)} x ${g.cups[0].h.toFixed(1)}, rows ${g.rows}`);
    }
    await page.setViewportSize({ width: 375, height: 800 });
  });

  await item('C5', async () => {
    await start(seed({ water: { [TODAY]: { updatedAt: 1, halves: 18 } } }));
    check((await cupN()).length === 9, 'C5: count ' + (await cupN()).length);
    check(await text() === '9 of 8 cups, 72 oz, over goal', 'C5: text ' + await text());
    const o = await page.evaluate(() => { const a = document.querySelector('[data-cup="9"]'), b = document.querySelector('[data-cup="8"]'); return { a: a.getAttribute('aria-label'), ac: a.classList.contains('over'), b: b.getAttribute('aria-label'), bc: b.classList.contains('over') }; });
    check(o.a === 'Cup 9 of 9, full, over goal' && o.ac && o.b === 'Cup 8 of 9, full' && !o.bc, 'C5: ' + JSON.stringify(o));
    await tap(9);
    check((await cupN()).length === 8, 'C5b: count ' + (await cupN()).length);
    check(await text() === '8 of 8 cups, 64 oz', 'C5b: text ' + await text());
    const f = await page.evaluate(() => document.activeElement && document.activeElement.dataset.cup);
    check(f === '8', 'C5b: focus on cup ' + f);
  });

  await item('C6', async () => {
    await start(seed({ weightUnit: 'g', water: { [TODAY]: { updatedAt: 1, halves: 5 } } }));
    check(await text() === '2.5 of 8 cups, 600 ml', 'C6: text ' + await text());
    check(await goal() === 'Goal: 8 cups, 1920 ml', 'C6: goal ' + await goal());
    await start(seed({ weightUnit: 'oz', water: { [TODAY]: { updatedAt: 1, halves: 5 } } }));
    check(await text() === '2.5 of 8 cups, 20 oz', 'C6b: text ' + await text());
    check(await goal() === 'Goal: 8 cups, 64 oz', 'C6b: goal ' + await goal());
  });

  await item('C7', async () => {
    await start(seed({ water: { [TODAY]: { halves: 6, updatedAt: 1 }, [YEST]: { halves: 3, updatedAt: 1 } } }));
    await page.click('#prev');
    check(await text() === '1.5 of 8 cups, 12 oz', 'C7: yesterday ' + await text());
    await page.click('#prev');
    check(await text() === '0 of 8 cups, 0 oz', 'C7: two days ago ' + await text());
    await tap(1);
    check(await text() === '0.5 of 8 cups, 4 oz', 'C7: after tap ' + await text());
    await page.click('#next'); await page.click('#next');
    check(await text() === '3 of 8 cups, 24 oz', 'C7: today ' + await text());
    const s = await saved();
    check(s.water[PREV2] && s.water[PREV2].halves === 1 && s.water[TODAY].halves === 6 && s.water[YEST].halves === 3, 'C7: saved ' + JSON.stringify(s.water));
  });

  await item('C8', async () => {
    await start(seed());
    await tap(4); await tap(4);
    await page.reload(); await page.waitForSelector('#water [data-cup]');
    check(await text() === '4 of 8 cups, 32 oz', 'C8: text ' + await text());
    const l = await labels();
    check(l.slice(0, 4).every(x => x.endsWith('full') && !x.includes('half')) && l.slice(4).every(x => x.endsWith('empty')), 'C8: labels ' + JSON.stringify(l));
  });

  await item('C9', async () => {
    await start(seed());
    await toSettings();
    const o = await page.evaluate(() => ({ g: document.getElementById('gWater').value, t: document.getElementById('waterTap').value, opts: [...document.querySelectorAll('#waterTap option')].map(x => x.textContent.trim()) }));
    check(o.g === '8' && o.t === 'half' && JSON.stringify(o.opts) === '["Half cups","Whole cups"]', 'C9: ' + JSON.stringify(o));
    await page.fill('#gWater', '10'); await page.locator('#gWater').blur();
    let s = await saved();
    check(s.goals.waterCups === 10 && s.settingsUpdatedAt > 5, 'C9: saved goal ' + s.goals.waterCups + ' stamp ' + s.settingsUpdatedAt);
    await toDiary();
    check(await goal() === 'Goal: 10 cups, 80 oz' && (await cupN()).length === 10, 'C9: diary ' + await goal() + ' ' + (await cupN()).length);
    await toSettings();
    await page.selectOption('#waterTap', 'whole');
    check((await saved()).waterTap === 'whole', 'C9: tap saved ' + (await saved()).waterTap);
    await toDiary(); await tap(1);
    check(await text() === '1 of 10 cups, 8 oz', 'C9: whole tap ' + await text());
    for (const bad of ['0', '99', 'abc']) {
      await toSettings();
      await page.fill('#gWater', bad); await page.locator('#gWater').blur();
      const g = (await saved()).goals.waterCups;
      check(g !== 0 && g !== 99 && Number.isInteger(g) && g >= 1 && g <= 40, `C9: input "${bad}" saved ${g}`);
      console.log(`  info: typing "${bad}" saved goal ${g}`);
    }
  });

  await item('C10', async () => {
    await start(seed());
    await page.focus('[data-cup="2"]'); await page.keyboard.press('Enter');
    check(await text() === '1.5 of 8 cups, 12 oz', 'C10: Enter ' + await text());
    let f = await page.evaluate(() => document.activeElement.dataset.cup);
    check(f === '2', 'C10: focus after Enter ' + f);
    await page.keyboard.press('Space');
    check((await labels())[1] === 'Cup 2 of 8, full', 'C10: Space ' + (await labels())[1]);
    f = await page.evaluate(() => document.activeElement.dataset.cup);
    check(f === '2', 'C10: focus after Space ' + f);
  });

  await item('C11', async () => {
    await start(seed({ water: { [TODAY]: { updatedAt: 1, halves: 6 } } }));
    for (const t of ['light', 'dark', 'ocean', 'contrast']) {
      await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(s)); }, KEY);
      await toSettings();
      if (await page.locator('#themePanel').isHidden()) await page.click('#themeToggle');
      await page.click(`#themes [data-t="${t}"]`);
      await toDiary();
      const r = await page.evaluate(() => {
        const probe = document.createElement('i'); document.getElementById('water').appendChild(probe);
        probe.style.color = 'var(--water)'; const water = getComputedStyle(probe).color; probe.remove();
        const full = document.querySelector('#water .cup-fill'), empty = document.querySelector('#water .cup-empty, #water [data-cup="8"]');
        const emptyPath = empty.querySelector('svg *');
        return { theme: document.documentElement.dataset.theme, water, fill: getComputedStyle(full).fill, emptyHasFill: !!empty.querySelector('.cup-fill'), card: getComputedStyle(document.getElementById('water')).backgroundColor, emptyStroke: emptyPath ? getComputedStyle(emptyPath).stroke : null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      check(r.fill === r.water && r.fill !== 'rgba(0, 0, 0, 0)' && r.fill !== 'none', `C11 ${t}: fill ${r.fill} vs --water ${r.water}`);
      check(!r.emptyHasFill && r.fill !== r.card, `C11 ${t}: filled colour vs card ${r.card}`);
      check(r.sw <= r.cw, `C11 ${t}: scrollWidth ${r.sw}`);
      console.log(`  ${t}: data-theme=${r.theme} --water=${r.water} card=${r.card} emptyStroke=${r.emptyStroke}`);
      await cardShot('water-theme-' + t);
    }
  });

  await item('C12', async () => {
    const s = seed({ schemaVersion: 12, days: { [TODAY]: [RICE(800)] } });
    delete s.water; delete s.waterTap; delete s.goals.waterCups;
    await start(s);
    check(await text() === '0 of 8 cups, 0 oz', 'C12: text ' + await text());
    const o = await saved();
    check(o.days[TODAY].length === 1 && o.days[TODAY][0].name === 'Rice' && o.days[TODAY][0].grams === 800 && o.goals.k === 2000 && o.goals.steps === 10000 && o.goals.sleepH === 8, 'C12: data ' + JSON.stringify(o.goals));
    await toSettings();
    const v = await page.evaluate(() => [document.getElementById('gWater').value, document.getElementById('waterTap').value]);
    check(v[0] === '8' && v[1] === 'half', 'C12: settings ' + v);
    check(errs.length === 0, 'C12: page errors ' + errs.join(' | '));
  });

  await item('C13', async () => {
    await start(seed({ days: { [TODAY]: [RICE(800)] }, water: { [TODAY]: { updatedAt: 1, halves: 12 } } }));
    const rowK = await page.evaluate(() => { const r = document.querySelector('#dials [data-row="k"]'); const d = document.querySelector('#dials [data-dial="k"]'); return { row: r && r.innerText.replace(/\s+/g, ' ').trim(), centre: d && [...d.querySelectorAll('svg text')].map(t => t.textContent.trim()).join(' | ') }; });
    check(/800 \/ 2000 kcal/.test(rowK.row) && /1200/.test(rowK.centre), 'C13: ' + JSON.stringify(rowK));
    await tap(8); await tap(1);
    const after = await page.evaluate(() => { const r = document.querySelector('#dials [data-row="k"]'); const d = document.querySelector('#dials [data-dial="k"]'); return { row: r.innerText.replace(/\s+/g, ' ').trim(), centre: [...d.querySelectorAll('svg text')].map(t => t.textContent.trim()).join(' | ') }; });
    check(JSON.stringify(after) === JSON.stringify(rowK), 'C13: after taps ' + JSON.stringify(after));
  });

  await item('C14', async () => {
    await start(seed());
    await tap(2);
    await toSettings();
    await page.evaluate(() => {
      window.__dl = null; window.__blobs = new Map();
      const mk = URL.createObjectURL.bind(URL);
      URL.createObjectURL = b => { const u = mk(b); window.__blobs.set(u, b); return u; };
      HTMLAnchorElement.prototype.click = function () { if (this.download) { const b = window.__blobs.get(this.href); window.__dl = b.text().then(t => ({ name: this.download, text: t })); } };
    });
    await page.locator('#bkExport').scrollIntoViewIfNeeded(); await page.click('#bkExport');
    await page.waitForFunction(() => window.__dl !== null, null, { timeout: 5000 });
    const d = await page.evaluate(() => window.__dl);
    const j = JSON.parse(d.text.replace(/^﻿/, ''));
    check(j.schemaVersion === 13 && j.water[TODAY].halves === 3 && j.goals.waterCups === 8 && j.waterTap === 'half', 'C14: ' + JSON.stringify({ v: j.schemaVersion, w: j.water, g: j.goals.waterCups, t: j.waterTap }));
  });

  // Screenshots for the look, at 375 and 320.
  await item('shots', async () => {
    const cases = [
      ['default8', seed({ water: { [TODAY]: { updatedAt: 1, halves: 7 } } })],
      ['half', seed({ water: { [TODAY]: { updatedAt: 1, halves: 5 } } })],
      ['over9', seed({ water: { [TODAY]: { updatedAt: 1, halves: 18 } } })],
      ['over9half', seed({ water: { [TODAY]: { updatedAt: 1, halves: 17 } } })],
      ['metric', seed({ weightUnit: 'g', water: { [TODAY]: { updatedAt: 1, halves: 5 } } })],
      ['whole', seed({ waterTap: 'whole', water: { [TODAY]: { updatedAt: 1, halves: 4 } } })],
      ['goal12', withGoal(12, { water: { [TODAY]: { updatedAt: 1, halves: 9 } } })],
      ['goal40', withGoal(40, { water: { [TODAY]: { updatedAt: 1, halves: 30 } } })],
      ['dark', seed({ theme: 'dark', water: { [TODAY]: { updatedAt: 1, halves: 7 } } })],
    ];
    for (const [w, h] of [[375, 800], [320, 700]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [n, s] of cases) {
        await start(s);
        const g = await geom();
        console.log(`  ${n} @${w}: cup ${g.cups[0].w.toFixed(1)}x${g.cups[0].h.toFixed(1)} rows ${g.rows} sw ${g.sw}/${g.cw} text "${await text()}"`);
        await shot(`water-${w}-${n}`);
        await cardShot(`water-card-${w}-${n}`);
      }
      await start(seed());
      await toSettings();
      await page.locator('#gWater').scrollIntoViewIfNeeded();
      await shot(`water-${w}-settings`);
      await page.locator('#gWater').locator('xpath=ancestor::div[contains(@class,"card")][1]').screenshot({ path: join(process.env.WATER_SHOTS || '.', `water-card-${w}-settings.png`) }).catch(() => {});
    }
    await page.setViewportSize({ width: 375, height: 800 });
  });

  if (fails.length) throw new Error(fails.length + ' item(s) failed: ' + fails.join(' || '));
};
