// docs/specs/compact-ingredients.md. S1..S10: behavioural tests of the pure helper ingredientStatus (js/domain/recipes.js), hand-computed.
// U1..U12: WEAK static checks that read source text of js/ui/recipe-editor.js and css/components.css and sw.js. They prove markup, CSS rules
// and calls exist; they do NOT prove the list looks compact, that the icon is legible, that tapping works or that anything is escaped at
// runtime. The visual result is covered only by the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as recipes from '../js/domain/recipes.js';
import { parseIngredient } from '../js/domain/ingredient-parse.js';

const status = (...a) => {
  assert.equal(typeof recipes.ingredientStatus, 'function', 'js/domain/recipes.js must export ingredientStatus');
  return recipes.ingredientStatus(...a);
};
const KEYS = ['foodName', 'grams', 'kcal', 'linked', 'name', 'needsGrams', 'prep', 'qty'];
const flour = { id: 'i_1', raw: '200 g flour', name: 'flour', qty: 200, unit: 'g', prep: '', food: { name: 'Test flour', per100: { k: 380, p: 10, c: 76, f: 1 } }, grams: 200 };

// ---------- behavioural: ingredientStatus ----------

test('S1 linked with grams: 200 g at 380 kcal/100 g = 760 kcal, grams 200, not needing grams', () => {
  const s = status(flour);
  assert.deepEqual(s, { qty: '200 g', name: 'flour', prep: '', linked: true, foodName: 'Test flour', kcal: 760, grams: 200, needsGrams: false });
});

test('S2 qty text is formatQty then unit, trimmed: 1.5 cup -> "1 1/2 cup", 0.75 -> "3/4", no unit -> just the number', () => {
  assert.equal(status({ name: 'oats', qty: 1.5, unit: 'cup', prep: 'rolled' }).qty, '1 1/2 cup');
  assert.equal(status({ name: 'oats', qty: 1.5, unit: 'cup', prep: 'rolled' }).prep, 'rolled');
  assert.equal(status({ name: 'milk', qty: 0.75, unit: 'cup' }).qty, '3/4 cup');
  assert.equal(status({ name: 'egg', qty: 2, unit: '' }).qty, '2');
  assert.equal(status({ name: 'egg', qty: 2 }).qty, '2');
});

test('S3 no quantity: qty null or "" gives "" (no stray space); a unit alone is kept trimmed', () => {
  assert.equal(status({ name: 'salt', qty: null, unit: '' }).qty, '');
  assert.equal(status({ name: 'salt', qty: '', unit: '' }).qty, '');
  assert.equal(status({ name: 'salt' }).qty, '');
  assert.equal(status({ name: 'salt', qty: null, unit: 'pinch' }).qty, 'pinch');
});

test('S4 linked but grams unknown (null, 0, negative, NaN, "", text): grams null, kcal null, needsGrams true', () => {
  for (const g of [null, undefined, 0, -5, NaN, '', 'abc', {}]) {
    const s = status({ ...flour, grams: g });
    assert.equal(s.linked, true, String(g));
    assert.equal(s.grams, null, `grams ${String(g)}`);
    assert.equal(s.kcal, null, `kcal ${String(g)}`);
    assert.equal(s.needsGrams, true, `needsGrams ${String(g)}`);
    assert.equal(s.foodName, 'Test flour');
  }
});

test('S5 not linked: linked false, foodName "", kcal null, needsGrams false, even when grams is a positive number', () => {
  for (const food of [null, undefined, false]) {
    const s = status({ ...flour, food, grams: 100 });
    assert.equal(s.linked, false, String(food));
    assert.equal(s.foodName, '');
    assert.equal(s.kcal, null);
    assert.equal(s.needsGrams, false);
    assert.equal(s.grams, 100);
  }
  assert.equal(status({ name: 'x', food: null, grams: null }).needsGrams, false);
});

