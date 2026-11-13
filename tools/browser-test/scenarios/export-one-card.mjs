// docs/specs/export-one-card.md manual checklist C1..C10 (Export section is one card with dividers).
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date(); const TODAY = iso(now); const yd = new Date(now); yd.setDate(yd.getDate() - 1); const YEST = iso(yd);
const LONG = 'Extra long food name that forces the table wide 0123456789';
const ent = (id, name, k, p, c, f) => ({ id, meal: 'Lunch', name, brand: '', grams: 100, disp: '100 g', source: 'custom', per100: { k, p, c, f } });
const seed = (theme = 'light') => ({
  schemaVersion: 8, theme, weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [TODAY]: [ent('a', 'Meal today', 500, 30, 50, 10), ent('c', LONG, 100, 0, 0, 0)], [YEST]: [ent('b', 'Meal yesterday', 500, 20, 60, 20)] },
});

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  const fails = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  shot: ' + await screenshot('eoc-' + id)); } catch { /* ignore */ } }
  };
  const start = async (theme = 'light') => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), seed(theme));
    await page.reload(); await page.waitForSelector('.tabs');
    await page.click('[data-tab="settings"]'); await page.waitForSelector('#themeToggle', { state: 'visible' });
    await page.locator('#xKind').scrollIntoViewIfNeeded();
  };
  const setX = async (kind, date) => {
    if (date) { await page.fill('#xDate', date); await page.dispatchEvent('#xDate', 'change'); }
    if (kind) await page.selectOption('#xKind', kind);
  };
  const norm = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();
  const stat = async label => (await page.locator('#xStats .stats > div', { hasText: label }).locator('b').innerText()).trim();
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
  const IDS = ['xKind', 'xDate', 'xRange', 'xStats', 'xTable', 'xEntries', 'xSummary', 'xJson', 'xShare'];

  await item('C1', async () => {
    await start();
    const r = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('#v-settings h2')];
      const sync = hs.find(h => h.textContent.trim() === 'Sync between devices').closest('.card');
      const bk = hs.find(h => h.textContent.trim() === 'Backup').closest('.card');
      const cards = [...document.querySelectorAll('#v-settings .card')];
      const between = cards.filter(c => (sync.compareDocumentPosition(c) & 4) && (bk.compareDocumentPosition(c) & 2));
      const sibs = []; for (let n = sync.nextElementSibling; n && n !== bk; n = n.nextElementSibling) sibs.push(n.tagName + '.' + n.className);
      return { n: between.length, first: between[0] && between[0].querySelector('h2').textContent.trim(), sibs };
    });
    check(r.n === 1, 'C1: cards between sync and backup ' + r.n);
    check(r.first === 'Export your data', 'C1: first heading ' + r.first);
    check(r.sibs.length === 1, 'C1: siblings between ' + JSON.stringify(r.sibs));
  });

  await item('C2', async () => {
    await start();
    const r = await page.evaluate(ids => {
      const card = [...document.querySelectorAll('#v-settings .card')].find(c => c.querySelector('h2')?.textContent.trim() === 'Export your data');
      return { counts: ids.map(i => document.querySelectorAll('#' + i).length), inside: ids.map(i => card.contains(document.getElementById(i))),
        cardCls: ['xStats', 'xTable'].map(i => document.getElementById(i).classList.contains('card')), tscroll: document.getElementById('xTable').classList.contains('tscroll') };
    }, IDS);
    check(r.counts.every(c => c === 1), 'C2: counts ' + r.counts);
    check(r.inside.every(Boolean), 'C2: inside ' + r.inside);
    check(r.cardCls.every(c => !c), 'C2: xStats/xTable not card');
    check(r.tscroll, 'C2: xTable tscroll');
  });

  await item('C3', async () => {
    await start();
    const order = await page.evaluate(ids => {
      const card = [...document.querySelectorAll('#v-settings .card')].find(c => c.querySelector('h2')?.textContent.trim() === 'Export your data');
      const els = [card.querySelector('h2'), ...ids.map(i => document.getElementById(i))];
      return els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & 4));
    }, IDS);
    check(order, 'C3: document order');
    const heads = await page.evaluate(() => [...document.querySelectorAll('#v-settings h2, #v-settings #themeToggle')].map(e => e.id === 'themeToggle' ? 'Appearance' : e.textContent.trim()));
    check(JSON.stringify(heads) === JSON.stringify(['Units', 'Daily goals', 'Appearance', 'Food databases', 'Sync between devices', 'Export your data', 'Backup']), 'C3: heads ' + JSON.stringify(heads));
  });

  await item('C4', async () => {
    await start();
    await setX('day', TODAY);
    console.log('C4 note: daily table shows one row per day (Day,kcal,P,C,F), food names are not shown: ' + await norm('#xTable'));
    const m = await page.evaluate(() => {
      const t = document.getElementById('xTable'), card = t.closest('.card');
      return { tsw: t.scrollWidth, tcw: t.clientWidth, ov: getComputedStyle(t).overflowX, dsw: document.documentElement.scrollWidth, iw: window.innerWidth, tr: t.getBoundingClientRect().right, cr: card.getBoundingClientRect().right, tabW: t.querySelector('table').getBoundingClientRect().width };
    });
    console.log('C4 metrics: ' + JSON.stringify(m) + (m.tsw > m.tcw ? ' (table needs to scroll)' : ' (table FITS, no scroll needed)'));
    check(m.ov === 'auto', 'C4: overflow-x ' + m.ov);
    check(m.dsw <= m.iw, 'C4: page scrollWidth ' + m.dsw + ' > innerWidth ' + m.iw);
    check(m.tr <= m.cr + 0.5, 'C4: table right ' + m.tr + ' beyond card right ' + m.cr);
  });

  await item('C5', async () => {
    await start();
    await setX('day', YEST);
    check(await stat('Days logged') === '1' && await stat('Total calories') === '500' && await stat('Avg calories / day') === '500', 'C5: daily stats ' + await norm('#xStats'));
    check(/20\s*\/\s*60\s*\/\s*20/.test(await stat('Avg P / C / F')), 'C5: avg P/C/F ' + await stat('Avg P / C / F'));
    check(await page.locator('#xTable table tr').count() === 2, 'C5: one data row');
    const rg = await norm('#xRange'); check(rg.length > 0 && !rg.includes('→'), 'C5: single date range ' + rg);
    await setX('week', TODAY);
    check(await stat('Days logged') === '2', 'C5: weekly days ' + await stat('Days logged'));
    check(/^1[,.\s ]?100$/.test(await stat('Total calories')), 'C5: weekly total ' + await stat('Total calories'));
    check((await norm('#xRange')).includes(' → '), 'C5: weekly range ' + await norm('#xRange'));
    await setX('year');
    check((await page.locator('#xTable table th').first().innerText()) === 'Month (avg/day)', 'C5: yearly header');
  });

  await item('C6', async () => {
    await start();
    await setX('day', '2000-01-01');
    check(await norm('#xTable') === 'Nothing logged in this period.', 'C6: empty text ' + await norm('#xTable'));
    check(await stat('Days logged') === '0', 'C6: days 0');
    const r = await page.evaluate(() => {
      const card = document.getElementById('xTable').closest('.card');
      const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      return { btns: ['xEntries', 'xSummary', 'xJson', 'xShare'].map(i => vis(document.getElementById(i)) && card.contains(document.getElementById(i))),
        bt: ['xStats', 'xTable', document.getElementById('xEntries').closest('.xsec')?.id || 'wrap'].map(i => { const e = document.getElementById(i) || document.getElementById('xEntries').closest('.xsec'); return getComputedStyle(e).borderTopWidth; }) };
    });
    check(r.btns.every(Boolean), 'C6: four buttons visible in card ' + r.btns);
    check(r.bt.every(w => w === '1px'), 'C6: dividers still present ' + r.bt);
  });

  await item('C7', async () => {
    await start();
    await setX('week', TODAY);
    const e = await grab(() => page.click('#xEntries'));
    const head = e.text.replace(/^﻿/, '').split(/\r?\n/)[0];
    check(e.name.includes('-entries-'), 'C7: entries name ' + e.name);
    for (const c of ['Fiber (g)', 'Sugars (g)', 'Saturated fat (g)', 'Sodium (mg)', 'Cholesterol (mg)']) check(head.includes(c), 'C7: header lacks ' + c);
    const s = await grab(() => page.click('#xSummary')); check(s.name.includes('-summary-'), 'C7: summary name ' + s.name);
    const j = await grab(() => page.click('#xJson')); check(j.name.includes('-data-'), 'C7: json name ' + j.name);
    await page.evaluate(() => { window.__shared = null; navigator.share = async d => { window.__shared = d; }; });
    await page.click('#xShare'); await page.waitForFunction(() => window.__shared !== null, null, { timeout: 3000 });
    const sh = await page.evaluate(() => window.__shared.text);
    check(sh.startsWith('My weekly summary ('), 'C7: share text ' + sh);
    await setX('day', '2000-01-01');
    await page.evaluate(() => { window.__dl = null; });
    await page.click('#xEntries'); await page.waitForTimeout(300);
    const t = (await page.locator('#toast').innerText()).trim();
    console.log('C7 empty-period toast: "' + t + '", download=' + !(await page.evaluate(() => window.__dl === null)));
    check(/Nothing to export/.test(t), 'C7: empty toast ' + t);
  });

  const visual = async (id, theme) => {
    await page.setViewportSize({ width: 375, height: 1300 });
    await start(theme);
    await setX('day', TODAY);
    await page.locator('#v-settings .card', { has: page.locator('#xKind') }).scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => {
      const card = document.getElementById('xKind').closest('.card');
      const wrap = document.getElementById('xEntries').closest('.xsec');
      const st = e => { const c = getComputedStyle(e); return { btw: c.borderTopWidth, bts: c.borderTopStyle, btc: c.borderTopColor, rad: c.borderRadius, bg: c.backgroundColor, mt: parseFloat(c.marginTop), pt: parseFloat(c.paddingTop), shadow: c.boxShadow, other: [c.borderBottomWidth, c.borderLeftWidth, c.borderRightWidth] }; };
      return { card: { ...st(card), btc: getComputedStyle(card).borderTopColor, bc: getComputedStyle(card).borderLeftColor }, line: getComputedStyle(card).getPropertyValue('--line').trim(), sec: ['xStats', 'xTable'].map(i => st(document.getElementById(i))).concat([wrap ? st(wrap) : null]),
        wrapDistinct: wrap && wrap !== document.getElementById('xStats') && wrap !== document.getElementById('xTable'), theme: document.documentElement.dataset.theme, text: getComputedStyle(card).color, cardbg: getComputedStyle(card).backgroundColor };
    });
    console.log(id + ' metrics: ' + JSON.stringify(m));
    check(m.wrapDistinct, id + ': buttons wrapper .xsec exists');
    for (const s of m.sec) {
      check(s && s.btw === '1px' && s.bts === 'solid', id + ': border-top 1px solid ' + JSON.stringify(s));
      check(s.rad === '0px' && s.bg === 'rgba(0, 0, 0, 0)' && s.shadow === 'none' && s.other.every(w => w === '0px'), id + ': no box look ' + JSON.stringify(s));
      check(s.mt >= 8, id + ': margin-top ' + s.mt);
    }
    return m;
  };

  await item('C8', async () => {
    const m = await visual('C8', 'light');
    check(m.theme === 'light', 'C8: data-theme ' + m.theme);
    console.log('  shot 375 light: ' + await screenshot('eoc-export-375-light'));
    await page.setViewportSize({ width: 1000, height: 1100 });
    await page.locator('#v-settings .card', { has: page.locator('#xKind') }).scrollIntoViewIfNeeded();
    console.log('  shot 1000 light: ' + await screenshot('eoc-export-1000-light'));
  });

  await item('C9', async () => {
    const m = await visual('C9', 'dark');
    check(m.theme === 'dark', 'C9: data-theme ' + m.theme);
    check(m.sec.every(s => s.btc === m.card.bc), 'C9: divider colour ' + m.sec.map(s => s.btc) + ' vs card border ' + m.card.bc);
    check(m.sec.every(s => s.btc !== m.cardbg), 'C9: divider differs from card bg');
    console.log('  shot 375 dark: ' + await screenshot('eoc-export-375-dark'));
  });

  await item('C10', async () => {
    await start();
    const r = await page.evaluate(() => {
      const out = {};
      for (const h of [...document.querySelectorAll('#v-settings h2')]) { const t = h.textContent.trim(); if (t === 'Backup' || t === 'Sync between devices') out[t] = { card: h.closest('.card') ? 1 : 0, id: h.closest('.card').querySelector('h2') === h, hasExport: !!h.closest('.card').querySelector('#xKind') }; }
      return out;
    });
    check(r.Backup && r.Backup.card && !r.Backup.hasExport && r['Sync between devices'] && !r['Sync between devices'].hasExport, 'C10: own cards ' + JSON.stringify(r));
    await page.locator('#bkExport').scrollIntoViewIfNeeded();
    check(await page.locator('#bkExport').isVisible() && await page.locator('#bkImport').isVisible(), 'C10: backup/restore visible');
    check((await page.locator('#bkExport').innerText()).includes('Backup') && /Restore/.test(await page.locator('#bkImport').innerText()), 'C10: labels ' + await page.locator('#bkExport').innerText() + ' / ' + await page.locator('#bkImport').innerText());
  });

  check(fails.length === 0, 'failed items: ' + fails.join(' || '));
  check(errs.length === 0, 'page/console errors: ' + errs.join(' | '));
};
