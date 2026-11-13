// Spec: docs/specs/google-health-import.md (screens, wiring, layers, service worker, docs). Test-designer file, written before the implementation.
// These are WEAK source-text checks by nature (wording, ids, wiring): they cannot show that the screens work. The behaviour is covered by the
// headless checklist C1..C11 in the spec. Numbering follows the spec's behaviour list (44-48).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const count = (s, needle) => s.split(needle).length - 1;
const tag = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
const settings = html.slice(html.indexOf('id="v-settings"'), html.indexOf('</section>', html.indexOf('id="v-settings"')));
const NEW = ['js/domain/health-import.js', 'js/domain/activity.js', 'js/services/zip.js', 'js/services/google-health.js', 'js/ui/health-import-view.js'];

// ---------------------------------------------------------------- 44: index.html
test('44. index.html: the Import from Google Health card sits between Food databases and Sync, with the agreed ids, defaults and wording', () => {
  const at = s => { const i = settings.indexOf(s); assert.ok(i > -1, 'missing in #v-settings: ' + s); return i; };
  const order = [at('<h2>Food databases</h2>'), at('<h2>Import from Google Health</h2>'), at('<h2>Sync between devices</h2>'), at('<h2>Export your data</h2>'), at('<h2>Backup</h2>')];
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], 'card ' + i + ' out of order');
  for (const id of ['ghFile', 'ghScope', 'ghStart', 'ghCancel', 'ghStatus', 'activityLine']) assert.equal(count(html, `id="${id}"`), 1, '#' + id + ' must appear exactly once');
  const card = settings.slice(order[1], order[2]);
  assert.match(card, /Nothing is uploaded/); assert.match(card, /Takeout/i);
  const file = tag(card, 'ghFile'); assert.match(file, /^<input\b/); assert.match(file, /type="file"/); assert.match(file, /accept="[^"]*\.zip/); assert.doesNotMatch(file, /\bhidden\b/, 'the file input stays visible');
  const sel = card.slice(card.indexOf('<select'), card.indexOf('</select>'));
  assert.match(tag(card, 'ghScope'), /^<select\b/);
  assert.match(sel, /<option value="year"[^>]*\bselected\b[^>]*>\s*Last year\s*<\/option>/); assert.match(sel, /<option value="all"[^>]*>\s*All years\s*<\/option>/);
  assert.ok(sel.indexOf('value="year"') < sel.indexOf('value="all"')); assert.doesNotMatch(sel.slice(sel.indexOf('value="all"')), /\bselected\b/);
  assert.match(card, /<label[^>]*for="ghScope"/);
  const start = tag(card, 'ghStart'); assert.match(start, /^<button\b/); assert.match(start, /\bdisabled\b/, 'disabled until a file is chosen');
  assert.match(card, /id="ghStart"[^>]*>\s*Start import\s*<\/button>/);
  const cancel = tag(card, 'ghCancel'); assert.match(cancel, /^<button\b/); assert.match(cancel, /\bhidden\b/); assert.match(card, /id="ghCancel"[^>]*>\s*Cancel\s*<\/button>/);
  assert.match(tag(card, 'ghStatus'), /aria-live="polite"/);
});

test('44b. index.html: #activityLine is a hidden muted line in the Diary between #summary and #meals; the existing Settings cards and ids are still there once', () => {
  const diary = html.slice(html.indexOf('id="v-diary"'), html.indexOf('</section>', html.indexOf('id="v-diary"')));
  const a = diary.indexOf('id="summary"'), b = diary.indexOf('id="activityLine"'), c = diary.indexOf('id="meals"');
  assert.ok(a > -1 && b > a && c > b, 'order summary, activityLine, meals');
  const t = tag(diary, 'activityLine'); assert.match(t, /\bhidden\b/); assert.match(t, /class="[^"]*\bmuted\b/);
  assert.match(tag(diary, 'summary'), /role="button"/, '#summary is still the keyboard button for the details');
  for (const id of ['wUnit', 'gK', 'srcUSDA', 'keyEdit', 'syncCard', 'syncBox', 'xKind', 'bkExport', 'bkImport', 'bkFile', 'wipe', 'themeToggle']) assert.equal(count(html, `id="${id}"`), 1, '#' + id);
  assert.ok(settings.lastIndexOf('<div class="card') > settings.indexOf('<h2>Backup</h2>') - 60, 'Backup is still the last card');
});