test('S6 kcal is not rounded and uses per100.k * grams / 100 (hand-computed); numeric strings are accepted as Number() does', () => {
  assert.equal(status({ ...flour, grams: 250, food: { name: 'A', per100: { k: 52 } } }).kcal, 130);
  assert.ok(Math.abs(status({ ...flour, grams: 45, food: { name: 'B', per100: { k: 89 } } }).kcal - 40.05) < 1e-9, '45 g at 89 = 40.05');
  assert.ok(Math.abs(status({ ...flour, grams: 0.5, food: { name: 'C', per100: { k: 333 } } }).kcal - 1.665) < 1e-9);
  assert.equal(status({ ...flour, grams: '200' }).grams, 200, 'grams as numeric string');
  assert.equal(status({ ...flour, grams: '200' }).kcal, 760);
  assert.equal(status({ ...flour, grams: 200, food: { name: 'D', per100: { k: '380' } } }).kcal, 760);
  assert.equal(status({ ...flour, grams: 100, food: { name: 'Z', per100: { k: 0 } } }).kcal, 0, '0 kcal food is 0, not null');
});

test('S7 never throws on malformed input and always returns the full shape with safe defaults', () => {
  const empty = { qty: '', name: '', prep: '', linked: false, foodName: '', kcal: null, grams: null, needsGrams: false };
  for (const bad of [null, undefined, {}, 'text', 42, [], NaN, true]) assert.deepEqual(status(bad), empty, String(bad));
  for (const food of [{}, { name: 'N' }, { per100: null }, { name: 'N', per100: 'x' }, { name: 'N', per100: { k: NaN } }, { name: 'N', per100: {} }]) {
    const s = status({ name: 'x', food, grams: 100 });
    assert.equal(s.linked, true, JSON.stringify(food));
    assert.deepEqual(Object.keys(s).sort(), KEYS);
    assert.ok(s.kcal === null || Number.isFinite(s.kcal), `kcal must be null or finite, got ${s.kcal} for ${JSON.stringify(food)}`);
    assert.equal(s.grams, 100);
    assert.equal(s.needsGrams, false);
  }
  assert.equal(status({ name: 'x', food: {} }).foodName, '', 'food without a name');
  assert.equal(status({ name: 'x', food: { name: 'N' }, grams: 5 }).foodName, 'N');
});

test('S8 name and prep are strings; missing gives ""; strings are returned verbatim (escaping is the UI job)', () => {
  const s = status({ name: undefined, prep: null, qty: 1 });
  assert.equal(s.name, '');
  assert.equal(s.prep, '');
  for (const v of [5, {}, [], null]) {
    const t = status({ name: v, prep: v });
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.prep, 'string');
  }
  const html = status({ name: '<img src=x onerror=alert(1)>', prep: '"><script>x</script>', food: { name: '<b>F</b> & co' }, grams: 10 });
  assert.equal(html.name, '<img src=x onerror=alert(1)>');
  assert.equal(html.prep, '"><script>x</script>');
  assert.equal(html.foodName, '<b>F</b> & co');
  const long = 'x'.repeat(100000);
  assert.equal(status({ name: long }).name.length, 100000, 'very long text is not truncated by the helper');
});

test('S9 does not mutate its input (deep-frozen input works) and returns fresh values each call', () => {
  const deep = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deep(v)); return Object.freeze(o); };
  const ing = deep(structuredClone(flour));
  const before = JSON.stringify(ing);
  const a = status(ing), b = status(ing);
  assert.equal(JSON.stringify(ing), before);
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  a.name = 'changed'; a.kcal = -1;
  assert.equal(ing.name, 'flour');
  assert.equal(status(ing).name, 'flour');
  assert.equal(status(ing).kcal, 760);
});

test('S10 hostile keys: own "__proto__" keys and inherited properties do not make an ingredient linked or leak values', () => {
  const evil = JSON.parse('{"name":"x","__proto__":{"food":{"name":"evil","per100":{"k":999}},"grams":50}}');
  const s = status(evil);
  assert.equal(s.linked, false);
  assert.equal(s.foodName, '');
  assert.equal(s.kcal, null);
  assert.equal(({}).food, undefined, 'Object.prototype was not polluted');
  assert.deepEqual(Object.keys(s).sort(), KEYS);
  const evilFood = status({ name: 'x', grams: 100, food: JSON.parse('{"name":"ok","per100":{"__proto__":{"k":999}}}') });
  assert.ok(evilFood.kcal === null || Number.isFinite(evilFood.kcal));
  assert.notEqual(evilFood.kcal, 999);
});

test('S11 icon state does not depend on the re-parse: parseIngredient output never carries food or grams, so Object.assign(i, parse) leaves the link intact', () => {
  for (const t of ['2 cups flour', '', '   ', 'salt', '1 1/2 tbsp olive oil, melted']) {
    const p = parseIngredient(t);
    assert.ok(!Object.hasOwn(p, 'food'), `parse of "${t}" has a food key`);
    assert.ok(!Object.hasOwn(p, 'grams'), `parse of "${t}" has a grams key`);
  }
});

