// Tests for docs/specs/plan-month.md (domain + autoplan-over-a-month). Written before the implementation exists.
// Calendar facts are hand derived (see comments): 2026-01-01 Thu, 2027-01-01 Fri, 2028-01-01 Sat, 2025-01-01 Wed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../js/core/schema.js';
import { addPlanItem, recipeItem, foodItem, getDay } from '../js/domain/plan.js';
import { addDays, parse, fmt } from '../js/core/dates.js';

const P = () => import('../js/domain/plan.js');
const call = async (name, ...a) => { const m = await P(); assert.equal(typeof m[name], 'function', `plan.js must export ${name}`); return m[name](...a); };
const A = () => import('../js/domain/autoplan.js');

const rec = (id, kcal) => ({ id, name: 'Zzyzx ' + id, description: '', source: '', servings: 1, totalTime: null, tags: [], steps: [], favorite: false, updatedAt: 1,
  ingredients: [{ id: 'i1', raw: '100 g x', name: 'x', qty: 100, unit: 'g', prep: '', food: { name: 'X', brand: '', source: '', per100: { k: kcal, p: 0, c: 0, f: 0 }, servingG: 0 }, grams: 100 }] });
const mk = recs => { const s = defaults(); for (const r of recs) s.recipes[r.id] = r; return s; };
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const consecutive = list => list.every((d, i) => i === 0 || d === addDays(list[i - 1], 1));
const rowsOk = rows => rows.every(r => r.length === 7);
const flat = rows => rows.flat().map(c => c.date);

// ---------- monthDates ----------
test('M1 monthDates: every day of the month, ascending, correct lengths (30/31/28/29)', async () => {
  const nov = await call('monthDates', '2025-11-17');
  assert.equal(nov.length, 30); assert.equal(nov[0], '2025-11-01'); assert.equal(nov.at(-1), '2025-11-30'); assert.ok(consecutive(nov));
  const jan = await call('monthDates', '2025-01-31'); assert.equal(jan.length, 31); assert.equal(jan[0], '2025-01-01'); assert.equal(jan.at(-1), '2025-01-31');
  assert.equal((await call('monthDates', '2027-02-01')).length, 28);   // 2027 is not a leap year
  assert.equal((await call('monthDates', '2025-02-28')).at(-1), '2025-02-28');
  assert.equal((await call('monthDates', '2025-11-01')).join(), nov.join());   // any day of the month gives the same list
});

test('M2 monthDates: leap February (2028 has 29 days, 2100 does not, 2000 does)', async () => {
  const f = await call('monthDates', '2028-02-10'); assert.equal(f.length, 29); assert.equal(f.at(-1), '2028-02-29');
  assert.equal((await call('monthDates', '2100-02-01')).length, 28);
  assert.equal((await call('monthDates', '2000-02-01')).length, 29);
});

test('M3 monthDates: December and January, year boundary', async () => {
  const dec = await call('monthDates', '2025-12-31'); assert.equal(dec.length, 31); assert.equal(dec[0], '2025-12-01'); assert.equal(dec.at(-1), '2025-12-31');
  const jan = await call('monthDates', '2026-01-01'); assert.equal(jan[0], '2026-01-01'); assert.equal(jan.at(-1), '2026-01-31');
});

test('M4 monthDates: DST months have one entry per calendar day (no skipped or doubled day)', async () => {
  for (const [any, n] of [['2025-03-09', 31], ['2025-11-02', 30], ['2025-03-30', 31], ['2025-10-26', 31]]) {
    const l = await call('monthDates', any);
    assert.equal(l.length, n, any); assert.ok(consecutive(l), any); assert.equal(new Set(l).size, n);
    assert.ok(l.every(d => fmt(parse(d)) === d));
  }
});

test('M5 monthDates: invalid input returns [] and never throws', async () => {
  for (const bad of ['', '2025-02-30', '2025-13-01', 'nope', '2025-11-17 ', '2025-1-1', null, undefined, 20251117, NaN, {}, [], ['2025-11-17'], new Date(), '__proto__', '2025-11-17<script>'])
    assert.deepEqual(await call('monthDates', bad), [], String(bad));
});

