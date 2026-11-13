// Favourite recipes: spec in docs/specs/favourite-recipes.md. Written before the implementation (red first).
// Behaviour numbers (F1...) match the spec. UI checks (U*) are weak source-text checks, see the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, migrate, sanitize, sanitizeRecipe, SCHEMA_VERSION } from '../js/core/schema.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { newRecipe, setFavorite, searchRecipes, saveRecipe, deleteRecipe } from '../js/domain/recipes.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { createSyncEngine } from '../js/services/sync/engine.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { clone } from './helpers.js';

const rec = (id, over = {}) => ({ id, name: 'Recipe ' + id, description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [], favorite: false, stated: null, updatedAt: 0, ...over });
const base = (recipes = {}, over = {}) => ({ ...defaults(), recipes, ...over });
const HOSTILE = ['true', 'false', 'yes', 1, 0, 2, -1, NaN, Infinity, null, undefined, {}, [], [true], { valueOf: () => true }, '', ' true ', Symbol.iterator.description];

// ---------- schema ----------
test('F1 SCHEMA_VERSION is 7 (was 6; sync-usda-key), defaults() carries it, STORAGE_KEY is unchanged', () => {
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(defaults().schemaVersion, 8);
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
});

test('F2 migrate v4 -> v5: recipes without `favorite` survive intact and get favorite:false', () => {
  const old = { schemaVersion: 4, recipes: { r1: { name: 'Chili', description: 'd', source: 's', servings: 6, totalTime: 30, tags: ['a'], steps: ['x'], ingredients: [{ id: 'i1', raw: '1 cup beans', name: 'beans', qty: 1, unit: 'cup', prep: '', food: null, grams: null }], updatedAt: 777 } },
    plan: {}, shopping: { checks: {}, extras: {} }, tombstones: { gone: 5 }, days: { '2025-01-01': [] } };
  const d = migrate(clone(old));
  assert.equal(d.schemaVersion, 8);
  const r = d.recipes.r1;
  assert.equal(r.favorite, false);
  assert.equal(r.id, 'r1'); assert.equal(r.name, 'Chili'); assert.equal(r.servings, 6); assert.equal(r.totalTime, 30); assert.equal(r.updatedAt, 777);
  assert.deepEqual(r.tags, ['a']); assert.deepEqual(r.steps, ['x']); assert.equal(r.ingredients.length, 1); assert.equal(r.ingredients[0].name, 'beans');
  assert.deepEqual(d.tombstones, { gone: 5 });
  assert.equal(r.updatedAt, 777, 'migration must not re-stamp the recipe (would make old data win every merge)');
});

test('F3 migrate keeps an existing favorite:true on v5 data and on any version', () => {
  assert.equal(migrate({ schemaVersion: 5, recipes: { r1: { name: 'x', favorite: true } } }).recipes.r1.favorite, true);
  assert.equal(migrate({ schemaVersion: 4, recipes: { r1: { name: 'x', favorite: true } } }).recipes.r1.favorite, true);
  assert.equal(migrate({ recipes: { r1: { name: 'x' } } }).recipes.r1.favorite, false);   // v1 data with stray recipes
});

test('F4 sanitizeRecipe: favorite is a strict boolean; only `true` is true', () => {
  assert.equal(sanitizeRecipe({ name: 'x', favorite: true }, 'r').favorite, true);
  assert.equal(sanitizeRecipe({ name: 'x', favorite: false }, 'r').favorite, false);
  assert.equal(sanitizeRecipe({ name: 'x' }, 'r').favorite, false);
  for (const h of HOSTILE) {
    const r = sanitizeRecipe({ name: 'x', favorite: h }, 'r');
    assert.equal(r.favorite, false, `favorite ${String(h)} must become false`);
    assert.equal(typeof r.favorite, 'boolean');
  }
  assert.equal(sanitize({ recipes: { a: { name: 'x', favorite: 'true' }, b: { name: 'y', favorite: true } } }).recipes.a.favorite, false);
  assert.equal(sanitize({ recipes: { b: { name: 'y', favorite: true } } }).recipes.b.favorite, true);
});

