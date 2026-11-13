// Reads a Google Takeout zip of Google Health data and returns the per-day activity it holds (steps, sleep, workouts). Browser-side only: the Blob is
// the file the owner picked, nothing is uploaded or stored. services/zip.js reads the zip, domain/health-import.js knows the CSV rules.
// Files are read ONE AT A TIME and reduced at once: a steps file (minute rows, tens of MB) is cut into pieces of whole lines, turned into daily totals per
// source and dropped; sleep and exercise rows (small) are kept and processed together at the end. D54.
import { listEntries, readEntryText, ZipError } from './zip.js';
import { parseCsvTable, stepTotalsBySource, mergeStepTotals, chooseDaily, sleepByDay, workoutsByDay, cutoffDay, combineActivity, countActivity } from '../domain/health-import.js';

/** The device's current timezone as the domain wants it: minutes to add to a UTC instant to get local time. */
export const deviceTz = ms => -new Date(ms).getTimezoneOffset();

const STEPS = /(?:^|\/)Google Health\/Physical Activity_GoogleData\/Steps\/steps_(\d{4})-(\d{2})-\d{2}\.csv$/;
const SLEEPS = /(?:^|\/)Google Health\/Health Fitness Data_GoogleData\/UserSleeps_[^/]*\.csv$/;
const EXERCISES = /(?:^|\/)Google Health\/Health Fitness Data_GoogleData\/UserExercises_[^/]*\.csv$/;
const CHUNK = 4 * 1024 * 1024;
const breathe = () => new Promise(resolve => setTimeout(resolve, 0));    // lets the page paint and react between pieces

/** The first day AFTER the month of a steps file ('2025-10' -> '2025-11-01'). */
const dayAfterMonth = (y, m) => (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`);

/** Steps text as pieces that each start at a line start and are parsed with the header line in front; text with quotes is parsed whole (a quoted line break could be cut). */
function* stepPieces(text) {
  if (text.length <= CHUNK || text.includes('"')) { yield text; return; }
  const nl = text.indexOf('\n'), header = nl < 0 ? text : text.slice(0, nl);
  let pos = 0;
  while (pos < text.length) {
    let cut = text.indexOf('\n', Math.min(pos + CHUNK, text.length));
    cut = cut < 0 ? text.length : cut + 1;
    yield pos === 0 ? text.slice(0, cut) : header + '\n' + text.slice(pos, cut);
    pos = cut;
  }
}

/**
 * readTakeout(blob, { scope: 'year' | 'all', today: 'YYYY-MM-DD' (local), tz, onProgress({ done, total }), signal })
 *   -> { days, counts, left, files }   (days and left from combineActivity, counts from countActivity, files = how many entries were read)
 * Rejects with ZipError: the zip.js codes pass through, `no-data` when the zip holds no steps, sleep or workout file at all.
 */
export async function readTakeout(blob, { scope = 'year', today, tz = deviceTz, onProgress, signal } = {}) {
  const since = cutoffDay(today, scope);
  const wanted = [];
  let anyHealthFile = false;
  for (const e of await listEntries(blob, { signal })) {
    if (e.name.startsWith('__MACOSX/')) continue;
    const m = STEPS.exec(e.name);
    if (m) {
      anyHealthFile = true;
      if (since !== null && dayAfterMonth(+m[1], +m[2]) < since) continue;   // a month that cannot reach the cutoff is not even read
      wanted.push({ e, kind: 'steps' });
    } else if (SLEEPS.test(e.name)) { anyHealthFile = true; wanted.push({ e, kind: 'sleep' }); }
    else if (EXERCISES.test(e.name)) { anyHealthFile = true; wanted.push({ e, kind: 'exercise' }); }
  }
  if (!anyHealthFile) throw new ZipError('no-data', 'No steps, sleep or workout files were found in this zip. Check that it is the Google Takeout export of Google Health.');
  const total = wanted.length;
  if (onProgress) onProgress({ done: 0, total });
  let totals = {}, sleepRows = [], exerciseRows = [], done = 0;
  for (const { e, kind } of wanted) {
    if (signal && signal.aborted) throw new ZipError('aborted', 'Cancelled.');
    const text = await readEntryText(blob, e, { signal });
    if (kind === 'steps') {
      for (const piece of stepPieces(text)) { totals = mergeStepTotals(totals, stepTotalsBySource(parseCsvTable(piece).rows, tz)); await breathe(); }
    } else {
      const rows = parseCsvTable(text).rows;
      if (kind === 'sleep') sleepRows = sleepRows.concat(rows); else exerciseRows = exerciseRows.concat(rows);
    }
    done++;
    if (onProgress) onProgress({ done, total });
    await breathe();
  }
  const { days, left } = combineActivity({ steps: chooseDaily(totals), sleep: sleepByDay(sleepRows, tz), workouts: workoutsByDay(exerciseRows, tz) }, since);
  return { days, counts: countActivity(days), left, files: done };
}
