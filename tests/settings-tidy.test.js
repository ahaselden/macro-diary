// Settings tidy-up (docs/specs/settings-tidy.md). Test-designer file: written before the implementation.
// Expected values are hand-written from the spec. theme.js is imported in Node with a hand-made fake DOM (weak stand-in for a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

// ---------- fake browser, installed before theme.js is imported ----------
const written = {};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => written[k] ?? null, setItem: (k, v) => { written[k] = String(v); } } });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const el = () => {
  const attrs = {}, listeners = [];
  return {
    attrs, hidden: false, textContent: '', innerHTML: '', onclick: null, dataset: {}, focused: false,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    addEventListener(t, f) { if (t === 'click') listeners.push(f); },
    classList: { toggle() {} }, focus() { this.focused = true; },
    click() { const ev = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }; this.onclick?.(ev); listeners.forEach(f => f(ev)); },
  };
};
let els;
const docEl = { dataset: {} };
const fresh = () => {
  els = { '#themes': el(), '#themeToggle': el(), '#themePanel': el(), '#themeName': el(), 'meta[name=theme-color]': { content: '' } };
  els['#themePanel'].hidden = true; els['#themeToggle'].setAttribute('aria-expanded', 'false');
  docEl.dataset = {};
};
globalThis.document = {
  documentElement: docEl,
  querySelector: s => els[s] ?? null,
  querySelectorAll: s => (s === '#themes [data-t]' ? [{ dataset: { t: 'auto' }, classList: { toggle() {} } }] : []),
};
fresh();

const theme = await import('../js/ui/theme.js');
const { state } = await import('../js/core/store.js');
const { emit } = await import('../js/core/bus.js');

const pick = key => els['#themes'].onclick({ target: { closest: () => ({ dataset: { t: key } }) } });
const storedTheme = () => JSON.parse(written['macrodiary.v1'] ?? '{}').theme;

// ---------- 1, 2: themeLabel ----------
test('1. themeLabel gives the display name for every THEMES key', () => {
  assert.equal(typeof theme.themeLabel, 'function', 'themeLabel export missing');
  const expected = { auto: 'Auto', light: 'Light', dark: 'Dark', black: 'Black (OLED)', midnight: 'Midnight', forest: 'Forest', nord: 'Nord',
    dracula: 'Dracula', ember: 'Ember', ocean: 'Ocean', rose: 'Rose', solarized: 'Solarized', paper: 'Paper', contrast: 'High contrast' };
  assert.equal(theme.THEMES.length, 14);
  for (const [k, n] of Object.entries(expected)) assert.equal(theme.themeLabel(k), n, k);
});

test('2. themeLabel falls back: non-string gives Auto, unknown string gives Light, never throws', () => {
  assert.equal(typeof theme.themeLabel, 'function', 'themeLabel export missing');
  for (const v of [undefined, null, 7, {}, [], true, NaN]) assert.equal(theme.themeLabel(v), 'Auto', String(v));
  for (const v of ['', 'nope', 'AUTO', ' dark', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '<img src=x onerror=1>', 'x'.repeat(1e6)])
    assert.equal(theme.themeLabel(v), 'Light', JSON.stringify(v.slice(0, 30)));
});

// ---------- 3, 4, 5: index.html ----------
const html = read('../index.html');
const settings = html.slice(html.indexOf('id="v-settings"'), html.indexOf('</section>', html.indexOf('id="v-settings"')));
const tag = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };

test('3. index.html: Appearance is one real toggle button with aria-expanded/aria-controls and a #themeName span', () => {
  const t = tag(settings, 'themeToggle');
  assert.match(t, /^<button\b/); assert.match(t, /type="button"/); assert.match(t, /aria-expanded="false"/); assert.match(t, /aria-controls="themePanel"/);
  const after = settings.slice(settings.indexOf(t) + t.length);
  const body = after.slice(0, after.indexOf('</button>'));
  assert.match(body, /Appearance/); assert.match(body, /<span[^>]*id="themeName"/);
  assert.doesNotMatch(settings, /<h2>\s*Appearance\s*<\/h2>/, 'old plain heading must be gone');
});