test('F5 sanitizeRecipe adds no other new fields and keeps rejecting nameless input', () => {
  const keys = Object.keys(sanitizeRecipe({ name: 'x' }, 'r')).sort();
  assert.deepEqual(keys, ['description', 'favorite', 'id', 'ingredients', 'name', 'servings', 'source', 'stated', 'steps', 'tags', 'totalTime', 'updatedAt']);
  assert.equal(sanitizeRecipe({ name: '', favorite: true }, 'r'), null);
});

// ---------- domain ----------
test('F6 newRecipe returns favorite:false', () => {
  assert.equal(newRecipe('r1', 5).favorite, false);
  assert.equal(newRecipe('r1', 5).updatedAt, 5);
});

test('F7 setFavorite sets the flag, stamps updatedAt = now, returns true', () => {
  const s = base({ r1: rec('r1', { updatedAt: 10 }) });
  assert.equal(setFavorite(s, 'r1', true, 99), true);
  assert.equal(s.recipes.r1.favorite, true); assert.equal(s.recipes.r1.updatedAt, 99);
  assert.equal(setFavorite(s, 'r1', false, 150), true);
  assert.equal(s.recipes.r1.favorite, false); assert.equal(s.recipes.r1.updatedAt, 150);
});

test('F8 setFavorite with the same value again is still "applied": returns true and re-stamps', () => {
  const s = base({ r1: rec('r1', { favorite: true, updatedAt: 10 }) });
  assert.equal(setFavorite(s, 'r1', true, 50), true);
  assert.equal(s.recipes.r1.favorite, true); assert.equal(s.recipes.r1.updatedAt, 50);
});

test('F9 setFavorite only changes favorite and updatedAt of that recipe', () => {
  const s = base({ r1: rec('r1', { name: 'Soup', tags: ['a'], updatedAt: 1 }), r2: rec('r2', { updatedAt: 2 }) });
  const before = clone(s);
  setFavorite(s, 'r1', true, 9);
  assert.deepEqual(s.recipes.r2, before.recipes.r2);
  assert.deepEqual({ ...s.recipes.r1, favorite: false, updatedAt: 1 }, before.recipes.r1);
  assert.deepEqual(s.tombstones, before.tombstones); assert.deepEqual(s.days, before.days);
});

test('F10 setFavorite coerces `on` strictly: only true is true', () => {
  for (const h of HOSTILE) {
    const s = base({ r1: rec('r1', { favorite: true }) });
    setFavorite(s, 'r1', h, 5);
    assert.equal(s.recipes.r1.favorite, false, `on=${String(h)}`);
    assert.equal(typeof s.recipes.r1.favorite, 'boolean');
  }
  const s = base({ r1: rec('r1') }); setFavorite(s, 'r1', true, 5); assert.strictEqual(s.recipes.r1.favorite, true);
});