// ---------- WEAK static checks ----------

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const editor = () => read('js/ui/recipe-editor.js');
const css = () => read('css/components.css');
const cssRules = () => [...strip(css()).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].replace(/\s*([:;])\s*/g, '$1').replace(/\s+/g, ' ').trim() }));
const rulesFor = pred => cssRules().filter(r => r.sel.split(',').some(s => pred(s.trim())));
/** the editor text of the per-ingredient row: from the row opener before .ing-raw to the remove button */
function rowSegment(src) {
  const i = src.indexOf('class="ing-raw"');
  assert.ok(i > 0, 'class="ing-raw" input in editor markup');
  const start = src.lastIndexOf('<div class="row">', i);
  assert.ok(start >= 0 && i - start < 60, 'the .ing-raw input sits directly inside a <div class="row">');
  const rm = src.indexOf('data-rm', i);
  assert.ok(rm > i, 'remove button after the raw input');
  return src.slice(start, rm + 40);
}
/** opening tag text of the link button in the row markup */
function linkTag(src) {
  const seg = rowSegment(src);
  const d = seg.indexOf('data-link');
  assert.ok(d > 0, 'data-link button inside the same row as .ing-raw and data-rm');
  const open = seg.lastIndexOf('<button', d);
  assert.ok(open >= 0, '<button before data-link');
  return seg.slice(open, d + 400);
}
function infoRegion(src) {
  const m = /(?:function\s+ingInfo|const\s+ingInfo\s*=)[\s\S]*?(?=\n(?:function|const|let|\/\*\*|export)\s)/.exec(strip(src));
  assert.ok(m, 'an ingInfo function builds the info line');
  return m[0];
}

test('U1 the big text button block is gone: no class="fit" data-link and no row wrapper for a link button below the row', () => {
  const src = strip(editor());
  assert.ok(!/class="fit"[^>]*data-link/.test(src), 'old full-width Link food button still present');
  assert.ok(!/<div class="row"><button[^>]*data-link/.test(src));
  assert.ok(!/data-link[^>]*>\s*\$\{[^}]*(?:Change food|Link food)[^}]*\}\s*<\/button>/.test(src), 'visible text label inside the link button');
});

test('U2 one row holds .ing-raw, then the data-link button, then the data-rm button (in that order, no </div> between)', () => {
  const seg = rowSegment(editor());
  const a = seg.indexOf('ing-raw'), b = seg.indexOf('data-link'), c = seg.indexOf('data-rm');
  assert.ok(a >= 0 && b > a && c > b, `order raw(${a}) < link(${b}) < remove(${c})`);
  assert.ok(!seg.includes('</div>'), 'no row closed between the raw input and the remove button');
  assert.ok(/<button\b[^>]*class="[^"]*\bx\b/.test(seg.slice(b)), 'remove button keeps class x');
});

test('U3 the link button contains an inline <svg> that uses currentColor, and the editor has no emoji', () => {
  const src = editor();
  assert.ok(/<svg\b/.test(src), 'inline <svg in the editor source');
  assert.ok(/currentColor/.test(src), 'svg paints with currentColor');
  assert.ok(!/\p{Extended_Pictographic}/u.test(src.replace(/[★☆✕‹]/g, '')), 'no emoji in the editor source (star, cross and chevron already existed)');
  assert.ok(!/\u{1F517}/u.test(src), 'no link emoji');
  const tag = linkTag(src);
  const seg = rowSegment(src);
  const after = seg.slice(seg.indexOf('data-link'), seg.indexOf('data-rm'));
  assert.ok(/<svg\b/.test(after) || /\$\{\s*\w*[Ii]con\w*\s*\}|\$\{\s*\w+\(\s*[^)]*\)\s*\}/.test(after), `the button holds the svg (directly or via a helper); tag: ${tag.slice(0, 80)}`);
  assert.ok(/aria-hidden="true"/.test(src.slice(src.indexOf('<svg'), src.indexOf('<svg') + 200)), 'the svg is decorative: aria-hidden="true"');
});