test('4. index.html: #themePanel is hidden and wraps the intro text and #themes', () => {
  const p = tag(settings, 'themePanel');
  assert.match(p, /\bhidden\b/);
  const start = settings.indexOf(p) + p.length;
  const rest = settings.slice(start);
  const intro = rest.indexOf('Choose a theme. Auto switches between Light and Dark with your device.');
  const grid = rest.indexOf('id="themes"');
  const unitsCard = settings.indexOf('<h2>Units</h2>');
  assert.ok(intro > -1 && grid > -1, 'intro and #themes must follow #themePanel');
  assert.ok(settings.indexOf(p) > unitsCard, 'panel comes after Units');
  const foodDb = rest.indexOf('<h2>Food databases</h2>');
  assert.ok(intro < foodDb && grid < foodDb, 'both sit before the next card');
  assert.ok(settings.indexOf('id="themeToggle"') < settings.indexOf(p), 'toggle before panel');
  assert.doesNotMatch(settings.slice(0, settings.indexOf(p)), /id="themes"/, '#themes must not sit before the panel');
});

test('5. index.html: card order Units, Daily goals, Appearance, Food databases, Sync, Export your data, Backup; every id still there once', () => {
  const at = s => { const i = settings.indexOf(s); assert.ok(i > -1, 'missing ' + s); return i; };
  const order = [at('<h2>Units</h2>'), at('<h2>Daily goals</h2>'), at('id="themeToggle"'), at('<h2>Food databases</h2>'), at('<h2>Sync between devices</h2>'), at('<h2>Export your data</h2>'), at('<h2>Backup</h2>')];
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], 'card ' + i + ' out of order');
  for (const id of ['wUnit', 'gK', 'gP', 'gC', 'gF', 'srcUSDA', 'srcOFF', 'keyLine', 'keyEdit', 'keyEditor', 'apiKey', 'syncApiKey', 'keySave', 'keyCancel', 'syncCard', 'syncBox', 'bkExport', 'bkImport', 'bkFile', 'wipe', 'themes'])
    assert.equal(html.split('id="' + id + '"').length - 1, 1, '#' + id + ' must appear exactly once');
  assert.match(settings, /Show weights in/); assert.match(settings, /<label>Calories<\/label>/);
});

// ---------- 6-9: behaviour with the fake DOM ----------
test('6. setThemePanel flips hidden and aria-expanded together and touches no state or storage', () => {
  fresh(); assert.equal(typeof theme.setThemePanel, 'function', 'setThemePanel export missing');
  const before = JSON.stringify(state), wrote = JSON.stringify(written);
  theme.setThemePanel(true);
  assert.equal(els['#themePanel'].hidden, false); assert.equal(els['#themeToggle'].getAttribute('aria-expanded'), 'true');
  theme.setThemePanel(false);
  assert.equal(els['#themePanel'].hidden, true); assert.equal(els['#themeToggle'].getAttribute('aria-expanded'), 'false');
  assert.equal(JSON.stringify(state), before); assert.equal(JSON.stringify(written), wrote);
});

test('7. initTheme starts collapsed; the toggle opens and closes; toggling never changes the theme or storage', () => {
  fresh(); state.theme = 'auto'; delete written['macrodiary.v1'];
  theme.initTheme();
  const t = els['#themeToggle'], p = els['#themePanel'];
  assert.equal(p.hidden, true); assert.equal(t.getAttribute('aria-expanded'), 'false');
  t.click(); assert.equal(p.hidden, false); assert.equal(t.getAttribute('aria-expanded'), 'true');
  t.click(); assert.equal(p.hidden, true); assert.equal(t.getAttribute('aria-expanded'), 'false');
  for (let i = 0; i < 5; i++) t.click();
  assert.equal(p.hidden, false, 'odd number of clicks leaves it open'); assert.equal(t.getAttribute('aria-expanded'), 'true');
  assert.equal(state.theme, 'auto'); assert.equal(written['macrodiary.v1'], undefined, 'toggling must not save');
});

