// docs/specs/sleep-latest-update.md headless check (made-up data; zip built with tests/zip-builder.js).
// Real-shaped rows: America/Chicago (-06:00), local time + 6 h = UTC. The record with the latest sleep_last_updated is kept.
import { buildZip } from '../../../tests/zip-builder.js';

const T = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const D = n => { const [y, m, d] = T.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
const HEAD = 'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source,sleep_last_updated\r\n';
// local "HH:MM" on local day d -> UTC instant (+6 h, may roll to the next UTC day)
const utc = (d, hm) => { const [y, m, dd] = d.split('-').map(Number); const [h, mi] = hm.split(':').map(Number); return new Date(Date.UTC(y, m - 1, dd, h + 6, mi)).toISOString().slice(0, 19) + 'Z'; };
const row = (id, type, asleep, day, s, e, upd) => `${id},${type},${asleep + 30},0,5,${asleep},30,10,5,-06:00,${utc(day, s)},-06:00,${utc(day, e)},DERIVED,${upd}\r\n`;
const seed = () => ({ schemaVersion: 9, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 }, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false,
  recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: { checks: {}, extras: {} }, days: {} });

export default async ({ page, url, check, screenshot }) => {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' });

  const DAY1 = D(2), DAY2 = D(1);
  const rows = [
    // day 1: A older (497 min) vs B newer (491 min): B (latest update) wins
    row('A', 'STAGES', 497, DAY1, '00:25', '09:19', '2026-11-12T15:32:33Z'),
    row('B', 'STAGES', 491, DAY1, '00:31', '09:19', '2026-11-12T19:34:34Z'),
    // day 2: night 386 (latest) vs 369; nap 56 (latest, 17:21:37Z) vs 87 (17:21:35Z)
    row('N1', 'STAGES', 386, DAY2, '00:20', '07:40', '2026-11-13T15:00:10Z'),
    row('N2', 'STAGES', 369, DAY2, '00:30', '07:40', '2026-11-13T14:00:00Z'),
    row('P1', 'CLASSIC', 87, DAY2, '09:41', '11:09', '2026-11-13T17:21:35Z'),
    row('P2', 'STAGES', 56, DAY2, '09:52', '11:01', '2026-11-13T17:21:37Z'),
  ];
  const buf = buildZip([{ name: 'Takeout/Google Health/Health Fitness Data_GoogleData/UserSleeps_2026.csv', data: HEAD + rows.join('') }]).bytes;

  await page.goto(url + '/index.html');
  await page.evaluate(v => localStorage.setItem('macrodiary.v1', JSON.stringify(v)), seed());
  await page.reload(); await page.waitForSelector('.tabs');
  await page.click('[data-tab="settings"]'); await page.waitForSelector('#ghFile', { state: 'visible' });
  await page.selectOption('#ghScope', 'year');
  await page.setInputFiles('#ghFile', { name: 'takeout.zip', mimeType: 'application/zip', buffer: buf });
  await page.click('#ghStart');
  await page.waitForFunction(() => { const t = document.getElementById('ghStatus').textContent.trim(); return t && !/^Reading/.test(t); }, null, { timeout: 30000 });
  console.log('status: ' + (await page.locator('#ghStatus').textContent()).trim());

  await page.click('[data-tab="diary"]'); await page.waitForSelector('#dialsOpen', { state: 'visible' });
  await page.click('#todayBtn');
  const line = async () => { const l = page.locator('#activityLine'); return (await l.isVisible()) ? (await l.textContent()).trim() : ''; };
  const prev = () => page.evaluate(() => document.getElementById('prev').click());

  await prev(); // yesterday = DAY2
  const l2 = await line();
  await screenshot('sleep-latest-update-day2');
  check(l2.includes('Sleep 7 h 22 min'), 'day ' + DAY2 + ' expected "Sleep 7 h 22 min", line "' + l2 + '"');
  await prev(); // DAY1
  const l1 = await line();
  await screenshot('sleep-latest-update-day1');
  check(l1.includes('Sleep 8 h 11 min'), 'day ' + DAY1 + ' expected "Sleep 8 h 11 min", line "' + l1 + '"');

  const act = (await page.evaluate(() => JSON.parse(localStorage.getItem('macrodiary.v1')))).activity || {};
  check(act[DAY1] && act[DAY1].sleepMinutes === 491, 'stored ' + DAY1 + ' ' + JSON.stringify(act[DAY1]));
  check(act[DAY2] && act[DAY2].sleepMinutes === 442, 'stored ' + DAY2 + ' ' + JSON.stringify(act[DAY2]));
  check(errs.length === 0, 'page errors: ' + errs.join(' | '));
};
