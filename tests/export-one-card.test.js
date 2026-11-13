// Spec: docs/specs/export-one-card.md. Test-designer file, written before the implementation.
// Static checks on index.html, css/components.css, js/ui/export-view.js and sw.js (no browser here; the visual part is the browser checklist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html'), css = read('css/components.css'), view = read('js/ui/export-view.js'), sw = read('sw.js');
const settings = (() => { const i = html.indexOf('id="v-settings"'); return html.slice(i, html.indexOf('</section>', i)); })();
const count = (s, n) => s.split(n).length - 1;
const hasCardClass = tag => /class="([^"]*\s)?card(\s[^"]*)?"/.test(tag);

// end index (exclusive) of the <div> that opens at `start`, by balanced div counting
const divEnd = (s, start) => {
  let depth = 0; const re = /<(\/?)div\b[^>]*>/g; re.lastIndex = start;
  for (let m; (m = re.exec(s));) { depth += m[1] ? -1 : 1; if (depth === 0) return m.index + m[0].length; }
  throw new Error('unbalanced div');
};
const openAt = (s, i) => s.lastIndexOf('<div', i);

const syncStart = openAt(settings, settings.indexOf('id="syncCard"') + 1);
const syncEnd = divEnd(settings, syncStart);
const backupStart = openAt(settings, settings.indexOf('<h2>Backup</h2>'));
const between = settings.slice(syncEnd, backupStart);
const exportStart = openAt(settings, settings.indexOf('<h2>Export your data</h2>'));
const exportCard = settings.slice(exportStart, divEnd(settings, exportStart));
const tagAt = (s, id) => { const i = s.indexOf(`id="${id}"`); return s.slice(s.lastIndexOf('<', i), s.indexOf('>', i) + 1); };

test('1. exactly one card between the Sync card and the Backup card, and nothing else sits there', () => {
  assert.equal(count(between, '<div'), count(exportCard, '<div'), 'extra elements between Sync and Backup');
  assert.equal(between.trim(), exportCard.trim(), 'the only thing between Sync and Backup must be the Export card');
  assert.ok(hasCardClass(exportCard.slice(0, exportCard.indexOf('>') + 1)), 'Export wrapper must be class card');
  const cards = [...between.matchAll(/<div\b[^>]*>/g)].filter(m => hasCardClass(m[0]));
  assert.equal(cards.length, 1, 'card elements between Sync and Backup: ' + cards.length);
});

test('2. the one Export card contains h2, Period/date row, #xRange, #xStats, #xTable, then all four buttons, in that order, each id once', () => {
  const order = ['<h2>Export your data</h2>', 'id="xKind"', 'id="xDate"', 'id="xRange"', 'id="xStats"', 'id="xTable"', 'id="xEntries"', 'id="xSummary"', 'id="xJson"', 'id="xShare"'];
  let prev = -1;
  for (const s of order) { const i = exportCard.indexOf(s); assert.ok(i > -1, 'not inside the Export card: ' + s); assert.ok(i > prev, 'out of order: ' + s); prev = i; }
  for (const id of ['xKind', 'xDate', 'xRange', 'xStats', 'xTable', 'xEntries', 'xSummary', 'xJson', 'xShare'])
    assert.equal(count(html, `id="${id}"`), 1, '#' + id + ' must appear once');
  assert.equal(count(exportCard, '<h2'), 1, 'one heading only');
  assert.equal(count(settings, 'Export your data'), 1);
});

test('3. #xStats and #xTable are plain blocks: neither has class card; #xTable keeps tscroll', () => {
  assert.equal(hasCardClass(tagAt(html, 'xStats')), false, '#xStats still a card: ' + tagAt(html, 'xStats'));
  assert.equal(hasCardClass(tagAt(html, 'xTable')), false, '#xTable still a card: ' + tagAt(html, 'xTable'));
  assert.match(tagAt(html, 'xTable'), /class="([^"]*\s)?tscroll(\s[^"]*)?"/);
});

test('4. #xStats, #xTable and the buttons group each carry class xsec (the sub-block spacing hook)', () => {
  const cls = t => (/class="([^"]*)"/.exec(t) || [, ''])[1].split(/\s+/);
  assert.ok(cls(tagAt(html, 'xStats')).includes('xsec'), '#xStats needs xsec');
  assert.ok(cls(tagAt(html, 'xTable')).includes('xsec'), '#xTable needs xsec');
  const groups = [...exportCard.matchAll(/<div\b[^>]*class="[^"]*\bxsec\b[^"]*"[^>]*>/g)].map(m => exportCard.slice(m.index, divEnd(exportCard, m.index)));
  const group = groups.find(g => g.includes('id="xEntries"'));
  assert.ok(group, 'an xsec wrapper containing the buttons is needed');
  for (const id of ['xEntries', 'xSummary', 'xJson', 'xShare']) assert.ok(group.includes(`id="${id}"`), '#' + id + ' must be inside the xsec buttons group');
  assert.equal(group.includes('id="xTable"') || group.includes('id="xStats"'), false, 'buttons group must be separate from stats/table');
});

test('5. css/components.css .xsec: top margin and a thin top divider using var(--line); no background, radius, padding box or other borders', () => {
  const m = /\.xsec\s*\{([^}]*)\}/.exec(css); assert.ok(m, '.xsec rule missing in css/components.css');
  const body = m[1].replace(/\s+/g, '');
  assert.match(body, /margin-top:\d+(\.\d+)?(px|rem|em)/, 'needs margin-top');
  assert.match(body, /border-top:1px(solid)?var\(--line\)|border-top:1pxsolidvar\(--line\)/, 'needs border-top:1px solid var(--line)');
  assert.doesNotMatch(body, /background|border-radius|box-shadow|(^|;)border:|border-(left|right|bottom):/, 'no per-block box look');
});

test('6. export-view.js still writes the same stats/table markup and does not add card classes', () => {
  assert.match(view, /\$\('#xStats'\)\.innerHTML\s*=\s*`<div class="stats">/);
  for (const t of ['Days logged', 'Total calories', 'Avg calories / day', 'Avg P / C / F', 'Month (avg/day)', 'Nothing logged in this period.']) assert.ok(view.includes(t), t);
  assert.doesNotMatch(view, /class="card|classList[^;]*card/, 'export-view.js must not add the card class');
});

test('7. other cards in Settings are untouched: Backup is still its own card after Export; order Units..Sync, Export, Backup', () => {
  const at = s => { const i = settings.indexOf(s); assert.ok(i > -1, s); return i; };
  const o = [at('<h2>Units</h2>'), at('<h2>Daily goals</h2>'), at('id="themeToggle"'), at('<h2>Food databases</h2>'), at('<h2>Sync between devices</h2>'), at('<h2>Export your data</h2>'), at('<h2>Backup</h2>')];
  for (let i = 1; i < o.length; i++) assert.ok(o[i - 1] < o[i]);
  assert.ok(hasCardClass(settings.slice(backupStart, settings.indexOf('>', backupStart) + 1)));
});

test('8. sw.js CACHE bumped to macro-diary-v57 or later (main has v56)', () => {
  const m = /const CACHE = 'macro-diary-v(\d+)'/.exec(sw); assert.ok(m);
  assert.ok(Number(m[1]) >= 57, 'CACHE is v' + m[1]);
});