test('8. choosing a theme applies, persists, updates the name and keeps the panel open', () => {
  fresh(); state.theme = 'auto'; delete written['macrodiary.v1'];
  theme.initTheme(); theme.setThemePanel(true);
  pick('forest');
  assert.equal(state.theme, 'forest'); assert.equal(storedTheme(), 'forest');
  assert.equal(docEl.dataset.theme, 'forest'); assert.equal(els['#themeName'].textContent, 'Forest');
  assert.equal(els['#themePanel'].hidden, false); assert.equal(els['#themeToggle'].getAttribute('aria-expanded'), 'true');
  pick('black'); assert.equal(els['#themeName'].textContent, 'Black (OLED)'); assert.equal(storedTheme(), 'black'); assert.equal(docEl.dataset.theme, 'black');
});

test('9. applyTheme and settings:changed keep #themeName in step, with safe fallbacks', () => {
  fresh(); theme.initTheme();
  state.theme = 'dracula'; emit('settings:changed'); assert.equal(els['#themeName'].textContent, 'Dracula');
  state.theme = '<img src=x onerror=1>'; theme.applyTheme(); assert.equal(els['#themeName'].textContent, 'Light'); assert.equal(docEl.dataset.theme, 'light');
  state.theme = '__proto__'; theme.applyTheme(); assert.equal(els['#themeName'].textContent, 'Light');
  state.theme = 7; theme.applyTheme(); assert.equal(els['#themeName'].textContent, 'Auto');
  state.theme = 'auto'; theme.applyTheme(); assert.equal(els['#themeName'].textContent, 'Auto');
  state.theme = 'nord'; els['#themePanel'].hidden = false; emit('settings:changed');
  assert.equal(els['#themePanel'].hidden, false, 'a refresh must not collapse an open panel');
});

// ---------- 10, 11, 12, 13: source text ----------
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'vendor' ? [] : walk(p)) : [p]; });

test('10. Settings onShow collapses Appearance, through the single registerTab(\'settings\')', () => {
  const regs = walk(join(root, 'js')).filter(f => f.endsWith('.js')).flatMap(f => (readFileSync(f, 'utf8').match(/registerTab\(\s*['"]settings['"]/g) || []).map(() => f));
  assert.equal(regs.length, 1, 'registerTab(\'settings\') appears ' + regs.length + ' times; a second registration replaces the first');
  const view = read('../js/ui/settings-view.js');
  assert.match(view, /import\s*\{[^}]*\bsetThemePanel\b[^}]*\}\s*from\s*['"]\.\/theme\.js['"]/);
  const line = view.slice(view.indexOf("registerTab('settings'"));
  assert.match(line.slice(0, line.indexOf('\n  on(') > 0 ? line.indexOf('\n  on(') : 400), /setThemePanel\(\s*false\s*\)/);
});

test('11. theme.js writes the name with textContent, never innerHTML, and exports the new functions', () => {
  const src = read('../js/ui/theme.js');
  assert.match(src, /#themeName[^;\n]*\.textContent|themeName[^;\n]*textContent/);
  assert.doesNotMatch(src, /themeName[^;\n]*innerHTML/);
  assert.match(src, /export (function|const) themeLabel/); assert.match(src, /export (function|const) setThemePanel/);
  assert.doesNotMatch(settings, /role="button"[^>]*id="themeToggle"|id="themeToggle"[^>]*role="button"/);
});

test('12. sw.js CACHE is bumped past v52', () => {
  const m = read('../sw.js').match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(m && Number(m[1]) > 52, 'CACHE is ' + (m && m[0]));
});

test('13. no saved-shape change: schema version, storage key and no open flag in state', () => {
  assert.match(read('../js/core/schema.js'), /export const SCHEMA_VERSION = 10;/);
  assert.match(read('../js/core/constants.js'), /STORAGE_KEY = 'macrodiary\.v1'/);
  assert.doesNotMatch(read('../js/ui/theme.js'), /state\.(themeOpen|appearance\w*|themePanel\w*)\s*=/);
  assert.equal(Object.keys(state).some(k => /open|panel|expanded/i.test(k)), false);
});