test('U4 the link button has aria-label and title saying Link food / Change food, with the ingredient name passed through esc()', () => {
  const src = strip(editor());
  const tag = linkTag(src);
  assert.match(tag, /aria-label=/, 'aria-label on the link button');
  assert.match(tag, /\btitle=/, 'title on the link button');
  assert.ok(src.includes('Change food'), 'Change food wording');
  assert.ok(/Link food/.test(src.replace(/head\('Link food'[^)]*\)/, '')), 'Link food wording on the button (not only the picker heading)');
  assert.match(src, /(?:Link|Change) food for[^\n]{0,60}esc\s*\(/, 'the label "Link food for <name>" builds the name through esc()');
  assert.ok(!/aria-label="[^"]*\$\{\s*(?!esc\()[^}]*\.name\b/.test(src), 'no unescaped ingredient name inside an aria-label');
  assert.ok(!/role=["']button["']/.test(src), 'a real <button>, not role=button');
});

test('U5 the link button has a visual state: class linked (or data-linked) when a food is linked, driven by i.food / status.linked, not by the re-parse', () => {
  const src = strip(editor());
  const tag = linkTag(src);
  assert.match(tag, /linked/, 'class linked or data-linked on the button markup');
  assert.match(tag, /\$\{[^}]*(?:\.food|\.linked|\blinked\b)[^}]*\}|data-linked/, 'state computed from the ingredient');
  const onchange = /root\.onchange\s*=[\s\S]*?\n {2}\};/.exec(src);
  assert.ok(onchange, 'root.onchange handler');
  assert.ok(!/data-link|\.lnk|\.linked|classList/.test(onchange[0]), 'the change handler does not touch the icon button');
  assert.match(onchange[0], /\.ing-info'\)\.innerHTML\s*=\s*ingInfo\(/, 'still redraws only .ing-info');
});

test('U6 CSS: the link button class has min-width and min-height of 44px, is fixed width, and a distinct .linked colour rule exists', () => {
  const cls = /class="([^"$]*?)(?:\s|")/.exec(linkTag(editor()));
  assert.ok(cls && cls[1].trim(), 'link button has a class');
  const c = cls[1].trim().split(/\s+/)[0];
  const sized = rulesFor(s => new RegExp(`\\.${c}(?![\\w-])`).test(s) && !/linked/.test(s));
  assert.ok(sized.length, `a CSS rule for .${c}`);
  const body = sized.map(r => r.body).join(';');
  assert.match(body, /min-width:44px/);
  assert.match(body, /min-height:44px/);
  assert.match(body, /flex:0 0 (?:44px|auto)|flex:none|flex-shrink:0|(?:^|;)width:44px/, 'fixed width, does not shrink');
  const linkedRules = rulesFor(s => /linked/.test(s) && (s.includes(`.${c}`) || /\[data-link/.test(s)));
  assert.ok(linkedRules.length, 'a rule for the linked state');
  assert.match(linkedRules.map(r => r.body).join(';'), /(?:^|;)(?:color|stroke|fill):/, 'linked state changes colour');
});

test('U7 CSS spacing: .ing padding about 6px; .ing-info margin-top 2px, font-size 13px, overflow-wrap:anywhere', () => {
  const ing = cssRules().find(r => r.sel === '.ing');
  assert.ok(ing, '.ing rule');
  assert.match(ing.body, /padding:6px 0/, `.ing padding is "${ing.body}"`);
  const info = cssRules().find(r => r.sel === '.ing-info');
  assert.ok(info, '.ing-info rule');
  assert.match(info.body, /margin-top:2px/);
  assert.match(info.body, /font-size:13px/);
  assert.match(info.body, /overflow-wrap:anywhere/);
});

test('U8 CSS: the obsolete .ing-info .row and .ing-info button rules are removed; the inline grams input is compact (max-width 80-100px)', () => {
  for (const r of cssRules()) {
    assert.ok(!/\.ing-info\s+\.row/.test(r.sel), `leftover rule: ${r.sel}`);
    assert.ok(!/\.ing-info\s+button/.test(r.sel), `leftover rule: ${r.sel}`);
  }
  const g = rulesFor(s => /\.grams\b/.test(s));
  assert.ok(g.length, 'a .grams rule');
  const m = /max-width:(\d+)px/.exec(g.map(r => r.body).join(';'));
  assert.ok(m && +m[1] >= 80 && +m[1] <= 100, `grams max-width should be about 90px, got ${m && m[1]}`);
});