test('F11 setFavorite on an unknown id returns false, does not throw, does not mutate', () => {
  const s = base({ r1: rec('r1') }); s.tombstones = { x: 3 };
  const snap = clone(s);
  for (const id of ['nope', '', undefined, null, 5, {}, [], '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(setFavorite(s, id, true, 9), false, String(id));
  }
  assert.deepEqual(clone(s), snap);
  assert.equal(Object.getPrototypeOf(s.recipes), Object.prototype);
  assert.equal({}.favorite, undefined, 'Object.prototype must not be polluted');
});

test('F12 setFavorite on a bad/empty state returns false without throwing', () => {
  for (const s of [null, undefined, {}, { recipes: null }, { recipes: [] }, { recipes: 'x' }]) assert.doesNotThrow(() => assert.equal(setFavorite(s, 'r1', true, 1), false));
  const e = {}; setFavorite(e, 'r1', true, 1); assert.deepEqual(e, {}, 'must not create state.recipes');
  const r = base({ r1: 5 }); assert.doesNotThrow(() => setFavorite(r, 'r1', true, 1));   // a junk recipe value: no throw (result unspecified)
});

test('F13 a deleted recipe is not resurrected: unknown id, tombstone untouched', () => {
  const s = base({ r1: rec('r1') }); deleteRecipe(s, 'r1', 40);
  assert.equal(setFavorite(s, 'r1', true, 99), false);
  assert.deepEqual(s.recipes, {}); assert.deepEqual(s.tombstones, { r1: 40 });
});

test('F14 setFavorite never clears tombstones of other ids', () => {
  const s = base({ r1: rec('r1') }); s.tombstones = { a: 1, b: 2, r2: 3 };
  setFavorite(s, 'r1', true, 10);
  assert.deepEqual(s.tombstones, { a: 1, b: 2, r2: 3 });
});

test('F15 other recipe edits still behave: saveRecipe keeps favorite, deleteRecipe removes it', () => {
  const s = base();
  saveRecipe(s, rec('r1', { favorite: true }), 5);
  assert.equal(s.recipes.r1.favorite, true);
  assert.equal(deleteRecipe(s, 'r1', 6), true); assert.deepEqual(s.recipes, {});
});

// ---------- search ----------
const lib = () => base({
  a: rec('a', { name: 'Banana bread', favorite: true }), b: rec('b', { name: 'apple pie' }), c: rec('c', { name: 'Chili', tags: ['dinner'], favorite: true }),
  d: rec('d', { name: 'Apple crumble', favorite: true }), e: rec('e', { name: 'Eggs', favorite: 'true' }), f: rec('f', { name: 'Fish' }),
});
const names = l => l.map(r => r.name);

test('F16 searchRecipes without opts is unchanged (all recipes, name order)', () => {
  assert.deepEqual(names(searchRecipes(lib(), '')), ['Apple crumble', 'apple pie', 'Banana bread', 'Chili', 'Eggs', 'Fish']);
  assert.deepEqual(names(searchRecipes(lib(), '')), names(searchRecipes(lib(), '', {})));
  assert.deepEqual(names(searchRecipes(lib(), '', { favoritesOnly: false })), names(searchRecipes(lib(), '')));
  assert.deepEqual(names(searchRecipes(lib(), 'apple')), ['Apple crumble', 'apple pie']);
});

test('F17 favoritesOnly:true keeps only favorite === true, in the same order', () => {
  assert.deepEqual(names(searchRecipes(lib(), '', { favoritesOnly: true })), ['Apple crumble', 'Banana bread', 'Chili']);
  assert.ok(!names(searchRecipes(lib(), '', { favoritesOnly: true })).includes('Eggs'), "string 'true' is not a favourite");
});

test('F18 favoritesOnly combines with the text query (AND), including tags and ingredient names', () => {
  assert.deepEqual(names(searchRecipes(lib(), 'apple', { favoritesOnly: true })), ['Apple crumble']);
  assert.deepEqual(names(searchRecipes(lib(), 'dinner', { favoritesOnly: true })), ['Chili']);
  assert.deepEqual(names(searchRecipes(lib(), 'fish', { favoritesOnly: true })), []);
});

test('F19 favoritesOnly on an empty / missing recipe list returns [] and does not throw', () => {
  assert.deepEqual(searchRecipes(base(), '', { favoritesOnly: true }), []);
  assert.deepEqual(searchRecipes({}, '', { favoritesOnly: true }), []);
  assert.deepEqual(searchRecipes({ recipes: null }, 'x', { favoritesOnly: true }), []);
});

test('F20 equal names sort by id, also under favoritesOnly', () => {
  const s = base({ z: rec('z', { name: 'Same', favorite: true }), m: rec('m', { name: 'Same', favorite: true }), q: rec('q', { name: 'Same' }) });
  assert.deepEqual(searchRecipes(s, '', { favoritesOnly: true }).map(r => r.id), ['m', 'z']);
});

test('F21 searchRecipes does not mutate state or return the stored array', () => {
  const s = lib(), snap = clone(s);
  searchRecipes(s, 'a', { favoritesOnly: true });
  assert.deepEqual(clone(s), snap);
});

// ---------- merge / backup / sync ----------
test('F22 merge: same recipe differing only in favorite takes the newer updatedAt, both directions', () => {
  const off = base({ r1: rec('r1', { favorite: false, updatedAt: 10 }) }), on = base({ r1: rec('r1', { favorite: true, updatedAt: 20 }) });
  assert.equal(mergeStates(off, on).recipes.r1.favorite, true); assert.equal(mergeStates(on, off).recipes.r1.favorite, true);
  const on2 = base({ r1: rec('r1', { favorite: true, updatedAt: 10 }) }), off2 = base({ r1: rec('r1', { favorite: false, updatedAt: 20 }) });
  assert.equal(mergeStates(on2, off2).recipes.r1.favorite, false); assert.equal(mergeStates(off2, on2).recipes.r1.favorite, false);
});

test('F23 setFavorite wins a merge against an older remote copy, loses against a newer one', () => {
  const local = base({ r1: rec('r1', { updatedAt: 10 }) });
  const remoteOld = clone(local);
  setFavorite(local, 'r1', true, 100);
  assert.equal(mergeStates(local, remoteOld).recipes.r1.favorite, true);
  const remoteNew = base({ r1: rec('r1', { favorite: false, name: 'Renamed', updatedAt: 200 }) });
  const m = mergeStates(local, remoteNew).recipes.r1;
  assert.equal(m.favorite, false); assert.equal(m.name, 'Renamed');
});

test('F24 a favourited recipe that was deleted later stays deleted (tombstone newer than the favourite stamp)', () => {
  const local = base({ r1: rec('r1', { favorite: true, updatedAt: 10 }) });
  const remote = base({}, { tombstones: { r1: 50 } });
  assert.deepEqual(mergeStates(local, remote).recipes, {});
});

test('F25 backup round trip keeps the flag (JSON export, mergeRestore into an empty state)', () => {
  const s = base({ r1: rec('r1', { favorite: true, updatedAt: 5 }), r2: rec('r2', { favorite: false, updatedAt: 6 }) });
  const restored = mergeRestore(defaults(), JSON.parse(JSON.stringify(s)));
  assert.equal(restored.recipes.r1.favorite, true); assert.equal(restored.recipes.r2.favorite, false);
  assert.equal(restored.recipes.r1.updatedAt, 5);
});

test('F26 an OLD backup (no favorite field, schema 4) imports with favorite:false and nothing else changes', () => {
  const old = { schemaVersion: 4, days: {}, recipes: { r1: { name: 'Old', description: 'd', source: '', servings: 2, totalTime: null, tags: ['t'], steps: ['s'], ingredients: [], updatedAt: 9 } }, plan: {}, shopping: { checks: {}, extras: {} } };
  const m = mergeRestore(defaults(), old).recipes.r1;
  assert.deepEqual(m, { id: 'r1', name: 'Old', description: 'd', source: '', servings: 2, totalTime: null, tags: ['t'], steps: ['s'], ingredients: [], favorite: false, stated: null, updatedAt: 9 });
});

test('F27 restoring an old backup does not un-favourite a newer local favourite; hostile favorite values in a backup become false', () => {
  const local = base({ r1: rec('r1', { favorite: true, updatedAt: 50 }) });
  const old = { schemaVersion: 4, recipes: { r1: { name: 'Recipe r1', updatedAt: 10 } } };
  assert.equal(mergeRestore(local, old).recipes.r1.favorite, true);
  for (const h of HOSTILE) {
    const bk = JSON.parse(JSON.stringify({ schemaVersion: 5, recipes: { z: { name: 'z', favorite: h, updatedAt: 1 } } }));   // a backup is a JSON file
    assert.equal(mergeRestore(defaults(), bk).recipes.z.favorite, false, String(h));
  }
});

test('F28 the flag is carried inside the recipe record and survives a records -> state round trip', () => {
  const s = base({ r1: rec('r1', { favorite: true, updatedAt: 7 }), r2: rec('r2', { updatedAt: 8 }) });
  const recs = clone(toRecords(s));
  assert.equal(recs.find(r => r.key === 'recipe:r1').value.recipe.favorite, true);
  assert.equal(recs.find(r => r.key === 'recipe:r1').updatedAt, 7);
  assert.equal(recs.find(r => r.key === 'recipe:r2').value.recipe.favorite, false);
  assert.deepEqual(recs.map(r => r.key).filter(k => k.startsWith('recipe:')), ['recipe:r1', 'recipe:r2']);   // no new record kind
  const back = applyRecords(defaults(), recs);
  assert.deepEqual(back.recipes, s.recipes);
});

test('F29 applyRecords: missing or hostile favorite in a remote record becomes false; no throw', () => {
  const out = applyRecords(defaults(), [{ key: 'recipe:a', value: { recipe: { name: 'a' } }, updatedAt: 1 },
    ...HOSTILE.map((h, i) => ({ key: 'recipe:h' + i, value: { recipe: { name: 'h', favorite: h } }, updatedAt: 1 })),
    { key: 'recipe:t', value: { recipe: { name: 't', favorite: true } }, updatedAt: 1 }]);
  assert.equal(out.recipes.a.favorite, false); assert.equal(out.recipes.t.favorite, true);
  for (let i = 0; i < HOSTILE.length; i++) assert.equal(out.recipes['h' + i].favorite, false, `h${i}`);
});

test('F30 two devices: favouriting on one reaches the other; the later toggle wins', async () => {
  let clock = 9000; const tick = () => ++clock;
  class Device {
    constructor(adapter) {
      this.state = defaults(); this.saved = null;
      this.engine = createSyncEngine({ adapter, getState: () => this.state, applyState: s => { this.state = s; }, now: tick,
        meta: { load: () => (this.saved ? clone(this.saved) : null), save: o => { this.saved = clone(o); } } });
    }
    sync() { return this.engine.sync(); }
  }
  const srv = createMemoryAdapter(), phone = new Device(srv), pc = new Device(srv);
  phone.state.recipes.r1 = rec('r1', { name: 'Soup', updatedAt: tick() });
  await phone.sync(); await pc.sync();
  assert.equal(pc.state.recipes.r1.favorite, false);
  assert.equal(setFavorite(phone.state, 'r1', true, tick()), true);
  await phone.sync(); await pc.sync();
  assert.equal(pc.state.recipes.r1.favorite, true, 'phone favourite reached the PC');
  assert.equal(setFavorite(pc.state, 'r1', false, tick()), true);
  await pc.sync(); await phone.sync(); await pc.sync();
  assert.equal(phone.state.recipes.r1.favorite, false, 'later un-favourite wins');
  assert.equal(pc.state.recipes.r1.favorite, false);
});

// ---------- UI wiring: weak static checks (see spec) ----------
const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('U1 recipes-view: card star is a real <button> with aria-label and aria-pressed, name still escaped', () => {
  const s = src('js/ui/recipes-view.js');
  assert.match(s, /<button[^>]*aria-pressed=/, 'card toggle needs a <button> with aria-pressed');
  assert.match(s, /<button[^>]*aria-label=/, 'card toggle needs aria-label');
  assert.match(s, /esc\(\s*r\.name\s*\)/, 'recipe name must stay escaped');
});

test('U2 recipes-view toggles through setFavorite, saves, and re-renders via recipes:changed; never assigns .favorite itself', () => {
  const s = src('js/ui/recipes-view.js');
  assert.match(s, /\bsetFavorite\s*\(/);
  assert.match(s, /\bsave\s*\(\s*\)/);
  assert.match(s, /emit\s*\(\s*['"]recipes:changed['"]/);
  assert.doesNotMatch(s, /\.favorite\s*=[^=]/, 'the UI must not mutate the recipe directly');
});

test('U3 recipes-view passes favoritesOnly to searchRecipes', () => {
  assert.match(src('js/ui/recipes-view.js'), /favoritesOnly/);
});

test('U4 recipe-editor has a favourite toggle <button> with aria-pressed and uses setFavorite', () => {
  const s = src('js/ui/recipe-editor.js');
  assert.match(s, /<button[^>]*aria-pressed=/);
  assert.match(s, /\bsetFavorite\b/);
  assert.match(s, /favou?rite/i);
});

test('U5 index.html: a Favourites filter <button> with aria-pressed exists inside the recipes view, after the search box', () => {
  const html = src('index.html');
  const sec = html.slice(html.indexOf('id="v-recipes"'), html.indexOf('id="v-shop"'));
  assert.ok(sec.includes('id="rcQ"'));
  assert.match(sec, /<button[^>]*aria-pressed="false"[^>]*>[^<]*Favou?rites/i, 'filter must start off (aria-pressed="false") and be labelled Favourites');
});

test('U6 the star toggle in the card does not rely on a non-button element (no role=button spans/divs)', () => {
  for (const f of ['js/ui/recipes-view.js', 'js/ui/recipe-editor.js']) assert.doesNotMatch(src(f), /role=["']button["']/);
});
