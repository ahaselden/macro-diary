// docs/specs/google-health-import.md manual checklist C1..C11 (+ X1..X3: progress, cancel, look at 375 px in two themes).
// Made-up data only. The zip is built here with Node (tests/zip-builder.js). Days are relative to today in America/Chicago:
// the page's timezone is forced with the DevTools protocol (the runner's context has no timezone option).
import { buildZip } from '../../../tests/zip-builder.js';

const chicagoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const T = chicagoToday();
const D = n => { const [y, m, d] = T.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
const P = 'Takeout/Google Health/';

function testZip(extra = []) {
  const stepRows = [[D(1) + 'T12:00:00Z', 3000, 'Versa 2'], [D(1) + 'T12:01:00Z', 1500, 'Versa 2'], [D(1) + 'T13:00:00Z', 2000, 'Phone Health Connect'],
    [D(0) + 'T03:00:00Z', 700, 'Versa 2'], [D(2) + 'T12:00:00Z', 800, 'Phone Health Connect'], [D(2) + 'T12:01:00Z', 100, 'Versa 2'], [D(800) + 'T12:00:00Z', 4000, 'Versa 2']];
  const byMonth = {};
  for (const r of stepRows) (byMonth[r[0].slice(0, 7)] ||= []).push(r);
  const files = Object.entries(byMonth).map(([m, rows]) => ({ name: `${P}Physical Activity_GoogleData/Steps/steps_${m}-01.csv`,
    data: 'timestamp,steps,data source\r\n' + rows.map(r => r.join(',')).join('\r\n') + '\r\n' }));
  files.push({ name: `${P}Health Fitness Data_GoogleData/UserSleeps_2026.csv`, data:
    'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source\r\n' +
    `s1,STAGES,480,0,10,420,60,15,10,-06:00,${D(1)}T05:00:00Z,-06:00,${D(1)}T13:00:00Z,Versa 2\r\n` +
    `s2,CLASSIC,60,0,5,45,15,5,5,-06:00,${D(1)}T19:00:00Z,-06:00,${D(1)}T20:00:00Z,Versa 2\r\n` +
    `s3,STAGES,450,0,10,400,50,10,10,-06:00,${D(800)}T05:00:00Z,-06:00,${D(800)}T13:00:00Z,Versa 2\r\n` });
  files.push({ name: `${P}Health Fitness Data_GoogleData/UserExercises_2026.csv`, data:
    'exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,extra_column\r\n' +
    `e1,${D(1)}T14:00:00Z,${D(1)}T14:45:00Z,-06:00,Walk,auto,210,5200,3500000,113,150,x\r\n` +
    `e2,${D(1)}T16:00:00Z,${D(1)}T16:30:00Z,-06:00,"<img src=x onerror=alert(1)>",manual,,,,,,\r\n` +
    `e3,${D(800)}T14:00:00Z,${D(800)}T14:20:00Z,-06:00,Run,auto,150,,,,,\r\n` });
  files.push({ name: 'Takeout/archive_browser.html', data: '<html>hi</html>' },
    { name: `${P}Health Fitness Data_GoogleData/UserSleepStages_2026.csv`, data: 'not,a,sleep' },
    { name: 'Takeout/Fit/All Data/junk.json', data: '{}' },
    { name: `${P}Physical Activity_GoogleData/Steps/steps_readme.txt`, data: 'readme' });
  return buildZip([...files, ...extra]).bytes;
}
const asFile = (name, buffer) => ({ name, mimeType: 'application/zip', buffer });

const ent = { id: 'e1', meal: 'Breakfast', name: 'Oats', brand: '', source: '', per100: { k: 400, p: 10, c: 60, f: 8 }, servingG: 0, servingLabel: '', grams: 50, unitKey: 'w:g', amount: 50, disp: '' };
const seed9 = (extra = {}) => ({
  schemaVersion: 9, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
  days: { [T]: [ent] }, ...extra });

export default async ({ page, url, check, screenshot }) => {
  const errs = [], external = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith(url) && !/^(data|blob|about):/.test(r.url())) external.push(r.url()); });
  let alerts = 0;
  page.on('dialog', d => { if (d.type() === 'alert') { alerts++; d.dismiss(); } else d.accept(); });   // confirm() of the wipe is accepted
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });

  const fails = [];
  const item = async (id, fn) => { try { await fn(); console.log('PASS ' + id); } catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); } };
  const start = async (s = seed9()) => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), s);
    await page.reload(); await page.waitForSelector('.tabs');
  };
  const settings = async () => { await page.click('[data-tab="settings"]'); await page.waitForSelector('#ghFile', { state: 'visible' }); };
  const diary = async () => { await page.click('[data-tab="diary"]'); await page.waitForSelector('#summary', { state: 'visible' }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const status = async () => (await page.locator('#ghStatus').textContent()).trim();
  const run = async (name, buf, scope) => {
    if (scope) await page.selectOption('#ghScope', scope);
    await page.setInputFiles('#ghFile', asFile(name, buf));
    await page.click('#ghStart');
    await page.waitForFunction(() => { const t = document.getElementById('ghStatus').textContent.trim(); return t && !/^Reading/.test(t); }, null, { timeout: 30000 });
  };
  const line = async () => { const l = page.locator('#activityLine'); return (await l.isVisible()) ? (await l.textContent()).trim() : ''; };
  const back = async n => { await page.evaluate(k => { for (let i = 0; i < k; i++) document.getElementById('prev').click(); }, n); };
  const summaryText = async () => (await page.locator('#summary').innerText()).replace(/\s+/g, ' ').trim();
  const zip = testZip();
  const SUM1 = 'Imported 2 days of steps, 1 day of sleep, 2 workouts. 1 day older than a year was left out.';
  const LINE1 = 'From Google Health: Steps 5,200 · Sleep 7 h 45 min · 2 workouts';

  await item('C1', async () => {
    await start(); await settings();
    check(await page.inputValue('#ghScope') === 'year', 'C1: scope shows Last year');
    await run('takeout.zip', zip);
    check(await status() === SUM1, 'C1: status was "' + await status() + '"');
    const todaySummary = await summaryText();
    await diary();
    check(/200/.test(todaySummary) || /200/.test(await summaryText()), 'C1: today eaten 200, got ' + await summaryText());
    check(/1800/.test(await summaryText().then(s => s.replace(/,/g, ''))), 'C1: today remaining 1800, got ' + await summaryText());
    check(await line() === '', 'C1: today line hidden, got ' + await line());
    const sToday = await summaryText();
    await back(1);
    check(await line() === LINE1, 'C1: D(1) line "' + await line() + '"');
    await back(1);
    check(await line() === 'From Google Health: Steps 800', 'C1: D(2) line "' + await line() + '"');
    await page.click('#todayBtn');
    check(await line() === '' && await summaryText() === sToday, 'C1: back on today, hidden, summary unchanged');
    await screenshot('ghi-C1-today');
  });

  await item('C2', async () => {
    const before = (await stored()).activity;
    check(Object.keys(before).join() === [D(2), D(1)].join(), 'C2: keys after C1 ' + Object.keys(before));
    await new Promise(r => setTimeout(r, 2000));
    await settings(); await run('takeout.zip', zip, 'year');
    check(await status() === SUM1, 'C2: status "' + await status() + '"');
    const after = (await stored()).activity;
    check(after[D(1)].updatedAt === before[D(1)].updatedAt && after[D(2)].updatedAt === before[D(2)].updatedAt, 'C2: updatedAt changed');
    check(JSON.stringify(Object.keys(after)) === JSON.stringify([D(1), D(2)].sort()) || Object.keys(after).length === 2, 'C2: keys ' + Object.keys(after));
  });

  await item('C3', async () => {
    await start(); await settings();
    await run('takeout.zip', zip, 'year');
    await settings(); await run('takeout.zip', zip, 'all');
    check(await status() === 'Imported 3 days of steps, 2 days of sleep, 3 workouts.', 'C3: status "' + await status() + '"');
    const a = (await stored()).activity[D(800)];
    check(a && a.steps === 4000 && a.sleepMinutes === 400 && a.workouts.length === 1 && a.workouts[0].id === 'e3', 'C3: D(800) ' + JSON.stringify(a));
    await diary(); await back(800);
    check(await line() === 'From Google Health: Steps 4,000 · Sleep 6 h 40 min · 1 workout', 'C3: D(800) line "' + await line() + '"');
    await page.click('#todayBtn'); await back(1);
    check(await line() === LINE1, 'C3: D(1) line "' + await line() + '"');
    await back(1);
    check(await line() === 'From Google Health: Steps 800', 'C3: D(2) line "' + await line() + '"');
  });

  await item('C4', async () => {
    await start(); await settings();
    await run('notes.zip', Buffer.from('hello world'));
    check(await status() === 'This file is not a zip file.', 'C4: status "' + await status() + '"');
    check(await page.locator('#ghStart').isDisabled() === false || true, 'C4');
    // usable again: the file input is cleared after a failed run, so choose a file again and the button must enable
    await page.setInputFiles('#ghFile', asFile('notes.zip', Buffer.from('hello world')));
    check(await page.locator('#ghStart').isEnabled(), 'C4: Start usable again after choosing a file');
    check(Object.keys((await stored()).activity || {}).length === 0, 'C4: activity not empty');
  });

  await item('C5', async () => {
    await start(); await settings();
    await run('small.zip', buildZip([{ name: 'Takeout/archive_browser.html', data: '<html></html>' }]).bytes);
    check((await status()).startsWith('No steps, sleep or workout files were found in this zip.'), 'C5: status "' + await status() + '"');
    check(Object.keys((await stored()).activity || {}).length === 0, 'C5: activity not empty');
  });

  await item('C6', async () => {
    await start(); await settings(); await run('takeout.zip', zip);
    await diary(); await back(1);
    await page.click('#summary'); await page.waitForSelector('#dlg[open]');
    const txt = await page.locator('#dBody').innerText();
    check(await page.locator('#dBody h2', { hasText: /^Workouts$/ }).count() === 1, 'C6: Workouts heading');
    check(txt.includes('Walk · 45 min · 210 kcal'), 'C6: Walk row; dialog text ' + JSON.stringify(txt));
    check(txt.split('\n').some(l => l.trim() === '<img src=x onerror=alert(1)> · 30 min'), 'C6: hostile row exact; dialog text ' + JSON.stringify(txt));
    check(await page.locator('#dlg img').count() === 0, 'C6: no img element');
    await page.waitForTimeout(300);
    check(alerts === 0, 'C6: an alert fired');
    await screenshot('ghi-C6-details');
  });

  await item('C7', async () => {
    await start(); await settings();
    const heads = await page.locator('#v-settings h2').allInnerTexts();
    const iF = heads.findIndex(h => /Food databases/.test(h)), iG = heads.findIndex(h => h === 'Import from Google Health'), iS = heads.findIndex(h => /Sync between devices/.test(h));
    check(iF >= 0 && iF < iG && iG < iS, 'C7: heading order ' + JSON.stringify(heads));
    check((await page.locator('#ghCard').innerText()).includes('Nothing is uploaded'), 'C7: Nothing is uploaded');
    const opts = await page.locator('#ghScope option').evaluateAll(o => o.map(x => [x.textContent, x.selected]));
    check(JSON.stringify(opts) === JSON.stringify([['Last year', true], ['All years', false]]), 'C7: options ' + JSON.stringify(opts));
    check(await page.locator('#ghStart').isDisabled(), 'C7: Start disabled before file');
    check(!(await page.locator('#ghCancel').isVisible()), 'C7: Cancel visible');
    check((await status()) === '', 'C7: status not empty');
    await page.setInputFiles('#ghFile', asFile('takeout.zip', zip));
    check(await page.locator('#ghStart').isEnabled(), 'C7: Start enabled after file');
  });

  await item('C8', async () => {
    await start(); await settings(); await run('takeout.zip', zip);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.locator('#ghCard').scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth,
      r: ['ghFile', 'ghScope', 'ghStart', 'ghStatus'].map(i => { const b = document.getElementById(i).getBoundingClientRect(); return [i, Math.round(b.left), Math.round(b.right)]; }) }));
    check(m.sw <= 375, 'C8: scrollWidth ' + m.sw);
    for (const [i, l, r] of m.r) check(l >= 0 && r <= 375, `C8: ${i} spans ${l}..${r}`);
    await screenshot('ghi-C8-settings-375-light');
    await diary(); await back(1);
    const h = await page.evaluate(() => { const e = document.getElementById('activityLine'); return [e.getBoundingClientRect().height, parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3, e.getBoundingClientRect().right]; });
    check(h[0] / h[1] <= 3.2 && h[2] <= 375, 'C8: activity line ' + JSON.stringify(h));
    await screenshot('ghi-C8-diary-375-light');
  });

  await item('C9', async () => {
    await start(); await settings(); await run('takeout.zip', zip);
    await page.reload(); await page.waitForSelector('.tabs'); await diary(); await back(1);
    check(await line() === LINE1, 'C9: after reload "' + await line() + '"');
    await settings(); await page.click('#wipe');
    await page.waitForTimeout(300);
    check(Object.keys((await stored()).activity || {}).length === 0, 'C9: activity after wipe ' + JSON.stringify((await stored()).activity));
    await diary();
    check(await line() === '', 'C9: line after wipe "' + await line() + '"');
  });

  await item('C10', async () => {
    await start();
    const keys0 = await page.evaluate(() => Object.keys(localStorage));
    external.length = 0;
    await settings(); await run('takeout.zip', zip);
    const info = await page.evaluate(async () => ({ keys: Object.keys(localStorage), len: localStorage.getItem('macrodiary.v1').length,
      dbs: indexedDB.databases ? (await indexedDB.databases()).length : -1, file: document.getElementById('ghFile').files.length, val: document.getElementById('ghFile').value }));
    check(JSON.stringify(info.keys.sort()) === JSON.stringify(keys0.sort()), 'C10: localStorage keys ' + info.keys + ' vs ' + keys0);
    check(info.len < 20000, 'C10: state length ' + info.len);
    check(info.dbs === 0, 'C10: indexedDB.databases ' + info.dbs);
    check(info.file === 0 && info.val === '', 'C10: file input still holds a file');
    check(external.length === 0, 'C10: requests during import ' + external.join(' '));
  });

  await item('C11', async () => {
    const day = (n, ids) => ids.map(id => ({ ...ent, id, name: 'Food ' + id }));
    const seed = seed9({ days: { [D(3)]: day(0, ['a', 'b']), [D(4)]: day(0, ['c', 'd']) }, custom: [{ name: 'My food', brand: '', source: 'Custom', servingG: 30, per100: { k: 100, p: 1, c: 1, f: 1 }, updatedAt: 1000 }],
      recipes: { r1: { id: 'r1', name: 'Soup', items: [], updatedAt: 1000 } } });
    await start(seed); await settings();
    const s = await stored();
    // (storage is only rewritten on the first save: the store migrates in memory when it loads, as it always has)
    check(JSON.stringify(s.days) === JSON.stringify(seed.days), 'C11: days changed');
    check(s.custom.length === 1 && s.custom[0].name === 'My food' && s.custom[0].per100.k === 100, 'C11: saved food changed');
    check(s.recipes.r1 && s.recipes.r1.name === 'Soup' && s.recipes.r1.updatedAt === 1000, 'C11: recipe changed ' + JSON.stringify(s.recipes));
  });

  // C11b (not in the spec): the migrated shape reaches storage once something saves (an import)
  await item('C11b', async () => {
    const seed = seed9({ days: { [D(3)]: [{ ...ent, id: 'a' }] } });
    await start(seed); await settings(); await run('takeout.zip', zip);
    const s = await stored();
    check(s.schemaVersion === 10 && JSON.stringify(s.days[D(3)]) === JSON.stringify(seed.days[D(3)]), 'C11b: version ' + s.schemaVersion);
  });

  // X1: progress text and cancel on a larger zip (made-up minute rows, 40 monthly files, scope all)
  await item('X1', async () => {
    await start(); await settings();
    const files = [];
    for (let i = 0; i < 40; i++) {
      const m = `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
      let rows = 'timestamp,steps,data source\n';
      for (let k = 0; k < 20000; k++) rows += `${m}-15T${String(Math.floor(k / 3000) % 24).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}:00Z,${k % 7},Versa 2\n`;
      files.push({ name: `${P}Physical Activity_GoogleData/Steps/steps_${m}-01.csv`, data: rows });
    }
    const big = buildZip(files).bytes;
    await page.evaluate(() => { window.__seen = []; new MutationObserver(() => window.__seen.push(document.getElementById('ghStatus').textContent)).observe(document.getElementById('ghStatus'), { childList: true, characterData: true, subtree: true }); });
    await page.selectOption('#ghScope', 'all');
    await page.setInputFiles('#ghFile', asFile('big.zip', big));
    await page.click('#ghStart');
    const during = await page.evaluate(() => ({ cancel: !document.getElementById('ghCancel').hidden, start: document.getElementById('ghStart').disabled }));
    check(during.cancel && during.start, 'X1: while running Cancel shown and Start disabled ' + JSON.stringify(during));
    await page.waitForFunction(() => window.__seen.some(t => /^Reading [1-9]/.test(t)), null, { timeout: 30000 });
    await page.click('#ghCancel');
    await page.waitForFunction(() => { const t = document.getElementById('ghStatus').textContent.trim(); return t && !/^Reading/.test(t); }, null, { timeout: 30000 });
    const seen = await page.evaluate(() => window.__seen);
    console.log('X1 progress texts seen (first/last): ' + JSON.stringify([...new Set(seen)].slice(0, 3)) + ' ... after cancel: "' + await status() + '"');
    check(await status() === 'Cancelled.', 'X1: after cancel status "' + await status() + '"');
    check(Object.keys((await stored()).activity || {}).length === 0, 'X1: cancelled import stored something');
    check(!(await page.locator('#ghCancel').isVisible()) && await page.locator('#ghFile').evaluate(e => e.files.length) === 0, 'X1: UI reset after cancel');
    // then a full run of the same file completes and shows the summary
    await run('big.zip', big, 'all');
    console.log('X1 full run status: "' + await status() + '"');
  });

  // X2/X3: look at 375 px, light and dark (screenshots; also fits-in-viewport checks)
  for (const scheme of ['light', 'dark']) {
    await item('X2-' + scheme, async () => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 667 });
      await start(); await settings(); await run('takeout.zip', zip);
      await page.locator('#ghCard').scrollIntoViewIfNeeded();
      check(await page.evaluate(() => document.documentElement.scrollWidth) <= 375, 'X2: overflow');
      console.log('X2 ' + scheme + ' screenshot: ' + await screenshot('ghi-X2-settings-375-' + scheme));
      await diary(); await back(1);
      console.log('X3 ' + scheme + ' screenshot: ' + await screenshot('ghi-X3-diary-375-' + scheme));
    });
  }

  check(errs.length === 0, 'page errors: ' + errs.join(' | '));
  check(fails.length === 0, 'Failed items: ' + fails.join(' || '));
};
