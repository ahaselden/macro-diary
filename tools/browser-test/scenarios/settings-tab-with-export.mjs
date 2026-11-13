// docs/specs/settings-tab-with-export.md manual checklist C1..C16 (Settings tab replaces More; Export lives in Settings).
const ent = (id, name, k, p, c, f) => ({ id, meal: 'Lunch', name, brand: '', grams: 100, disp: '100 g', source: 'custom', per100: { k, p, c, f } });
const seed = (extra = {}) => ({
  schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { '2026-11-10': [ent('e1', 'Rice', 400, 10, 80, 2)], '2026-11-11': [ent('e2', 'Pasta', 600, 20, 100, 10)] },
  ...extra,
});

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  const fails = [];
  const item = async (id, fn) => {
    try { await fn(); console.log('PASS ' + id); }
    catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  shot: ' + await screenshot('stwe-' + id)); } catch { /* ignore */ } }
  };
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), s);
    await page.reload(); await page.waitForSelector('.tabs');
  };
  const openSettings = async () => { await page.click('[data-tab="settings"]'); await page.waitForSelector('#themeToggle', { state: 'visible' }); };
  const norm = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();
  const setX = async (kind, date) => {
    if (date) { await page.fill('#xDate', date); await page.dispatchEvent('#xDate', 'change'); }
    if (kind) await page.selectOption('#xKind', kind);
  };
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
  const noDl = async click => {
    await page.evaluate(() => { window.__dl = null; });
    await click(); await page.waitForTimeout(300);
    return await page.evaluate(() => window.__dl === null);
  };
  const onTabs = () => page.evaluate(() => [...document.querySelectorAll('nav.tabs button.on')].map(b => b.dataset.tab));
  const visView = () => page.evaluate(() => [...document.querySelectorAll('.view')].filter(v => v.offsetParent !== null).map(v => v.id));
  const toastText = async () => (await page.locator('#toast').innerText()).trim();

  await item('C1', async () => {
    await start(seed());
    const labels = await page.evaluate(() => [...document.querySelectorAll('nav.tabs button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    check(labels.length === 5, 'C1: count ' + labels.length);
    check(JSON.stringify(labels.map(l => l.replace(/[^\w]/g, ''))) === JSON.stringify(['Diary', 'Plan', 'Recipes', 'Shop', 'Settings']), 'C1: labels ' + JSON.stringify(labels));
    const last = page.locator('nav.tabs button').last();
    check(await last.getAttribute('data-tab') === 'settings' && (await last.innerText()).includes('⚙'), 'C1: last is settings with gear');
    check(!labels.some(l => /More/.test(l)), 'C1: no More');
    for (const s of ['#v-more', '#moreExport', '#moreSettings', '[data-more]', '#v-export']) check(await page.locator(s).count() === 0, 'C1: no ' + s);
  });

  await item('C2', async () => {
    await start(seed());
    await page.click('[data-tab="settings"]');
    check(await page.locator('#v-settings').isVisible(), 'C2: settings visible');
    check(!(await page.locator('#v-diary').isVisible()), 'C2: diary hidden');
    check(!(await page.locator('#datebar').isVisible()), 'C2: datebar hidden');
    check(JSON.stringify(await onTabs()) === '["settings"]', 'C2: nav on ' + await onTabs());
    check(await page.evaluate(() => window.scrollY) === 0, 'C2: scrollY 0');
    check(await page.locator('text=‹ More').count() === 0 && await page.locator('.back-more').count() === 0, 'C2: no back-to-More');
  });

  await item('C3', async () => {
    await start(seed()); await openSettings();
    const heads = await page.evaluate(() => [...document.querySelectorAll('#v-settings h2, #v-settings #themeToggle')].map(e => e.id === 'themeToggle' ? 'Appearance' : e.textContent.trim()));
    check(JSON.stringify(heads) === JSON.stringify(['Units', 'Daily goals', 'Appearance', 'Food databases', 'Sync between devices', 'Export your data', 'Backup']), 'C3: ' + JSON.stringify(heads));
    const after = await page.evaluate(() => { const h = [...document.querySelectorAll('#v-settings h2')].pop(); let n = 0, c = h.closest('.card'); while ((c = c.nextElementSibling)) n++; return n; });
    check(after === 0, 'C3: ' + after + ' elements after the Backup card');
  });

  await item('C4', async () => {
    await start(seed()); await openSettings();
    await setX(null, '2026-11-11');
    await page.locator('#xKind').scrollIntoViewIfNeeded();
    check((await norm('#xRange')).length > 0, 'C4: range ' + await norm('#xRange'));
    const st = await norm('#xStats');
    for (const t of ['Days logged', 'Total calories', 'Avg calories / day', 'Avg P / C / F']) check(st.includes(t), 'C4: stats missing ' + t);
    const ths = await page.locator('#xTable table th').allInnerTexts();
    check(['Day', 'kcal', 'P', 'C', 'F'].every((h, i) => ths[i] === h), 'C4: headers ' + JSON.stringify(ths));
    console.log('C4 default kind: ' + await page.locator('#xKind').inputValue() + ', range: ' + await norm('#xRange'));
  });

  await item('C5', async () => {
    await start(seed()); await openSettings();
    await setX('day', '2026-11-11');
    const r = await norm('#xRange');
    check(r.length > 0 && !r.includes('→') && /11/.test(r) && /2026/.test(r), 'C5: daily range ' + r);
    check(await stat('Days logged') === '1' && await stat('Total calories') === '600', 'C5: daily stats');
    check(await page.locator('#xTable table tr').count() === 2, 'C5: one data row, got ' + (await page.locator('#xTable table tr').count() - 1));
    await setX('month');
    check((await norm('#xRange')).includes(' → '), 'C5: monthly range ' + await norm('#xRange'));
    check(await stat('Days logged') === '2' && /^1[,.\s]?000$/.test(await stat('Total calories')) && await stat('Avg calories / day') === '500', 'C5: monthly stats ' + await norm('#xStats'));
    await setX('year');
    check((await page.locator('#xTable table th').first().innerText()) === 'Month (avg/day)', 'C5: yearly header');
  });

  await item('C6', async () => {
    await start(seed()); await openSettings();
    await setX('day', '2026-11-11');
    const e = await grab(() => page.click('#xEntries'));
    const head = e.text.replace(/^﻿/, '').split(/\r?\n/)[0];
    console.log('C6 entries header: ' + head);
    check(e.name.includes('-entries-') && e.name.endsWith('.csv'), 'C6: name ' + e.name);
    for (const c of ['Fiber (g)', 'Sugars (g)', 'Saturated fat (g)', 'Sodium (mg)', 'Cholesterol (mg)']) check(head.includes(c), 'C6: header lacks ' + c);
    check(e.text.includes('Pasta'), 'C6: Pasta row');
    const j = await grab(() => page.click('#xJson'));
    check(j.name.includes('-data-') && j.name.endsWith('.json'), 'C6: json name ' + j.name);
    check(Object.keys(JSON.parse(j.text.replace(/^﻿/, '')))[0] === 'exported', 'C6: first key exported');
    const s = await grab(() => page.click('#xSummary'));
    check(s.name.includes('-summary-'), 'C6: summary name ' + s.name);
  });

  await item('C7', async () => {
    await start(seed()); await openSettings();
    await setX('day', '2020-01-01');
    check(await norm('#xTable') === 'Nothing logged in this period.' && await stat('Days logged') === '0', 'C7: empty report');
    const none = await noDl(() => page.click('#xEntries'));
    console.log('C7 entries on empty period: download=' + !none + ', toast="' + await toastText() + '"');
    check(none ? /Nothing to export/.test(await toastText()) : true, 'C7: toast Nothing to export when no download');
    await page.click('#xShare');
    check(/Nothing logged/.test(await toastText()), 'C7: share toast ' + await toastText());
    check(await page.locator('#xKind').isEnabled(), 'C7: page still usable');
  });

  await item('C8', async () => {
    await start(seed()); await openSettings();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    for (const i of ['bkExport', 'bkImport', 'wipe']) check(await page.locator('#' + i).isVisible(), 'C8: ' + i);
    const t = await page.evaluate(() => [document.getElementById('xShare').getBoundingClientRect().top, document.getElementById('bkExport').getBoundingClientRect().top]);
    check(t[0] < t[1], 'C8: xShare above bkExport ' + t);
    check(await page.evaluate(() => { const cs = [...document.querySelectorAll('#v-settings > .card')]; return cs[cs.length - 1].contains(document.getElementById('bkExport')); }), 'C8: Backup is the last card');
  });

  await item('C9', async () => {
    await start(seed()); await openSettings();
    await page.click('#themeToggle');
    check(await page.getAttribute('#themeToggle', 'aria-expanded') === 'true', 'C9: expanded');
    await page.click('[data-tab="diary"]'); await openSettings();
    check(await page.getAttribute('#themeToggle', 'aria-expanded') === 'false' && !(await page.locator('#themePanel').isVisible()), 'C9: collapsed on re-open');
    await page.click('#themeToggle');
    await page.selectOption('#xKind', 'month');
    check(await page.getAttribute('#themeToggle', 'aria-expanded') === 'true' && await page.locator('#themePanel').isVisible(), 'C9: stays expanded after xKind change');
  });

  await item('C10', async () => {
    await start(seed()); await openSettings();
    await page.click('#keyEdit'); await page.fill('#apiKey', 'abc123'); await page.click('#keySave');
    check(/Saved/.test(await toastText()), 'C10: toast ' + await toastText());
    check(await norm('#keyLine') === 'USDA key: set' && !(await page.locator('#keyEditor').isVisible()), 'C10: keyLine ' + await norm('#keyLine'));
    await page.click('#keyEdit');
    check(await page.locator('#keyEditor').isVisible(), 'C10: editor opens again');
    await page.click('[data-tab="diary"]'); await openSettings();
    check(!(await page.locator('#keyEditor').isVisible()) && await norm('#keyLine') === 'USDA key: set', 'C10: collapsed on re-open');
  });

  await item('C11', async () => {
    await start(seed());
    const seq = [['diary', true], ['settings', false], ['plan', false], ['settings', false], ['diary', true]];
    for (const [t, bar] of seq) {
      await page.click(`nav.tabs button[data-tab="${t}"]`);
      check(JSON.stringify(await onTabs()) === JSON.stringify([t]), `C11: ${t} only highlighted: ${await onTabs()}`);
      check(await page.locator('#datebar').isVisible() === bar, `C11: datebar ${bar} on ${t}`);
    }
    await openSettings();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const y = await page.evaluate(() => window.scrollY);
    await page.click('[data-tab="plan"]'); await page.click('[data-tab="settings"]');
    const y2 = await page.evaluate(() => window.scrollY);
    console.log('C11 scrolled to ' + y + ' before leaving, ' + y2 + ' after return');
    check(y > 0 && y2 === 0, 'C11: scrollY after return ' + y2 + ' (was ' + y + ')');
  });

  await item('C12', async () => {
    await start(seed());
    const before = errs.length;
    await page.evaluate(async () => { const m = await import('/js/ui/tabs.js'); m.showTab('more'); });
    check(await page.locator('#v-diary').isVisible(), 'C12: diary visible');
    check(JSON.stringify(await onTabs()) === '["diary"]', 'C12: diary highlighted');
    check(JSON.stringify(await visView()) === '["v-diary"]', 'C12: only diary view ' + await visView());
    check(errs.length === before, 'C12: no errors ' + errs.slice(before));
  });

  await item('C13', async () => {
    await start(seed());
    await page.setViewportSize({ width: 375, height: 667 });
    await openSettings(); await setX('month', '2026-11-11');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const m = await page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      const t = document.getElementById('xTable');
      const navTop = document.querySelector('nav.tabs').getBoundingClientRect().top;
      const card = document.getElementById('bkExport').closest('.card').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, tsw: t.scrollWidth, tcw: t.clientWidth, cls: t.className, btn: ['xEntries', 'xSummary', 'xJson', 'xShare'].map(i => [i, r(i).left, r(i).right]), cardBottom: card.bottom, navTop, h: document.documentElement.scrollHeight };
    });
    console.log('C13 metrics: ' + JSON.stringify(m));
    console.log('  shot: ' + await screenshot('stwe-C13-bottom'));
    check(m.sw <= 375, 'C13: page scrollWidth ' + m.sw);
    check(m.tsw >= m.tcw && /tscroll/.test(m.cls), 'C13: xTable scroll ' + m.tsw + '/' + m.tcw + ' ' + m.cls);
    check(m.btn.every(([, l, r]) => l >= 0 && r <= 375), 'C13: buttons ' + JSON.stringify(m.btn));
    check(m.cardBottom <= m.navTop, 'C13: backup card bottom ' + m.cardBottom + ' vs nav top ' + m.navTop);
  });

  await item('C14', async () => {
    await start(seed()); await openSettings();
    const act = () => page.evaluate(() => document.activeElement.id);
    await page.focus('#xKind'); await page.keyboard.press('Tab');
    check(await act() === 'xDate', 'C14: after xKind -> ' + await act());
    const stops = [];
    for (let i = 0; i < 4 && await act() !== 'xEntries'; i++) { await page.keyboard.press('Tab'); stops.push((await act()) || 'other'); }
    check(await act() === 'xEntries', 'C14: reached xEntries via ' + stops);
    const extra = stops.filter(s => s !== 'xDate' && s !== 'xEntries'); console.log('C14 stops after xDate (xDate repeats are the date field month/day/year segments): ' + stops);
    check(extra.length <= 1, 'C14: extra stops ' + extra);
    for (const id of ['xSummary', 'xJson', 'xShare', 'bkExport']) { await page.keyboard.press('Tab'); check(await act() === id, 'C14: expected ' + id + ' got ' + await act()); }
    await page.keyboard.press('Shift+Tab');
    check(await act() === 'xShare', 'C14: shift+tab -> ' + await act());
    await page.focus('#xEntries');
    const f = await grab(() => page.keyboard.press('Enter'));
    check(f.name.includes('-entries-'), 'C14: Enter downloads ' + f.name);
    await setX(null, '2026-11-11');
    await page.focus('#xKind');
    const before = await norm('#xRange'), bk = await page.locator('#xKind').inputValue();
    await page.keyboard.press('ArrowDown');
    const after = await norm('#xRange');
    console.log('C14 kind ' + bk + ' -> ' + await page.locator('#xKind').inputValue() + '; range "' + before + '" -> "' + after + '"');
    check(await page.locator('#xKind').inputValue() !== bk && before !== after, 'C14: ArrowDown changed kind and report');
  });

  await item('C15', async () => {
    const evil = '<img src=x onerror="window.__x=1">';
    await start(seed({ theme: '<script>', days: { '2026-11-11': [ent('h1', evil, 100, 1, 1, 1), ent('h2', '=HYPERLINK(1)', 100, 1, 1, 1)] } }));
    await openSettings(); await setX('day', '2026-11-11');
    check(await page.locator('#v-settings img').count() === 0, 'C15: no img in settings');
    check(await page.evaluate(() => window.__x) === undefined, 'C15: window.__x undefined');
    console.log('C15 table text: ' + (await page.locator('#xTable').innerText()).replace(/\s+/g, ' '));
    const f = await grab(() => page.click('#xEntries'));
    const line = f.text.split(/\r?\n/).find(l => l.includes('HYPERLINK'));
    console.log('C15 formula row: ' + line);
    check(line && !/(^|,)"?=HYPERLINK/.test(line) && /'=HYPERLINK/.test(line), 'C15: formula neutralised');
    check(await page.locator('#v-settings img').count() === 0 && await page.evaluate(() => window.__x) === undefined, 'C15: still clean after export');
  });

  await item('C16', async () => {
    await start(seed());
    const before = errs.length;
    for (const t of ['plan', 'recipes', 'shop', 'diary']) {
      await page.click(`nav.tabs button[data-tab="${t}"]`);
      check(await page.locator('#v-' + t).isVisible(), `C16: ${t} visible`);
    }
    check(await page.locator('#v-export').count() === 0, 'C16: no #v-export');
    check(errs.length === before, 'C16: no errors ' + errs.slice(before));
  });

  check(fails.length === 0, 'failed items: ' + fails.join(' || '));
  check(errs.length === 0, 'page/console errors: ' + errs.join(' | '));
};
