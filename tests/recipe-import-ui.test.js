// WEAK static checks for the recipe-import UI and wiring (docs/specs/recipe-import.md, U1..U12). They read source text only:
// they prove markup, imports and calls exist, NOT that the dialog opens, that tapping Import works, that the editor is
// pre-filled, or that anything is escaped correctly at runtime. See the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const ui = () => read('js/ui/recipe-import.js');
const imports = src => [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)].map(m => ({ names: m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()).filter(Boolean), from: m[2] }));
const importsFrom = (src, path) => imports(src).filter(i => i.from === path).flatMap(i => i.names);

test('U1 index.html has a real <button id="rcImport"> labelled Import inside the Recipes view, next to #rcNew', () => {
  const html = read('index.html');
  const m = html.match(/<button\b[^>]*\bid="rcImport"[^>]*>([^<]*)<\/button>/);
  assert.ok(m, '#rcImport button');
  assert.match(m[1], /import/i);
  const sec = html.slice(html.indexOf('id="v-recipes"'), html.indexOf('id="v-shop"'));
  assert.ok(sec.includes('id="rcImport"') && sec.includes('id="rcNew"'), 'both buttons live in #v-recipes');
  assert.ok(Math.abs(sec.indexOf('id="rcImport"') - sec.indexOf('id="rcNew"')) < 250, 'beside the New recipe button');
  assert.ok(!/id="rcImport"[^>]*role="button"/.test(html));
});

test('U2 js/ui/recipe-import.js exports initRecipeImport and main.js imports and calls it', () => {
  assert.match(ui(), /export\s+(?:function|const)\s+initRecipeImport\b/);
  const main = read('js/main.js');
  assert.ok(importsFrom(main, './ui/recipe-import.js').includes('initRecipeImport'), 'main.js imports initRecipeImport from ./ui/recipe-import.js');
  assert.match(main, /\binitRecipeImport\s*\(\s*\)/);
});

