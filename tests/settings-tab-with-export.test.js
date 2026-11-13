// Spec: docs/specs/settings-tab-with-export.md. Test-designer file, written before the implementation.
// Expectations are hand-written from the spec. tabs.js is run against a hand-made fake DOM (weak stand-in for a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const root = new URL('../js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'vendor' ? [] : walk(p)) : [p]; });
const jsFiles = walk(root).filter(f => f.endsWith('.js'));

const settings = (() => { const i = html.indexOf('id="v-settings"'); return html.slice(i, html.indexOf('</section>', i)); })();
const nav = (() => { const i = html.indexOf('<nav class="tabs">'); return html.slice(i, html.indexOf('</nav>', i)); })();
const count = (s, needle) => s.split(needle).length - 1;

// ---------- 1-3: index.html ----------
test('1. nav has exactly five buttons; the fifth is Settings with the gear, no More', () => {
  const btns = [...nav.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(m => m[0]);
  assert.equal(btns.length, 5, 'nav buttons: ' + btns.length);
  assert.deepEqual(btns.map(b => /data-tab="([^"]+)"/.exec(b)?.[1]), ['diary', 'plan', 'recipes', 'shop', 'settings']);
  assert.match(btns[4], /⚙️/); assert.match(btns[4], />\s*Settings\s*<\/button>/);
  assert.doesNotMatch(nav, /More|⋯|data-tab="more"/);
});

test('2. the More hub, the Export page wrapper and every back-to-More button are gone from index.html', () => {
  for (const s of ['v-more', 'moreExport', 'moreSettings', 'data-more', 'back-more', 'id="v-export"']) assert.equal(html.includes(s), false, s + ' still in index.html');
});

test('3. #v-settings order: Units, Daily goals, Appearance, Food databases, Sync, Export group, Backup; export ids once and inside Settings', () => {
  const at = s => { const i = settings.indexOf(s); assert.ok(i > -1, 'missing in #v-settings: ' + s); return i; };
  const order = ['<h2>Units</h2>', '<h2>Daily goals</h2>', 'id="themeToggle"', '<h2>Food databases</h2>', '<h2>Sync between devices</h2>', '<h2>Export your data</h2>',
    'id="xKind"', 'id="xDate"', 'id="xRange"', 'id="xStats"', 'id="xTable"', 'id="xEntries"', 'id="xSummary"', 'id="xJson"', 'id="xShare"', '<h2>Backup</h2>'].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], 'item ' + i + ' out of order');
  for (const id of ['xKind', 'xDate', 'xRange', 'xStats', 'xTable', 'xEntries', 'xSummary', 'xJson', 'xShare'])
    assert.equal(count(html, `id="${id}"`), 1, '#' + id + ' must appear exactly once in index.html');
  // export-one-card: #xTable is no longer its own card; it keeps tscroll (horizontal scrolling) inside the single Export card
  const xt = settings.slice(settings.lastIndexOf('<', settings.indexOf('id="xTable"')), settings.indexOf('>', settings.indexOf('id="xTable"')) + 1);
  assert.match(xt, /\btscroll\b/); assert.doesNotMatch(xt, /class="([^"]*\s)?card(\s[^"]*)?"/);
  assert.equal(count(settings, 'Export your data'), 1);
  assert.ok(settings.lastIndexOf('<div class="card') > settings.indexOf('<h2>Backup</h2>') - 60, 'Backup must be the last card');
});