// ---------------------------------------------------------------- 45: wiring
test('45. diary.js shows the line (textContent, "From Google Health: ") and lists workouts in the details with esc()', () => {
  const src = read('js/ui/diary.js');
  assert.match(src, /import\s*\{[^}]*\bactivityLine\b[^}]*\}\s*from\s*['"]\.\.\/domain\/activity\.js['"]/); assert.match(src, /\bactivityForDay\b/);
  assert.match(src, /#activityLine/); assert.match(src, /From Google Health: /);
  assert.match(src, /activityLine['"]\)[\s\S]{0,400}textContent|textContent[\s\S]{0,200}From Google Health/, 'the line is set with textContent');
  assert.match(src, /Workouts/); assert.match(src, /Workouts[\s\S]{0,900}esc\(/, 'workout names go through esc()');
  assert.match(src, /\bmin\b/); assert.match(src, /\bkcal\b/);
  assert.match(src, /id="summary"|#summary/, 'the summary code is still there');
});

test('45b. the Settings view module: exports initHealthImport, uses the services and the domain, writes text safely, never keeps the file, saves and refreshes the Diary', () => {
  assert.ok(existsSync(new URL('../js/ui/health-import-view.js', import.meta.url)), 'js/ui/health-import-view.js missing');
  const v = read('js/ui/health-import-view.js');
  assert.match(v, /export\s+(async\s+)?function\s+initHealthImport\b|export\s+const\s+initHealthImport\b/);
  assert.match(v, /from\s*['"]\.\.\/services\/google-health\.js['"]/); assert.match(v, /\breadTakeout\b/); assert.match(v, /\bapplyActivityImport\b/); assert.match(v, /\bimportSummaryText\b/);
  assert.match(v, /ghStatus[^;\n]*textContent|textContent[^;\n]*ghStatus|status\.textContent/, 'status is written with textContent');
  assert.doesNotMatch(v, /innerHTML/, 'no innerHTML in this module: its text comes from a file');
  assert.match(v, /\bsave\(\s*\)/); assert.match(v, /emit\(\s*['"]diary:changed['"]\s*\)/); assert.match(v, /Date\.now\(\)/);
  assert.match(v, /getTimezoneOffset/, 'the device timezone'); assert.match(v, /AbortController/); assert.match(v, /Reading /);
  assert.match(v, /Could not read this file\./); assert.match(v, /\.value\s*=\s*['"]{2}/, 'the file input is cleared after a run');
  assert.match(v, /#ghFile/); assert.match(v, /#ghStart/); assert.match(v, /#ghCancel/); assert.match(v, /#ghScope/);
  assert.match(v, /\.getFullYear\(\)|fmt\(new Date/, 'today is the device-local date');
  const main = read('js/main.js');
  assert.match(main, /import[^;]*\binitHealthImport\b[^;]*health-import-view\.js/); assert.match(main, /\binitHealthImport\(\s*\)/);
});

// ---------------------------------------------------------------- 46: layers, privacy
test('46. layer rules and privacy: domain files are pure, the new modules never use the network or storage, DecompressionStream lives only in services/zip.js', () => {
  for (const f of NEW) assert.ok(existsSync(new URL('../' + f, import.meta.url)), 'missing ' + f);
  const imports = src => [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  for (const f of ['js/domain/health-import.js', 'js/domain/activity.js']) {
    const src = read(f);
    for (const imp of imports(src)) assert.match(imp, /^(\.\/[\w-]+\.js|\.\.\/core\/(constants|format|dates|schema)\.js)$/, f + ' may not import ' + imp);
    assert.doesNotMatch(src, /\b(document|window|localStorage|sessionStorage|navigator|indexedDB)\b|\bfetch\s*\(|DecompressionStream|new Date\(\)|Date\.now/, f + ' must stay pure (the clock and timezone are passed in)');
  }
  for (const f of ['js/services/zip.js', 'js/services/google-health.js']) {
    const src = read(f);
    for (const imp of imports(src)) assert.doesNotMatch(imp, /\/ui\//, f + ' may not import ui/'); assert.doesNotMatch(src, /\bdocument\b|localStorage/, f);
  }
  assert.match(read('js/services/zip.js'), /DecompressionStream/); assert.match(read('js/services/zip.js'), /deflate-raw/);
  assert.doesNotMatch(read('js/services/google-health.js'), /DecompressionStream/, 'only zip.js inflates');
  for (const f of NEW) assert.doesNotMatch(read(f), /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|\bcaches\b|navigator\.share/, f + ': nothing is uploaded or stored by the reader');
  const ui = read('js/ui/health-import-view.js');
  assert.doesNotMatch(ui, /state\.\w+\s*=\s*[^;]*\b(file|blob|zip)\b/i, 'the picked file is never put into the state');
  const sch = read('js/core/schema.js');
  assert.match(sch, /export (function|const) sanitizeActivityDay\b/); assert.match(sch, /activity/); assert.match(sch, /SCHEMA_VERSION = 10;/);
  const rec = read('js/domain/sync-records.js'); assert.match(rec, /activity:/); assert.match(read('js/domain/merge.js'), /activity/);
});

// ---------------------------------------------------------------- 47: service worker
test('47. sw.js precaches every new file and CACHE is above v58 (no exact number pinned)', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of NEW) assert.ok(shell.includes(f), f + ' must be in SHELL');
  const m = sw.match(/const CACHE = 'macro-diary-v(\d+)'/); assert.ok(m && Number(m[1]) > 58, 'CACHE is ' + (m && m[0]));
});

// ---------------------------------------------------------------- 48: docs
test('48. the docs were updated: D54, KNOWN-ISSUES 67, SYNC.md, ARCHITECTURE.md', () => {
  const dec = read('docs/DECISIONS.md'); const i = dec.indexOf('## D54'); assert.ok(i > -1, 'D54 missing');
  const d54 = dec.slice(i, dec.indexOf('\n## D', i + 5) > 0 ? dec.indexOf('\n## D', i + 5) : undefined);
  for (const w of [/DecompressionStream/, /larger|largest/i, /timezone/i, /updatedAt/]) assert.match(d54, w);
  assert.match(read('docs/KNOWN-ISSUES.md'), /^\|\s*67\s*\|[^\n]*Google Health/m);
  const sync = read('docs/SYNC.md'); assert.match(sync, /activity:/); assert.match(sync, /old(er)? (app|device)|older version/i);
  const arch = read('docs/ARCHITECTURE.md'); for (const f of ['health-import.js', 'activity.js', 'zip.js', 'google-health.js', 'health-import-view.js']) assert.match(arch, new RegExp(f.replace('.', '\\.')), f);
});