// ---------- monthStart / addMonths ----------
test('M6 monthStart: first of the month; invalid -> ""', async () => {
  assert.equal(await call('monthStart', '2025-11-17'), '2025-11-01');
  assert.equal(await call('monthStart', '2025-11-01'), '2025-11-01');
  assert.equal(await call('monthStart', '2028-02-29'), '2028-02-01');
  for (const bad of ['', '2025-02-30', null, undefined, 5, {}, 'x']) assert.equal(await call('monthStart', bad), '', String(bad));
});

test('M7 addMonths: returns the 1st of the month n months later, across years, negative n, n = 0', async () => {
  assert.equal(await call('addMonths', '2025-11-17', 1), '2025-12-01');
  assert.equal(await call('addMonths', '2025-12-31', 1), '2026-01-01');
  assert.equal(await call('addMonths', '2026-01-15', -1), '2025-12-01');
  assert.equal(await call('addMonths', '2025-01-31', 1), '2025-02-01');     // no day-of-month overflow into March
  assert.equal(await call('addMonths', '2025-03-31', -1), '2025-02-01');
  assert.equal(await call('addMonths', '2025-11-17', 0), '2025-11-01');
  assert.equal(await call('addMonths', '2025-11-17', 14), '2027-01-01');
  assert.equal(await call('addMonths', '2025-11-17', -23), '2023-12-01');
  assert.equal(await call('addMonths', '2025-11-17', 12), '2026-11-01');
});

test('M8 addMonths: invalid date or non-integer / non-finite n -> ""', async () => {
  for (const bad of ['', '2025-02-30', null, undefined, 3, 'x']) assert.equal(await call('addMonths', bad, 1), '', String(bad));
  for (const n of [NaN, Infinity, -Infinity, 1.5, '1', null, undefined, {}, []]) assert.equal(await call('addMonths', '2025-11-17', n), '', String(n));
});