test('U3 the dialog uses the domain importers, toRecipe and the fetch service; layering stays downward (no other ui module except the recipe editor)', () => {
  const src = ui();
  const dom = importsFrom(src, '../domain/recipe-import.js');
  for (const n of ['importFromHtml', 'importFromText', 'toRecipe']) assert.ok(dom.includes(n), n);
  const svc = importsFrom(src, '../services/recipe-fetch.js');
  for (const n of ['recipeImportAvailable', 'fetchRecipePage']) assert.ok(svc.includes(n), n);
  assert.ok(importsFrom(src, '../core/format.js').includes('esc'), 'esc imported from core/format.js');
  for (const i of imports(src)) if (/^\.\/(?!recipe-editor\.js)/.test(i.from)) assert.fail(`ui module imports sibling ui module ${i.from}`);
  assert.ok(!/from\s*['"]\.\.\/ui\//.test(src));
  assert.match(src, /\bimportFromHtml\s*\(/); assert.match(src, /\bimportFromText\s*\(/);
});

test('U4 the URL field is only offered when recipeImportAvailable(...) is true; otherwise a note says URL import needs the backend; a textarea for pasted text/page source is always there', () => {
  const src = ui();
  assert.match(src, /recipeImportAvailable\s*\(/);
  assert.match(src, /effectiveConnection\s*\(/, 'the connection comes from effectiveConnection()');
  assert.match(src, /type="url"/);
  assert.match(src, /<textarea\b/);
  assert.match(src, /backend|sync|project|set up/i, 'a note for users without the backend');
  const iUrl = src.indexOf('type="url"');
  const before = src.slice(Math.max(0, iUrl - 600), iUrl);
  assert.match(before, /recipeImportAvailable|available|canFetch|hasBackend/i, 'the url input is rendered conditionally');
  assert.ok(/<label\b[^>]*for=|aria-label=/.test(src), 'fields are labelled');
});

test('U5 Import button shows a busy state while working and errors are shown inline (no alert())', () => {
  const src = strip(ui());
  assert.ok(/disabled\s*=\s*(true|!0)|aria-busy|setAttribute\(\s*['"]disabled/.test(src), 'busy/disabled toggled');
  assert.ok(/aria-live|role="alert"|role="status"/.test(src), 'error area is announced');
  assert.ok(!/\balert\s*\(/.test(src), 'no alert()');
  assert.match(src, /catch\b/);
});

test('U6 everything from a page, file or error is escaped: imported text and error/warning messages only reach HTML through esc()', () => {
  const src = strip(ui());
  assert.match(src, /\besc\s*\(/);
  const exprs = [...src.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim());
  for (const e of exprs) if (/warn|err|msg|message|name|text|title|source|url|html|result|recipe|draft|note/i.test(e)) assert.match(e, /^esc\s*\(/, `unescaped interpolation: \${${e}}`);
  assert.ok(!/\.innerHTML\s*\+?=\s*[^;]*\b(?:result|recipe|warnings?|err(?:or)?|message)\b(?![^;]*esc\()/i.test(src), 'innerHTML fed from data without esc');
  assert.ok(!/\b(eval|document\.write)\s*\(|new Function\b/.test(src));
});

test('U7 success opens the existing editor with the imported recipe as a NEW, UNSAVED recipe: toRecipe -> openRecipeEditor(draft, notes); the dialog never saves', () => {
  const src = strip(ui());
  assert.ok(importsFrom(src, './recipe-editor.js').includes('openRecipeEditor'));
  assert.match(src, /openRecipeEditor\s*\([^)]*,[^)]*\)/, 'called with a draft AND notes/warnings');
  assert.match(src, /toRecipe\s*\([^)]*\)/);
  assert.ok(!/\bsaveRecipe\s*\(/.test(src), 'importing must not save');
  assert.ok(!/\bsave\s*\(\s*\)/.test(src), 'importing must not call save()');
  assert.ok(!/localStorage/.test(src));
});

test('U8 the page URL is passed to toRecipe so it lands in the Source field; the Import dialog sends nothing to the network except via fetchRecipePage', () => {
  const src = strip(ui());
  assert.match(src, /toRecipe\s*\([^)]*,[^)]*,[^)]*,[^)]*\)/, 'toRecipe(result, id, now, sourceUrl) has four arguments');
  assert.ok(!/\bfetch\s*\(/.test(src), 'only the service may call fetch');
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(src));
});

test('U9 recipe-editor.js: openRecipeEditor accepts a pre-filled draft AND notes, and still defaults to a fresh recipe', () => {
  const src = read('js/ui/recipe-editor.js');
  const m = src.match(/export\s+function\s+openRecipeEditor\s*\(([^)]*)\)/);
  assert.ok(m, 'openRecipeEditor export');
  const params = m[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.ok(params.length >= 2, `needs a second parameter for the draft/notes, found (${m[1]})`);
  assert.match(src, /warnings|notes/i);
  assert.match(src, /newRecipe\s*\(/);
  const recipes = read('js/ui/recipes-view.js');
  assert.match(recipes, /openRecipeEditor\s*\(\s*null\s*\)/, 'existing callers unchanged');
});

test('U10 the editor shows the import notes through esc() and as plain text', () => {
  const src = strip(read('js/ui/recipe-editor.js'));
  const i = src.search(/notes|warnings/i);
  assert.ok(i >= 0);
  const exprs = [...src.matchAll(/\$\{([^}]*(?:note|warning)[^}]*)\}/gi)].map(m => m[1].trim());
  assert.ok(exprs.length > 0, 'notes are rendered');
  for (const e of exprs) assert.match(e, /esc\s*\(/, `unescaped: ${e}`);
});

test('U11 the three new shipped files are in the service worker precache list and CACHE was bumped past v25', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of ['js/domain/recipe-import.js', 'js/services/recipe-fetch.js', 'js/ui/recipe-import.js']) assert.ok(shell.includes(f), `${f} missing from SHELL`);
  const cache = sw.match(/const CACHE\s*=\s*'([^']+)'/);
  assert.ok(cache && cache[1] !== 'macro-diary-v25', `CACHE must be bumped (still ${cache && cache[1]})`);
  assert.ok(!shell.some(f => f.startsWith('supabase/')), 'the server function is not a shipped app file');
});

test('U12 STORAGE_KEY is unchanged (page-nutrition: SCHEMA_VERSION is now 7, was 5)', () => {
  assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 9;/);
  assert.match(read('js/core/constants.js') + read('js/core/store.js'), /macrodiary\.v1/);
});
