// docs/specs/sleep-overlap.md headless checklist C1..C4. Made-up data only; zip built with tests/zip-builder.js.
import { buildZip } from '../../../tests/zip-builder.js';

const chicagoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const T = chicagoToday();
const D = n => { const [y, m, d] = T.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
const HEAD = 'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source\r\n';
const row = (id, type, asleep, s, e, src = 'DERIVED') => `${id},${type},${asleep + 30},0,5,${asleep},30,10,5,-06:00,${D(1)}T${s}Z,-06:00,${D(1)}T${e}Z,${src}\r\n`;
const zipOf = rows => buildZip([{ name: 'Takeout/Google Health/Health Fitness Data_GoogleData/UserSleeps_2026.csv', data: HEAD + rows.join('') }]).bytes;
const seed = () => ({ schemaVersion: 9, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days: {} });

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });
  const fails = [];
  const item = async (id, fn) => { try { await fn(); console.log('PASS ' + id); } catch (e) { fails.push(id + ': ' + e.message); console.log('FAIL ' + id + ' ' + e.message); try { console.log('  screenshot: ' + await screenshot('sleep-overlap-' + id + '-fail')); } catch {} } };
  const start = async () => {
    await page.goto(url + '/index.html');
    await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), seed());
    await page.reload(); await page.waitForSelector('.tabs');
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')));
  const status = async () => (await page.locator('#ghStatus').textContent()).trim();
  const run = async buf => {
    await page.click('[data-tab="settings"]'); await page.waitForSelector('#ghFile', { state: 'visible' });
    await page.selectOption('#ghScope', 'year');
    await page.setInputFiles('#ghFile', { name: 'takeout.zip', mimeType: 'application/zip', buffer: buf });
    await page.click('#ghStart');
    await page.waitForFunction(() => { const t = document.getElementById('ghStatus').textContent.trim(); return t && !/^Reading/.test(t); }, null, { timeout: 30000 });
  };
  const diaryPrev = async () => {
    await page.click('[data-tab="diary"]'); await page.waitForSelector('#dialsOpen', { state: 'visible' });
    await page.click('#todayBtn');
    await page.evaluate(() => document.getElementById('prev').click());
  };
  const line = async () => { const l = page.locator('#activityLine'); return (await l.isVisible()) ? (await l.textContent()).trim() : ''; };

  const zip1 = zipOf([row('n1', 'STAGES', 386, '07:00:00', '13:52:00'), row('n2', 'STAGES', 369, '06:55:00', '13:54:00'),
    row('p1', 'STAGES', 56, '17:00:00', '18:09:00'), row('p2', 'CLASSIC', 87, '16:50:00', '18:18:00')]);
  let status1 = '';
  await item('C1', async () => {
    await start(); await run(zip1); status1 = await status();
    check(status1.includes('1 day of sleep'), 'C1: status "' + status1 + '"');
    await diaryPrev();
    const l = await line();
    check(await page.locator('#activityLine').isVisible(), 'C1: line visible');
    check(l.includes('Sleep 7 h 53 min') && !l.includes('14 h 58'), 'C1: line "' + l + '"');
    const a = (await stored()).activity[D(1)];
    check(a && a.sleepMinutes === 473, 'C1: sleepMinutes ' + JSON.stringify(a));
    await screenshot('sleep-overlap-C1');
  });
  await item('C2', async () => {
    const before = (await stored()).activity[D(1)].updatedAt;
    await new Promise(r => setTimeout(r, 2000));
    await run(zip1);
    check(await status() === status1, 'C2: status "' + await status() + '" vs "' + status1 + '"');
    const a = (await stored()).activity[D(1)];
    check(a.updatedAt === before, 'C2: updatedAt changed ' + before + ' -> ' + a.updatedAt);
    check(a.sleepMinutes === 473, 'C2: sleepMinutes ' + a.sleepMinutes);
    await diaryPrev();
    check((await line()).includes('Sleep 7 h 53 min'), 'C2: line "' + await line() + '"');
  });
  await item('C3', async () => {
    await start(); await run(zipOf([row('a1', 'STAGES', 400, '07:00:00', '14:00:00'), row('a2', 'CLASSIC', 45, '19:00:00', '20:00:00')]));
    await diaryPrev();
    check((await line()).includes('Sleep 7 h 25 min'), 'C3: line "' + await line() + '"');
    check((await stored()).activity[D(1)].sleepMinutes === 445, 'C3: sleepMinutes ' + (await stored()).activity[D(1)].sleepMinutes);
  });
  await item('C4', async () => {
    await start(); await run(zipOf([row('b1', 'STAGES', 420, '06:00:00', '14:00:00'), row('b2', 'CLASSIC', 45, '13:59:00', '15:00:00')]));
    await diaryPrev();
    check((await line()).includes('Sleep 7 h 45 min'), 'C4: line "' + await line() + '"');
    check((await stored()).activity[D(1)].sleepMinutes === 465, 'C4: sleepMinutes ' + (await stored()).activity[D(1)].sleepMinutes);
  });
  check(errs.length === 0, 'page errors: ' + errs.join(' | '));
  check(fails.length === 0, 'Failed items: ' + fails.join(' || '));
};