// ---------- 4-7: tabs.js with a fake DOM ----------
const mkEl = (id, cls = []) => { const classes = new Set(cls); return { id, dataset: {}, style: {}, onclick: null, classList: { toggle(c, on) { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); }, contains: c => classes.has(c) }, on: () => classes.has('on') }; };
let views, navs, datebar, scrolls, calls;
const fresh = () => {
  views = ['diary', 'plan', 'recipes', 'shop', 'settings'].map(n => mkEl('v-' + n, ['view']));
  views[0].classList.toggle('on', true);
  navs = ['diary', 'plan', 'recipes', 'shop', 'settings'].map(n => { const b = mkEl('', []); b.dataset.tab = n; return b; });
  navs[0].classList.toggle('on', true);
  datebar = mkEl('datebar'); scrolls = []; calls = [];
};
globalThis.window = { scrollTo: (...a) => scrolls.push(a) };
globalThis.document = {
  querySelectorAll: s => s === '.view' ? views : s === 'nav.tabs button' ? navs : [],
  querySelector: s => s === '#datebar' ? datebar : (/^#v-/.test(s) ? views.find(v => '#' + v.id === s) ?? null : null),
  getElementById: id => views.find(v => v.id === id) ?? null,
};
fresh();
const tabs = await import('../js/ui/tabs.js');
const onViews = () => views.filter(v => v.on()).map(v => v.id);
const onNavs = () => navs.filter(b => b.on()).map(b => b.dataset.tab);
['diary', 'settings'].forEach(n => tabs.registerTab(n, name => calls.push(name)));

test('4. showTab(settings): only #v-settings on, Settings highlighted, datebar hidden, callback once, scrolled to top', () => {
  fresh(); tabs.showTab('settings');
  assert.deepEqual(onViews(), ['v-settings']); assert.deepEqual(onNavs(), ['settings']);
  assert.equal(datebar.style.display, 'none'); assert.deepEqual(calls, ['settings']); assert.deepEqual(scrolls, [[0, 0]]);
});

test('5. showTab(diary) shows the datebar again and highlights Diary', () => {
  fresh(); tabs.showTab('settings'); tabs.showTab('diary');
  assert.equal(datebar.style.display, ''); assert.deepEqual(onNavs(), ['diary']); assert.deepEqual(onViews(), ['v-diary']);
});

test('6. unknown tab names (more, export, junk, prototype names, undefined) fall back to diary without throwing', () => {
  for (const name of ['more', 'export', 'nope', undefined, null, '', '__proto__', 'constructor', 'toString', '<img src=x>']) {
    fresh(); tabs.showTab('settings'); calls.length = 0;
    assert.doesNotThrow(() => tabs.showTab(name), 'showTab(' + String(name) + ') threw');
    assert.deepEqual(onViews(), ['v-diary'], 'views on after ' + String(name)); assert.deepEqual(onNavs(), ['diary']);
    assert.equal(datebar.style.display, ''); assert.deepEqual(calls, ['diary'], 'only the diary callback may run for ' + String(name));
  }
});

test('7. initTabs works with only the five nav buttons present (no More hub elements) and the Settings button opens settings', () => {
  fresh(); assert.doesNotThrow(() => tabs.initTabs());
  navs[4].onclick(); assert.deepEqual(onViews(), ['v-settings']); assert.deepEqual(onNavs(), ['settings']);
  navs[0].onclick(); assert.deepEqual(onViews(), ['v-diary']);
});

// ---------- 8-11: source text ----------
test('8. no More leftovers in js/', () => {
  const tabsSrc = read('js/ui/tabs.js');
  assert.doesNotMatch(tabsSrc, /NAV_PARENT/);
  for (const f of jsFiles) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /moreExport|moreSettings|data-more|v-more|showTab\(\s*['"](more|export)['"]/, f);
  }
});

test('9. one registerTab(settings) that also calls renderExport; export-view no longer registers a tab', () => {
  const regs = jsFiles.flatMap(f => readFileSync(f, 'utf8').match(/registerTab\(\s*['"]settings['"]/g) || []);
  assert.equal(regs.length, 1);
  assert.equal(jsFiles.some(f => /registerTab\(\s*['"]export['"]/.test(readFileSync(f, 'utf8'))), false, "registerTab('export' must be gone");
  const view = read('js/ui/settings-view.js');
  assert.match(view, /import\s*\{[^}]*\brenderExport\b[^}]*\}\s*from\s*['"]\.\/export-view\.js['"]/);
  const cb = view.slice(view.indexOf("registerTab('settings'")).split('\n')[0];
  assert.match(cb, /renderExport\(\s*\)/); assert.match(cb, /setThemePanel\(\s*false\s*\)/); assert.match(cb, /setKeyEditor\(\s*false\s*\)/);
  const ex = read('js/ui/export-view.js');
  assert.match(ex, /export\s+function\s+renderExport\b/); assert.match(ex, /export\s+function\s+initExport\b/);
  assert.doesNotMatch(ex, /settings-view\.js/);
});

test('10. sw.js CACHE is at least v55; schema version and storage key unchanged (the schema checks already pass before the change)', () => {
  const m = read('sw.js').match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(m && Number(m[1]) >= 55, 'CACHE is ' + (m && m[0]));
  assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 9;/);
  assert.match(read('js/core/constants.js'), /STORAGE_KEY = 'macrodiary\.v1'/);
});

test('11. main.js still wires initExport, initSettings and initTabs', () => {
  const m = read('js/main.js');
  for (const f of ['initExport', 'initSettings', 'initTabs']) { assert.match(m, new RegExp('import[^;]*\\b' + f + '\\b')); assert.match(m, new RegExp('\\b' + f + '\\(\\s*\\)')); }
});