test('U9 CSS: the row inside .ing does not wrap and the raw input can shrink; remove button stays 44px wide', () => {
  const ingRows = rulesFor(s => /^\.ing\s+\.row\b/.test(s));
  for (const r of ingRows) assert.ok(!/flex-wrap:wrap/.test(r.body), `${r.sel} must not wrap`);
  assert.ok(!/\.row\{[^}]*flex-wrap:wrap/.test(strip(css()).replace(/\s+/g, '')), 'base .row does not wrap');
  const shrink = rulesFor(s => /^\.ing\b/.test(s) && /(?:input|\.ing-raw)/.test(s)).map(r => r.body).join(';');
  assert.match(shrink, /min-width:0/, 'raw input keeps min-width:0');
  const x = cssRules().find(r => r.sel === '.ing .x');
  assert.ok(x && /flex:0 0 44px/.test(x.body) && /min-height:44px/.test(x.body), '.ing .x stays a 44px fixed button');
});

test('U10 the info line is built from ingredientStatus (imported from domain/recipes.js) and every string goes through esc()', () => {
  const full = strip(editor());
  const names = (/import\s*\{([^}]*)\}\s*from\s*'\.\.\/domain\/recipes\.js'/.exec(full) || [, ''])[1].split(',').map(s => s.trim());
  assert.ok(names.includes('ingredientStatus'), 'ingredientStatus imported from ../domain/recipes.js');
  const region = infoRegion(editor());
  assert.match(region, /ingredientStatus\s*\(/, 'ingInfo uses the helper');
  assert.ok((region.match(/esc\s*\(/g) || []).length >= 4, 'qty, name, prep and food name are escaped');
  for (const f of ['qty', 'name', 'prep', 'foodName']) {
    const total = (region.match(new RegExp(`\\b\\w+\\.${f}\\b`, 'g')) || []).length;
    const safe = (region.match(new RegExp(`esc\\(\\s*\\w+\\.${f}\\b`, 'g')) || []).length;
    assert.equal(safe, total, `every use of status.${f} is inside esc()`);
  }
  assert.ok(!/<button/.test(region), 'no buttons in the info line');
  assert.ok(!/class="row"/.test(region), 'no .row blocks inside .ing-info');
  assert.ok((region.match(/<(?:div|p)\b/g) || []).length <= 1, 'at most one block element (a single line, not stacked paragraphs)');
});

test('U11 the info line markup: inline compact grams input (class grams, aria-label Grams, placeholder grams) with the text "enter grams"; no "Linked:" sentence or "Can\'t convert" paragraph', () => {
  const src = strip(editor());
  assert.ok(!src.includes('Linked:'), '"Linked:" sentence still present');
  assert.ok(!/Can.t convert/.test(src), '"Can\'t convert" paragraph still present');
  const region = infoRegion(editor());
  assert.match(region, /<input\b[^>]*class="grams"[^>]*>/);
  const tag = /<input\b[^>]*class="grams"[^>]*>/.exec(region)[0];
  assert.match(tag, /aria-label="Grams"/);
  assert.match(tag, /placeholder="grams"/);
  assert.match(tag, /type="number"/);
  assert.match(region, /enter grams/);
  assert.match(region, /needsGrams/, 'the grams input is shown from status.needsGrams');
  assert.match(src, /classList\.contains\('grams'\)/, 'the grams input handler is kept');
});

test('U12 existing hooks survive: .ing, data-id, .ing-raw, .ing-info, .x, data-rm, data-link click handlers, readFields guard; sw.js CACHE bumped past v30', () => {
  const src = strip(editor());
  for (const s of ['class="ing"', 'data-id=', 'class="ing-raw"', 'class="ing-info', 'class="x"', 'data-rm', 'data-link']) assert.ok(src.includes(s), s);
  assert.match(src, /t\.closest\('\[data-rm\]'\)/);
  assert.match(src, /t\.closest\('\[data-link\]'\)/);
  assert.match(src, /renderPicker\(i\)/);
  assert.match(src, /setCloseGuard\([\s\S]*readFields\(\)/);
  const m = /const CACHE = 'macro-diary-v(\d+)'/.exec(read('sw.js'));
  assert.ok(m, 'CACHE has the usual form');
  assert.ok(Number(m[1]) > 30, `CACHE is v${m[1]} but must be greater than 30 (v30 is on main)`);
});
