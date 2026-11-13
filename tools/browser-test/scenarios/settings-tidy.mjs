// docs/specs/settings-tidy.md manual checklist C1..C12, plus a look comparison of the Appearance toggle with the neighbouring headings.
const seed = (extra = {}) => ({
  schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {},
  goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: {}, ...extra,
});

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const fails = [];
  const item = async (id, fn) => { try { await fn(); console.log('PASS ' + id); } catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); } };
  const start = async s => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), s);
    await page.reload();
    await page.waitForSelector('.tabs');
  };
  const openSettings = async () => { await page.click('[data-tab="more"]'); await page.click('#moreSettings'); await page.waitForSelector('#themeToggle', { state: 'visible' }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const exp = () => page.getAttribute('#themeToggle', 'aria-expanded');
  const norm = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();
  const visCount = () => page.locator('#themes .th:visible').count();
  const dt = () => page.evaluate(() => document.documentElement.dataset.theme);
  const pageScheme = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  await item('C1', async () => {
    await start(seed()); await openSettings();
    check(await page.locator('#themeToggle').evaluate(e => e.tagName) === 'BUTTON', 'C1: toggle is a button');
    check((await norm('#themeToggle')).startsWith('Appearance · Auto'), 'C1: text ' + await norm('#themeToggle'));
    check(await exp() === 'false', 'C1: aria-expanded false');
    check(await page.getAttribute('#themeToggle', 'aria-controls') === 'themePanel', 'C1: aria-controls');
    check(!(await page.locator('#themePanel').isVisible()), 'C1: panel hidden');
    check(await visCount() === 0, 'C1: no .th visible');
    check(!(await page.getByText('Choose a theme.').first().isVisible()), 'C1: intro hidden');
  });

  await item('C2', async () => {
    await start(seed()); await openSettings();
    const before = await dt();
    await page.click('#themeToggle');
    check(await exp() === 'true', 'C2: expanded');
    check(await page.locator('#themePanel').isVisible(), 'C2: panel visible');
    check(await visCount() === 14, 'C2: 14 swatch buttons, got ' + await visCount());
    check(await page.locator('#themes .th:visible', { has: page.locator('.pv') }).count() === 14, 'C2: each of 14 buttons has a .pv');
    check(await page.getByText('Choose a theme. Auto switches between Light and Dark with your device.', { exact: true }).isVisible(), 'C2: intro text');
    await page.click('#themeToggle');
    check(await exp() === 'false' && !(await page.locator('#themePanel').isVisible()) && await visCount() === 0, 'C2: collapsed again');
    check(await dt() === before && (await stored()).theme === 'auto', 'C2: theme unchanged');
  });

  await item('C3', async () => {
    await start(seed()); await openSettings();
    await page.focus('#themeToggle');
    await page.keyboard.press('Enter');
    check(await exp() === 'true' && await visCount() === 14, 'C3: Enter expands');
    check(await page.evaluate(() => document.activeElement.id) === 'themeToggle', 'C3: focus kept after Enter');
    await page.keyboard.press('Space');
    check(await exp() === 'false' && await visCount() === 0, 'C3: Space collapses');
    check(await page.evaluate(() => document.activeElement.id) === 'themeToggle', 'C3: focus kept after Space');
    await page.keyboard.press('Tab');
    const a = await page.evaluate(() => ({ id: document.activeElement.id, th: document.activeElement.classList.contains('th') }));
    check(!a.th && a.id === 'srcUSDA', 'C3: Tab from collapsed toggle goes to ' + JSON.stringify(a));
  });

  await item('C4', async () => {
    await start(seed()); await openSettings();
    await page.click('#themeToggle');
    await page.click('[aria-label="Forest theme"]');
    check(await dt() === 'forest', 'C4: data-theme forest, got ' + await dt());
    check((await page.locator('#themeName').innerText()).trim() === 'Forest', 'C4: name');
    check((await norm('#themeToggle')).startsWith('Appearance · Forest'), 'C4: toggle text');
    check(await page.locator('#themePanel').isVisible() && await exp() === 'true', 'C4: panel stays open');
    check(await page.locator('[aria-label="Forest theme"]').evaluate(e => e.classList.contains('on')), 'C4: Forest has .on');
    check((await stored()).theme === 'forest', 'C4: stored forest');
    await page.click('[aria-label="Auto theme"]');
    check(await dt() === await pageScheme(), 'C4: Auto -> ' + await dt() + ' vs scheme ' + await pageScheme());
    check((await page.locator('#themeName').innerText()).trim() === 'Auto' && (await stored()).theme === 'auto', 'C4: Auto name/stored');
  });

  await item('C5', async () => {
    await start(seed()); await openSettings();
    await page.click('#themeToggle'); await page.click('[aria-label="Forest theme"]');
    await page.reload(); await page.waitForSelector('.tabs');
    check(await dt() === 'forest', 'C5: forest before Settings');
    await openSettings();
    check((await norm('#themeToggle')).startsWith('Appearance · Forest'), 'C5: toggle text');
    check(await exp() === 'false' && !(await page.locator('#themePanel').isVisible()), 'C5: collapsed');
  });

  await item('C6', async () => {
    await start(seed()); await openSettings();
    await page.click('#themeToggle');
    check(await exp() === 'true', 'C6: expanded first');
    await page.click('[data-more]:visible'); await page.click('#moreSettings'); await page.waitForSelector('#themeToggle', { state: 'visible' });
    check(await exp() === 'false' && !(await page.locator('#themePanel').isVisible()), 'C6: collapsed after More round trip');
    check((await page.locator('#themeName').innerText()).trim() === 'Auto', 'C6: name unchanged');
    await page.click('#themeToggle');
    await page.click('[data-tab="diary"]');
    await openSettings();
    check(await exp() === 'false' && !(await page.locator('#themePanel').isVisible()), 'C6: collapsed after Diary round trip');
  });

  await item('C7', async () => {
    await start(seed()); await openSettings();
    const heads = await page.evaluate(() => [...document.querySelectorAll('#v-settings h2, #v-settings #themeToggle')].map(e => e.id === 'themeToggle' ? 'Appearance' : e.textContent.trim()));
    check(JSON.stringify(heads) === JSON.stringify(['Units', 'Daily goals', 'Appearance', 'Food databases', 'Sync between devices', 'Backup']), 'C7: headings ' + JSON.stringify(heads));
    const tops = await page.evaluate(() => ['wUnit', 'gK', 'themeToggle', 'srcUSDA', 'syncCard', 'bkExport'].map(i => document.getElementById(i).getBoundingClientRect().top));
    check(tops.every((t, i) => i === 0 || t > tops[i - 1]), 'C7: tops ' + tops.join(','));
  });

  await item('C8', async () => {
    await start(seed()); await openSettings();
    await page.selectOption('#wUnit', 'oz');
    await page.fill('#gK', '1800'); await page.press('#gK', 'Tab');
    const s = await stored();
    check(s.weightUnit === 'oz' && s.goals.k === 1800, 'C8: stored ' + s.weightUnit + ' ' + s.goals.k);
    check((await norm('#keyLine')) === 'USDA key: not set', 'C8: keyLine ' + await norm('#keyLine'));
    check(await page.locator('#keyEdit').isVisible() && !(await page.locator('#keyEditor').isVisible()), 'C8: edit visible, editor hidden');
    check(await page.locator('#syncCard').isVisible() && /Sync between devices/.test(await page.locator('#syncCard').innerText()), 'C8: syncCard');
    for (const i of ['bkExport', 'bkImport', 'wipe']) check(await page.locator('#' + i).isVisible(), 'C8: ' + i + ' visible');
  });

  await item('C9', async () => {
    await page.setViewportSize({ width: 375, height: 700 });
    await start(seed()); await openSettings();
    const m = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, h: document.getElementById('themeToggle').getBoundingClientRect().height, r: document.getElementById('themeToggle').getBoundingClientRect().right }));
    let a = await m();
    check(a.sw <= a.iw, 'C9: collapsed scrollWidth ' + a.sw + '/' + a.iw);
    check(a.h >= 40, 'C9: height ' + a.h);
    check(a.r <= a.iw, 'C9: right edge ' + a.r);
    await page.click('#themeToggle');
    a = await m();
    check(a.sw <= a.iw, 'C9: expanded scrollWidth ' + a.sw + '/' + a.iw);
    await screenshot('settings-tidy-375-expanded');
  });

  await item('C10', async () => {
    for (const [t, name] of [['<img src=x onerror="window.__x=1">', 'Light'], ['__proto__', 'Light'], [7, 'Auto']]) {
      const before = errs.length;
      await start(seed({ theme: t })); await openSettings();
      if (name === 'Light' && typeof t === 'string') check(await dt() === 'light', 'C10: data-theme ' + await dt() + ' for ' + t);
      check((await page.locator('#themeName').innerText()).trim() === name, 'C10: name for ' + JSON.stringify(t) + ' = ' + await page.locator('#themeName').innerText());
      check(await page.evaluate(() => window.__x) === undefined, 'C10: __x set');
      check(await page.locator('#themeToggle img').count() === 0, 'C10: img inside toggle');
      await page.click('#themeToggle');
      check(errs.length === before, 'C10: errors ' + errs.slice(before).join('|'));
    }
  });

  await item('C11', async () => {
    await start(seed()); await openSettings();
    check(await page.locator('#themePanel').evaluate(e => e.hasAttribute('hidden') && getComputedStyle(e).display === 'none'), 'C11: hidden + display none');
    await page.click('#themeToggle');
    check(await page.locator('#themePanel').evaluate(e => !e.hasAttribute('hidden')), 'C11: hidden attr removed');
  });

  await item('C12', async () => {
    await start(seed()); await openSettings();
    await page.click('#themeToggle');
    for (const [lab, name] of [['Dark theme', 'Dark'], ['Light theme', 'Light']]) {
      await page.click(`[aria-label="${lab}"]`);
      check((await page.locator('#themeName').innerText()).trim() === name && await exp() === 'true' && await page.locator('#themePanel').isVisible(), 'C12: ' + lab);
    }
  });

  // Look comparison (reported by console, not a pass/fail)
  await item('LOOK', async () => {
    await page.setViewportSize({ width: 375, height: 800 });
    await start(seed()); await openSettings();
    const info = await page.evaluate(() => {
      const cs = (el, props) => { const c = getComputedStyle(el); return Object.fromEntries(props.map(p => [p, c[p]])); };
      const P = ['fontSize', 'fontWeight', 'fontFamily', 'color', 'textTransform', 'letterSpacing', 'lineHeight', 'textAlign', 'paddingLeft', 'paddingTop', 'marginTop', 'marginBottom'];
      const out = {};
      const tg = document.getElementById('themeToggle');
      out.toggle = { ...cs(tg, [...P, 'backgroundColor', 'borderTopWidth', 'justifyContent', 'display']), rect: tg.getBoundingClientRect().toJSON(), cardPad: cs(tg.closest('.card'), ['paddingLeft', 'paddingTop']), cardRect: tg.closest('.card').getBoundingClientRect().toJSON() };
      out.h2 = [...document.querySelectorAll('#v-settings h2')].map(h => ({ t: h.textContent.trim(), ...cs(h, P), left: h.getBoundingClientRect().left, top: h.getBoundingClientRect().top, cardLeft: h.closest('.card').getBoundingClientRect().left }));
      const sp = [...tg.children].map(c => ({ tag: c.tagName, id: c.id, text: c.textContent.trim(), ...cs(c, ['fontSize', 'fontWeight', 'color']), left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right }));
      out.children = sp;
      out.cardRects = [...document.querySelectorAll('#v-settings .card')].map(c => ({ h: c.getBoundingClientRect().height, top: c.getBoundingClientRect().top }));
      return out;
    });
    console.log('LOOK ' + JSON.stringify(info, null, 1));
    await screenshot('settings-tidy-375-collapsed');
    // focus ring via keyboard
    await page.focus('#goalsDummyNone').catch(() => {});
    await page.evaluate(() => document.getElementById('gF').focus());
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { id: e.id, outline: c.outline, outlineOffset: c.outlineOffset, boxShadow: c.boxShadow, fv: e.matches(':focus-visible') }; });
    console.log('FOCUS toggle ' + JSON.stringify(f));
    await screenshot('settings-tidy-375-focus-toggle');
    await page.keyboard.press('Tab');
    const g = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { id: e.id, outline: c.outline, outlineOffset: c.outlineOffset, boxShadow: c.boxShadow }; });
    console.log('FOCUS next ' + JSON.stringify(g));
    // expanded state, dark theme-ish screenshot not needed
  });

  check(errs.length === 0, 'page errors: ' + errs.join(' | '));
  if (fails.length) throw new Error(fails.join(' ;; '));
};