// ---------- monthGrid ----------
test('M9 monthGrid: rows of 7, Monday first, 1st..last in month, padding flagged inMonth:false (Nov 2025: 1st is Saturday, 5 rows)', async () => {
  const g = await call('monthGrid', '2025-11-12');   // 2025-11-01 is a Saturday, 30th a Sunday
  assert.equal(g.length, 5); assert.ok(rowsOk(g));
  assert.equal(g[0][0].date, '2025-10-27'); assert.equal(g[0][0].inMonth, false);
  assert.equal(g[0][5].date, '2025-11-01'); assert.equal(g[0][5].inMonth, true); assert.equal(g[0][4].inMonth, false);
  assert.equal(g.at(-1)[6].date, '2025-11-30'); assert.equal(g.at(-1)[6].inMonth, true);
  assert.ok(consecutive(flat(g)));
  assert.equal(g.flat().filter(c => c.inMonth).length, 30);
  assert.ok(g.flat().every(c => typeof c.inMonth === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
});

test('M10 monthGrid: 4 rows when February starts on a Monday and has 28 days (Feb 2027)', async () => {
  const g = await call('monthGrid', '2027-02-15');   // 2027-02-01 is a Monday, 28th a Sunday
  assert.equal(g.length, 4); assert.equal(g[0][0].date, '2027-02-01'); assert.equal(g.at(-1)[6].date, '2027-02-28');
  assert.ok(g.flat().every(c => c.inMonth));
});

test('M11 monthGrid: 6 rows when needed (Aug 2026 starts Saturday and has 31 days; Mar 2025 too)', async () => {
  let g = await call('monthGrid', '2026-08-20');
  assert.equal(g.length, 6); assert.equal(g[0][0].date, '2026-07-27'); assert.equal(g.at(-1)[6].date, '2026-09-06');
  g = await call('monthGrid', '2025-03-09');
  assert.equal(g.length, 6); assert.equal(g[0][0].date, '2025-02-24'); assert.equal(g.at(-1)[6].date, '2025-04-06');
  assert.ok(consecutive(flat(g)));   // DST change days (2025-03-09 US, 2025-03-30 EU) are neither skipped nor doubled
});

test('M12 monthGrid: leap February 2028 (1st is Tuesday): 5 rows from Mon 2028-01-31 to Sun 2028-03-05', async () => {
  const g = await call('monthGrid', '2028-02-29');
  assert.equal(g.length, 5); assert.equal(g[0][0].date, '2028-01-31'); assert.equal(g[0][0].inMonth, false); assert.equal(g[0][1].date, '2028-02-01'); assert.equal(g[0][1].inMonth, true);
  assert.equal(g.at(-1)[6].date, '2028-03-05'); assert.equal(g.flat().filter(c => c.inMonth).length, 29); assert.ok(consecutive(flat(g)));
});

test('M13 monthGrid: December crosses the year (Dec 2025: Mon 2025-12-01 .. Sun 2026-01-04); first column is always a Monday as weekStart says', async () => {
  const g = await call('monthGrid', '2025-12-31');
  assert.equal(g.length, 5); assert.equal(g[0][0].date, '2025-12-01'); assert.equal(g.at(-1)[6].date, '2026-01-04'); assert.equal(g.at(-1)[6].inMonth, false);
  const { weekStart } = await P();
  for (const any of ['2025-11-12', '2026-08-01', '2028-02-29', '2025-03-09', '2025-11-02', '2025-10-26'])
    for (const row of await call('monthGrid', any)) assert.equal(weekStart(row[3].date), row[0].date, any);
});

test('M14 monthGrid: every month of 2025..2028 satisfies the grid invariants (4..6 rows, contiguous, covers exactly the month)', async () => {
  for (let y = 2025; y <= 2028; y++) for (let m = 1; m <= 12; m++) {
    const any = `${y}-${String(m).padStart(2, '0')}-01`;
    const g = await call('monthGrid', any), mine = await call('monthDates', any);
    assert.ok(g.length >= 4 && g.length <= 6, any); assert.ok(rowsOk(g), any); assert.ok(consecutive(flat(g)), any);
    assert.deepEqual(g.flat().filter(c => c.inMonth).map(c => c.date), mine, any);
    assert.ok(flat(g).indexOf(mine[0]) < 7, any); assert.ok(flat(g).length - 1 - flat(g).indexOf(mine.at(-1)) < 7, any);
  }
});

test('M15 monthGrid: invalid input returns [] and never throws', async () => {
  for (const bad of ['', '2025-02-30', null, undefined, 20251117, NaN, {}, 'nope', new Date()]) assert.deepEqual(await call('monthGrid', bad), [], String(bad));
});

// ---------- monthSummary ----------
test('M16 monthSummary: one entry per date of the month (not padding), shape {k, items, complete}', async () => {
  const s = await call('monthSummary', defaults(), '2025-11-17');
  assert.deepEqual(Object.keys(s), await call('monthDates', '2025-11-17'));
  for (const v of Object.values(s)) assert.deepEqual(Object.keys(v).sort(), ['complete', 'items', 'k']);
  assert.equal(Object.keys(await call('monthSummary', defaults(), '2028-02-01')).length, 29);
});

test('M17 monthSummary: empty days are {k:0, items:0, complete:true}; planned days carry kcal and item count (hand computed)', async () => {
  const s = mk([rec('a', 600), rec('b', 250)]);
  addPlanItem(s, '2025-11-05', 'Lunch', recipeItem('i1', 'a', 2), 1);        // 1200
  addPlanItem(s, '2025-11-05', 'Dinner', recipeItem('i2', 'b', 1.5), 1);     // 375
  addPlanItem(s, '2025-11-30', 'Snacks', recipeItem('i3', 'b', 1), 1);       // 250
  addPlanItem(s, '2025-12-01', 'Lunch', recipeItem('i4', 'a', 1), 1);        // other month: must not appear
  const m = await call('monthSummary', s, '2025-11-17');
  assert.deepEqual(m['2025-11-05'], { k: 1575, items: 2, complete: true });
  assert.deepEqual(m['2025-11-30'], { k: 250, items: 1, complete: true });
  assert.deepEqual(m['2025-11-06'], { k: 0, items: 0, complete: true });
  assert.ok(!('2025-12-01' in m) && !('2025-10-31' in m));
});

test('M18 monthSummary: k is NOT rounded; incomplete items make complete false (zero-gram food, deleted recipe)', async () => {
  const s = mk([]);
  const food = { name: 'F', brand: '', source: '', per100: { k: 10.1, p: 0, c: 0, f: 0 }, servingG: 0 };
  addPlanItem(s, '2025-11-02', 'Lunch', foodItem('f1', food, 50), 1);        // 5.05 kcal
  addPlanItem(s, '2025-11-03', 'Lunch', foodItem('f2', food, 0), 1);         // no grams -> incomplete, 0 kcal
  addPlanItem(s, '2025-11-04', 'Lunch', recipeItem('r1', 'gone', 1), 1);     // missing recipe -> incomplete
  const m = await call('monthSummary', s, '2025-11-01');
  assert.ok(Math.abs(m['2025-11-02'].k - 5.05) < 1e-9 && !Number.isInteger(m['2025-11-02'].k)); assert.equal(m['2025-11-02'].complete, true);
  assert.deepEqual(m['2025-11-03'], { k: 0, items: 1, complete: false });
  assert.equal(m['2025-11-04'].items, 1); assert.equal(m['2025-11-04'].complete, false);
});

test('M19 monthSummary: pure (deep-frozen state is unchanged and does not throw; no day records created)', async () => {
  const s = mk([rec('a', 600)]); addPlanItem(s, '2025-11-05', 'Lunch', recipeItem('i1', 'a', 1), 1);
  const before = JSON.stringify(s); deepFreeze(s);
  await call('monthSummary', s, '2025-11-17'); assert.equal(JSON.stringify(s), before);
  assert.deepEqual(Object.keys(s.plan), ['2025-11-05']);
});

test('M20 monthSummary: hostile state never throws; invalid date -> {}', async () => {
  for (const bad of [null, undefined, {}, [], 5, 'x', { plan: null }, { plan: {}, recipes: null }, { plan: [] }])
    // eslint-disable-next-line no-await-in-loop
    await call('monthSummary', bad, '2025-11-17');   // must not throw
  const keys = async st => Object.keys(await call('monthSummary', st, '2025-11-17')).length;
  assert.equal(await keys(null), 30); assert.equal(await keys({}), 30);        // treated as an empty plan
  // malformed day records: treated as empty days, never throw, k always finite
  const s = mk([]); s.plan['2025-11-02'] = {}; s.plan['2025-11-03'] = { slots: null }; s.plan['2025-11-04'] = { slots: { Lunch: 'x' } }; s.plan['2025-11-05'] = null;
  const m = await call('monthSummary', s, '2025-11-17');
  for (const v of Object.values(m)) { assert.ok(Number.isFinite(v.k)); assert.ok(Number.isInteger(v.items) && v.items >= 0); assert.equal(typeof v.complete, 'boolean'); }
  for (const bad of ['', '2025-02-30', null, 7, {}]) assert.deepEqual(await call('monthSummary', defaults(), bad), {}, String(bad));
});

test('M21 monthSummary: prototype keys in plan/recipes do not leak into results or pollute', async () => {
  const s = mk([]); s.plan = JSON.parse('{"__proto__":{"polluted":1},"2025-11-02":{"updatedAt":1,"slots":{"Lunch":[],"Dinner":[],"Breakfast":[],"Snacks":[]}}}');
  const m = await call('monthSummary', s, '2025-11-17');
  assert.equal(({}).polluted, undefined); assert.ok(!('polluted' in m)); assert.equal(Object.keys(m).length, 30);
  const s2 = mk([]); addPlanItem(s2, '2025-11-02', 'Lunch', recipeItem('i', 'constructor', 1), 1);   // inherited key, not a recipe
  assert.equal((await call('monthSummary', s2, '2025-11-17'))['2025-11-02'].complete, false);
});

// ---------- autofillDates ----------
test('M22 autofillDates week: the Monday-Sunday week containing viewDate; nothing skipped when today is earlier', async () => {
  const r = await call('autofillDates', 'week', '2025-11-12', '2025-11-01');   // Wed; week Mon 10 .. Sun 16
  assert.deepEqual(r, { dates: ['2025-11-10', '2025-11-11', '2025-11-12', '2025-11-13', '2025-11-14', '2025-11-15', '2025-11-16'], skippedPast: 0 });
});

test('M23 autofillDates: dates before today are dropped and counted; today itself is included', async () => {
  const w = await call('autofillDates', 'week', '2025-11-12', '2025-11-12');
  assert.deepEqual(w.dates, ['2025-11-12', '2025-11-13', '2025-11-14', '2025-11-15', '2025-11-16']); assert.equal(w.skippedPast, 2);
  const m = await call('autofillDates', 'month', '2025-11-20', '2025-11-10');
  assert.equal(m.dates.length, 21); assert.equal(m.dates[0], '2025-11-10'); assert.equal(m.dates.at(-1), '2025-11-30'); assert.equal(m.skippedPast, 9);
  const allPast = await call('autofillDates', 'month', '2025-11-20', '2026-01-05');
  assert.deepEqual(allPast, { dates: [], skippedPast: 30 });
  const future = await call('autofillDates', 'month', '2025-11-20', '2025-01-01');
  assert.equal(future.dates.length, 30); assert.equal(future.skippedPast, 0);
  const lastDay = await call('autofillDates', 'week', '2025-11-12', '2025-11-16');
  assert.deepEqual(lastDay, { dates: ['2025-11-16'], skippedPast: 6 });
});

test('M24 autofillDates month: whole calendar month incl. leap Feb and year-boundary weeks', async () => {
  const f = await call('autofillDates', 'month', '2028-02-10', '2028-01-01'); assert.equal(f.dates.length, 29); assert.equal(f.dates.at(-1), '2028-02-29');
  const f27 = await call('autofillDates', 'month', '2027-02-10', '2027-01-01'); assert.equal(f27.dates.length, 28);
  // week containing Dec 31 / Jan 1 spans two months and two years
  assert.deepEqual((await call('autofillDates', 'week', '2025-12-31', '2025-01-01')).dates,
    ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.deepEqual((await call('autofillDates', 'week', '2026-01-01', '2025-01-01')).dates[0], '2025-12-29');
  assert.equal((await call('autofillDates', 'week', '2024-12-31', '2024-01-01')).dates[0], '2024-12-30');
  const dst = await call('autofillDates', 'week', '2025-11-02', '2025-01-01');   // US DST end (Sunday); week Mon 10-27 .. Sun 11-02
  assert.equal(dst.dates.length, 7); assert.equal(dst.dates[0], '2025-10-27'); assert.equal(dst.dates[6], '2025-11-02');
});

test('M25 autofillDates: unknown / missing range behaves like week; hostile range never throws', async () => {
  const wk = await call('autofillDates', 'week', '2025-11-12', '2025-11-01');
  for (const r of ['year', '', 'MONTH', undefined, null, 5, {}, '__proto__', 'constructor']) assert.deepEqual(await call('autofillDates', r, '2025-11-12', '2025-11-01'), wk, String(r));
});

test('M26 autofillDates: invalid viewDate or today -> { dates: [], skippedPast: 0 }', async () => {
  for (const [v, t] of [['', '2025-11-01'], ['2025-02-30', '2025-11-01'], [null, '2025-11-01'], ['2025-11-12', ''], ['2025-11-12', null], ['2025-11-12', '2025-02-30'], [undefined, undefined], [5, 6]])
    for (const range of ['week', 'month']) assert.deepEqual(await call('autofillDates', range, v, t), { dates: [], skippedPast: 0 }, `${range} ${v} ${t}`);
});

// ---------- autoplan over a month (autoplan.js unchanged) ----------
const four = () => mk([rec('a', 600), rec('b', 610), rec('c', 620), rec('d', 630)]);
const planOver = async (s, dates, o = {}) => (await A()).proposePlan(s, { dates, slots: ['Lunch'], ...o });

test('M27 autoplan over 31 days (Jan 2025) fills every Lunch, one pick each', async () => {
  const dates = await call('monthDates', '2025-01-10'), p = await planOver(four(), dates);
  assert.equal(dates.length, 31); assert.deepEqual(Object.keys(p.days), dates);
  for (const d of dates) { assert.equal(p.days[d].Lunch.length, 1); assert.deepEqual(Object.keys(p.days[d]), ['Lunch']); }
});

test('M28 autoplan over February 2027 (28 days) and Feb 2028 (29): exactly the month, nothing outside', async () => {
  const d27 = await call('monthDates', '2027-02-01'), p27 = await planOver(four(), d27);
  assert.deepEqual(Object.keys(p27.days), d27); assert.equal(d27.length, 28);
  const d28 = await call('monthDates', '2028-02-01'), p28 = await planOver(four(), d28);
  assert.equal(Object.keys(p28.days).length, 29); assert.ok(Object.keys(p28.days).every(d => d.startsWith('2028-02')));
});

test('M29 autoplan: the repeat window (3 days) holds across the whole month, including every Sunday->Monday week boundary', async () => {
  const dates = await call('monthDates', '2025-01-01'), p = await planOver(four(), dates);   // Sundays: Jan 5, 12, 19, 26
  const id = d => p.days[d].Lunch[0].recipeId;
  for (let i = 0; i < dates.length; i++) for (let j = i + 1; j < dates.length && j - i < 3; j++) assert.notEqual(id(dates[i]), id(dates[j]), `${dates[i]} vs ${dates[j]}`);
  for (const sun of ['2025-01-05', '2025-01-12', '2025-01-19', '2025-01-26']) {
    assert.notEqual(id(sun), id(addDays(sun, 1))); assert.notEqual(id(sun), id(addDays(sun, 2))); assert.notEqual(id(addDays(sun, -1)), id(addDays(sun, 1)));
  }
  assert.ok(!p.notes.some(n => /repeat/i.test(n)));
});

test('M30 autoplan over a month respects planned days and fills only empty slots; apply never overwrites', async () => {
  const s = four(); const dates = await call('monthDates', '2025-01-01');
  addPlanItem(s, '2025-01-15', 'Lunch', recipeItem('keep1', 'a', 1), 1);     // planned lunch: absent from the proposal
  addPlanItem(s, '2025-01-31', 'Dinner', recipeItem('keep2', 'b', 1), 1);    // planned dinner (other slot): still fillable lunch
  const p = (await A()).proposePlan(s, { dates, slots: ['Lunch', 'Dinner'] });
  assert.ok(!p.days['2025-01-15']?.Lunch); assert.ok(p.days['2025-01-15']?.Dinner);
  assert.ok(!p.days['2025-01-31']?.Dinner); assert.ok(p.days['2025-01-31']?.Lunch);
  assert.equal(Object.values(p.days).reduce((n, d) => n + Object.keys(d).length, 0), 31 * 2 - 2);
  const before = JSON.stringify(s.plan['2025-01-15'].slots.Lunch);
  let n = 0;
  const added = (await A()).applyProposal(s, p, 100, () => 'x' + (++n));
  assert.equal(added, 60); assert.equal(JSON.stringify(s.plan['2025-01-15'].slots.Lunch), before);
  assert.equal(getDay(s, '2025-01-31').slots.Dinner.length, 1); assert.equal(getDay(s, '2025-01-31').slots.Dinner[0].id, 'keep2');
  assert.equal((await A()).applyProposal(s, p, 200, () => 'y' + (++n)), 0);   // second apply adds nothing
});

test('M31 autoplan over a month is deterministic for a seed and the month summary reflects an applied plan', async () => {
  const dates = await call('monthDates', '2025-01-01');
  assert.deepEqual(await planOver(four(), dates, { seed: 7 }), await planOver(four(), dates, { seed: 7 }));
  const s = four(), p = await planOver(s, dates); let n = 0;
  (await A()).applyProposal(s, p, 1, () => 'z' + (++n));
  const m = await call('monthSummary', s, '2025-01-01');
  for (const d of dates) { assert.equal(m[d].items, 1); assert.ok(m[d].k >= 300 && m[d].k <= 2500); }
});
