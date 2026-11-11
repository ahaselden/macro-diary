// Spec: docs/specs/barcode-from-photo.md
// Behaviours 1-9 are pure/service logic (real tests). Behaviours 10-18 are STATIC TEXT checks over
// shipped source: they prove names/ordering are present, NOT that the feature works in a browser.
// Real behaviour is covered by the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeBarcode, pickBarcode, barcodeOffer } from '../js/domain/barcode.js';
import { decodeImageBarcode, makeDecoder } from '../js/services/barcode.js';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Hand-computed valid GTINs (check digit worked out by hand, see spec).
const EAN13 = '4006381333931', EAN8 = '96385074', UPCA = '036000291452', GTIN14 = '10614141000415';

// ---------- 1. normalizeBarcode ----------
test('1a. normalizeBarcode accepts valid EAN-13, EAN-8, UPC-A, GTIN-14 and returns the digits unchanged', () => {
  for (const c of [EAN13, EAN8, UPCA, GTIN14]) assert.equal(normalizeBarcode(c), c);
  assert.equal(normalizeBarcode(UPCA).length, 12, 'UPC-A must not be converted to 13 digits or have its leading zero stripped');
});
test('1b. normalizeBarcode trims surrounding whitespace only', () => {
  assert.equal(normalizeBarcode(`  ${EAN13}\n`), EAN13);
  assert.equal(normalizeBarcode('\t' + EAN8 + ' '), EAN8);
  assert.equal(normalizeBarcode('4006 381333931'), '', 'inner whitespace is not accepted');
});
test('1c. normalizeBarcode rejects a bad check digit (each valid code with its last digit changed)', () => {
  for (const c of [EAN13, EAN8, UPCA, GTIN14]) {
    for (let d = 0; d < 10; d++) {
      const bad = c.slice(0, -1) + d;
      assert.equal(normalizeBarcode(bad), bad === c ? c : '', bad);
    }
  }
});
test('1d. normalizeBarcode rejects wrong lengths even with plausible digits', () => {
  for (const s of ['', '1', '1234567', '123456789', '1234567890', '12345678901', '123456789012345', '0'.repeat(30)]) assert.equal(normalizeBarcode(s), '', s);
  // 9-digit and 10/11-digit strings must be rejected whatever their check digit
  assert.equal(normalizeBarcode('0000000000'), '');
  assert.equal(normalizeBarcode('000000000000000'), '');
});
test('1e. normalizeBarcode rejects letters, symbols, unicode digits, signs and decimals', () => {
  for (const s of [EAN13 + 'x', 'x' + EAN13, '40O6381333931', '4006381333931.0', '+4006381333931', '-4006381333931', '4006381333931e0',
    '４００６３８１３３３９３１', '٤٠٠٦٣٨١٣٣٣٩٣١', '<b>4006381333931</b>', '4006381333931\u0000']) assert.equal(normalizeBarcode(s), '', JSON.stringify(s));
});
test('1f. normalizeBarcode never throws and returns "" for non-strings (numbers, null, objects, symbols, bigint)', () => {
  const evil = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
  for (const v of [undefined, null, 4006381333931, NaN, Infinity, true, {}, [], [EAN13], evil, Symbol('x'), 10n, () => EAN13, new String(EAN13)]) {
    assert.equal(normalizeBarcode(v), '', String(typeof v));
  }
  assert.equal(normalizeBarcode(), '');
});
test('1g. normalizeBarcode copes with a huge string without hanging or throwing', () => {
  assert.equal(normalizeBarcode('1'.repeat(1e6)), '');
  assert.equal(normalizeBarcode(' '.repeat(1e6) + EAN13), EAN13);
});

// ---------- 1. pickBarcode ----------
test('1h. pickBarcode returns the first normalizable code, skipping junk entries', () => {
  assert.equal(pickBarcode([null, undefined, 5, {}, 'hello', '4006381333932', ` ${EAN8} `, EAN13]), EAN8);
  assert.equal(pickBarcode([EAN13, EAN8]), EAN13);
});
test('1i. pickBarcode returns "" for no valid code, empty array, and non-arrays', () => {
  assert.equal(pickBarcode([]), '');
  assert.equal(pickBarcode(['abc', 123, null]), '');
  for (const v of [undefined, null, EAN13, 5, {}, { 0: EAN13, length: 1 }, new Set([EAN13])]) assert.equal(pickBarcode(v), '', String(v));
});
test('1j. pickBarcode does not throw on a sparse array, hostile entries, or mutate its input', () => {
  const evil = { toString() { throw new Error('boom'); } };
  const arr = [evil, , Symbol('s'), 'x', EAN13]; arr.length = 6;
  const before = arr.slice();
  assert.equal(pickBarcode(arr), EAN13);
  assert.deepEqual(arr, before);
});

// ---------- 1. barcodeOffer ----------
const prod = (over = {}) => ({ id: 'x', name: 'Oat Bar', brand: 'Acme', per100: { k: 400, p: 8, c: 60, f: 12 }, ...over });
test('1k. barcodeOffer returns the first usable result (same object, not a copy)', () => {
  const a = prod({ name: 'First' }), b = prod({ name: 'Second' });
  assert.equal(barcodeOffer(EAN13, [a, b]), a);
});
test('1l. barcodeOffer skips results without a usable per100.k or name, in order', () => {
  const bads = [null, undefined, 'str', 7, [], prod({ name: '' }), prod({ name: undefined }), prod({ name: 5 }),
    prod({ per100: undefined }), prod({ per100: null }), prod({ per100: {} }), prod({ per100: { k: NaN } }), prod({ per100: { k: Infinity } }),
    prod({ per100: { k: -1 } }), prod({ per100: { k: '400' } }), prod({ per100: { k: null } })];
  const good = prod({ name: 'Good' });
  assert.equal(barcodeOffer(EAN13, [...bads, good]), good);
  assert.equal(barcodeOffer(EAN13, bads), null);
});
test('1m. barcodeOffer accepts per100.k of exactly 0 (water) but not negative', () => {
  const water = prod({ name: 'Water', per100: { k: 0 } });
  assert.equal(barcodeOffer(EAN13, [water]), water);
  assert.equal(barcodeOffer(EAN13, [prod({ per100: { k: -0.0001 } })]), null);
});
test('1n. barcodeOffer returns null for non-array input and empty arrays, never throws', () => {
  for (const v of [undefined, null, 'abc', 5, {}, { length: 1, 0: prod() }, new Set([prod()])]) assert.equal(barcodeOffer(EAN13, v), null);
  assert.equal(barcodeOffer(EAN13, []), null);
  assert.doesNotThrow(() => barcodeOffer(undefined, [prod()])); // whether `code` gates the result is an Open question
});
test('1o. barcodeOffer reads own properties only (inherited name/per100/k do not count) and accepts plain objects only', () => {
  const protoName = Object.create({ name: 'Inherited', per100: { k: 100 } });
  assert.equal(barcodeOffer(EAN13, [protoName]), null);
  const inheritedPer100 = Object.assign(Object.create({ per100: { k: 100 } }), { name: 'N' });
  assert.equal(barcodeOffer(EAN13, [inheritedPer100]), null);
  const inheritedK = { name: 'N', per100: Object.create({ k: 100 }) };
  assert.equal(barcodeOffer(EAN13, [inheritedK]), null);
  class Product { constructor() { this.name = 'Cls'; this.per100 = { k: 1 }; } }
  assert.equal(barcodeOffer(EAN13, [new Product()]), null, 'class instances are not plain objects');
  const nullProto = Object.assign(Object.create(null), { name: 'NP', per100: { k: 5 } });
  assert.equal(barcodeOffer(EAN13, [nullProto]), nullProto, 'null-prototype objects count as plain');
});
test('1p. barcodeOffer survives getters that throw and does not mutate input', () => {
  const thrower = { get name() { throw new Error('boom'); }, per100: { k: 1 } };
  const good = prod();
  assert.equal(barcodeOffer(EAN13, [thrower, good]), good);
  const list = [prod({ name: 'A' }), prod({ name: 'B' })], snap = JSON.stringify(list);
  Object.freeze(list); list.forEach(Object.freeze);
  barcodeOffer(EAN13, list);
  assert.equal(JSON.stringify(list), snap);
});
test('1q. barcodeOffer keeps hostile text as data (no escaping/altering; escaping is the UI job)', () => {
  const r = prod({ name: '<img src=x onerror=alert(1)>', brand: '"><script>' });
  assert.equal(barcodeOffer(EAN13, [r]), r);
  assert.equal(r.name, '<img src=x onerror=alert(1)>');
});

// ---------- 2. decodeImageBarcode ----------
const file = { name: 'p.jpg', size: 10 };
const mk = (log, plan) => ({
  prepare: async (f, size) => { log.push(['prep', size]); if (plan.prepare) return plan.prepare(size); return { size }; },
  decoders: (plan.decoders || []).map((fn, i) => async frame => { log.push(['dec', i, frame.size]); return fn(frame); }),
  ...(plan.sizes ? { sizes: plan.sizes } : {}),
});
test('2a. decodeImageBarcode returns the normalized code from the first decoder that finds one', async () => {
  const log = [];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [async () => `  ${EAN13} `] }));
  assert.equal(out, EAN13);
});
test('2b. default sizes are [1600, 900], tried in order; each decoder gets the frame prepared for that size; prepare once per size', async () => {
  const log = [];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [() => null, () => null] }));
  assert.equal(out, null);
  assert.deepEqual(log, [['prep', 1600], ['dec', 0, 1600], ['dec', 1, 1600], ['prep', 900], ['dec', 0, 900], ['dec', 1, 900]]);
});
test('2c. custom sizes are honoured in order', async () => {
  const log = [];
  await decodeImageBarcode(file, mk(log, { sizes: [500, 2000, 100], decoders: [() => null] }));
  assert.deepEqual(log.filter(e => e[0] === 'prep').map(e => e[1]), [500, 2000, 100]);
});
test('2d. stops calling anything once a code is found (later decoders and sizes are not touched)', async () => {
  const log = [];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [() => null, () => EAN8, () => { throw new Error('must not run'); }] }));
  assert.equal(out, EAN8);
  assert.deepEqual(log, [['prep', 1600], ['dec', 0, 1600], ['dec', 1, 1600]]);
});
test('2e. a code found only at the second size is returned (first size fails everywhere)', async () => {
  const log = [];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [f => (f.size === 900 ? EAN13 : null)] }));
  assert.equal(out, EAN13);
  assert.deepEqual(log.at(-1), ['dec', 0, 900]);
});
test('2f. decoder results that fail normalizeBarcode are skipped and the next decoder/size is tried', async () => {
  const log = [];
  const junk = [() => '4006381333932', () => 'hello', () => 4006381333931, () => '', () => undefined, () => ({}), () => '123'];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [...junk, () => UPCA] }));
  assert.equal(out, UPCA);
  assert.equal(log.filter(e => e[0] === 'dec').length, junk.length + 1);
  // and with only junk, every decoder at every size is tried, result null
  const log2 = [];
  assert.equal(await decodeImageBarcode(file, mk(log2, { decoders: junk })), null);
  assert.equal(log2.filter(e => e[0] === 'dec').length, junk.length * 2);
});
test('2g. a decoder that throws or rejects is skipped; the next decoder still runs', async () => {
  const log = [];
  const out = await decodeImageBarcode(file, mk(log, { decoders: [() => { throw new Error('sync boom'); }, () => Promise.reject(new Error('async boom')), () => EAN13] }));
  assert.equal(out, EAN13);
});
test('2h. a sync-throwing raw decoder function (not wrapped in async) is also tolerated', async () => {
  const out = await decodeImageBarcode(file, { prepare: async () => ({}), decoders: [() => { throw new Error('x'); }, async () => EAN8], sizes: [100] });
  assert.equal(out, EAN8);
});
test('2i. a prepare that throws or rejects for one size is skipped; the next size is still tried', async () => {
  const seen = [];
  const deps = {
    prepare: async (f, size) => { seen.push(size); if (size === 1600) throw new Error('canvas failed'); return { size }; },
    decoders: [async fr => (fr.size === 900 ? EAN13 : null)],
  };
  assert.equal(await decodeImageBarcode(file, deps), EAN13);
  assert.deepEqual(seen, [1600, 900]);
  const sync = { prepare: (f, size) => { if (size === 1600) throw new Error('sync'); return { size }; }, decoders: [async () => EAN8] };
  assert.equal(await decodeImageBarcode(file, sync), EAN8);
});
test('2j. everything failing resolves to null (never rejects)', async () => {
  const deps = { prepare: async () => { throw new Error('a'); }, decoders: [async () => { throw new Error('b'); }] };
  assert.equal(await decodeImageBarcode(file, deps), null);
});
test('2k. hostile inputs resolve to null instead of throwing: no file, no decoders, empty/odd sizes, wrong dep types', async () => {
  const ok = { prepare: async () => ({}), decoders: [async () => null] };
  for (const f of [null, undefined, 5, 'x', {}]) assert.equal(await decodeImageBarcode(f, ok), null);
  assert.equal(await decodeImageBarcode(file, { prepare: async () => ({}), decoders: [] }), null);
  assert.equal(await decodeImageBarcode(file, { prepare: async () => ({}), decoders: [async () => EAN13], sizes: [] }), null);
  for (const decoders of [null, 'x', {}, 5, [null, 'x', 5, undefined]]) assert.equal(await decodeImageBarcode(file, { prepare: async () => ({}), decoders }), null);
  assert.equal(await decodeImageBarcode(file, { prepare: 'nope', decoders: [async () => EAN13] }), null);
});
test('2l. with no deps in Node (no canvas, no window) it resolves null instead of throwing', async () => {
  assert.equal(await decodeImageBarcode(file), null);
  assert.equal(await decodeImageBarcode(null), null);
  assert.equal(await decodeImageBarcode(file, {}), null);
  assert.equal(await decodeImageBarcode(file, null), null);
});
test('2m. does not mutate the deps arrays', async () => {
  const sizes = Object.freeze([1600, 900]), decoders = Object.freeze([async () => null]);
  assert.equal(await decodeImageBarcode(file, { prepare: async () => ({}), decoders, sizes }), null);
});

// ---------- 3. real ZXing path on rendered pixels ----------
const mod = { exports: {} };
new Function('exports', 'module', readFileSync(new URL('../js/vendor/zxing.min.js', import.meta.url), 'utf8'))(mod.exports, mod);
const Z = mod.exports;
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(c => [...c].map(b => b ^ 1).join(''));
const G = R.map(c => [...c].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13Modules(d13) {
  const par = PARITY[+d13[0]];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (par[i] === 'L' ? L : G)[+d13[i + 1]];
  m += '01010';
  for (let i = 7; i < 13; i++) m += R[+d13[i]];
  return m + '101';
}
// Greyscale pixels for the code. `scale` models a photo downscaled differently per maxSide.
function pixels(code13, { px = 3, h = 90, quiet = 12 } = {}) {
  const mods = '0'.repeat(quiet) + ean13Modules(code13) + '0'.repeat(quiet), w = mods.length * px, img = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mods[Math.floor(x / px)] === '1') img[y * w + x] = 0;
  return new Z.RGBLuminanceSource(img, w, h);
}
test('3a. real ZXing decoder behind decodeImageBarcode reads a rendered EAN-13 and returns it normalized', async () => {
  const dec = makeDecoder(Z);
  const out = await decodeImageBarcode(file, { prepare: async () => pixels(EAN13), decoders: [async fr => dec(fr)] });
  assert.equal(out, EAN13);
});
test('3b. real ZXing on a blank frame gives null; a later size that has the barcode wins', async () => {
  const dec = makeDecoder(Z), blank = new Z.RGBLuminanceSource(new Uint8ClampedArray(200 * 100).fill(255), 200, 100);
  const deps = { prepare: async (f, size) => (size === 1600 ? blank : pixels(EAN13)), decoders: [async fr => dec(fr)] };
  assert.equal(await decodeImageBarcode(file, deps), EAN13);
  assert.equal(await decodeImageBarcode(file, { prepare: async () => blank, decoders: [async fr => dec(fr)] }), null);
});
test('3c. a ZXing UPC-A read as EAN-13 with a leading 0 is returned as a valid 13-digit code (still accepted by normalizeBarcode)', async () => {
  const dec = makeDecoder(Z), eanFromUpc = '0' + UPCA;
  const out = await decodeImageBarcode(file, { prepare: async () => pixels(eanFromUpc), decoders: [async fr => dec(fr)] });
  assert.ok(out === eanFromUpc || out === UPCA, `got ${out}`);
});

// ---------- UI + wiring: STATIC TEXT checks (weak) ----------
const cf = rd('js/ui/custom-food.js');
const body = cf.slice(cf.indexOf('async function readLabel'));
const at = s => body.indexOf(s);

test('4. [static] custom-food.js imports decodeImageBarcode, normalizeBarcode, barcodeOffer and searchAll from the right modules', () => {
  assert.match(cf, /import\s*\{[^}]*\bdecodeImageBarcode\b[^}]*\}\s*from\s*'\.\.\/services\/barcode\.js'/);
  assert.match(cf, /import\s*\{[^}]*\bnormalizeBarcode\b[^}]*\}\s*from\s*'\.\.\/domain\/barcode\.js'/);
  assert.match(cf, /import\s*\{[^}]*\bbarcodeOffer\b[^}]*\}\s*from\s*'\.\.\/domain\/barcode\.js'/);
  assert.match(cf, /import\s*\{[^}]*\bsearchAll\b[^}]*\}\s*from\s*'\.\.\/services\/foods\.js'/);
});
test('5. [static] the file size cap (25e6) is checked before any barcode decoding in readLabel', () => {
  assert.ok(at('25e6') > -1 && at('decodeImageBarcode(') > -1, 'cap and decode call must both be in readLabel');
  assert.ok(at('25e6') < at('decodeImageBarcode('));
});
test('6. [static] readLabel starts barcode decoding before it awaits OCR, and OCR (readImageText) is still called', () => {
  assert.ok(at('decodeImageBarcode(') > -1);
  assert.ok(at('readImageText(') > -1, 'OCR must still run');
  assert.ok(at('decodeImageBarcode(') < at('readImageText('));
});
test('7. [static] the barcode decode and the lookup are not awaited ahead of OCR (they must not block it)', () => {
  const ocr = at('readImageText(');
  assert.ok(at('decodeImageBarcode(') > -1, 'decode call must exist for this check to mean anything');
  const before = body.slice(0, ocr);
  assert.doesNotMatch(before, /await\s+(decodeImageBarcode|searchAll)\b/, 'an await on decode/search before OCR would delay the label reading');
  assert.doesNotMatch(before, /await\s+Promise\.all/, 'Promise.all would wait for the barcode before OCR finishes');
});
test('8. [static] the lookup uses searchAll(code, ...) with the same source flags as the Search tab', () => {
  assert.match(body, /searchAll\(\s*\w+\s*,\s*\{[^}]*useUSDA\s*:\s*state\.useUSDA[^}]*useOFF\s*:\s*state\.useOFF[^}]*apiKey\s*:\s*state\.apiKey/);
});
test('9. [static] barcodeOffer is applied to the search results', () => {
  assert.match(body, /barcodeOffer\(/);
});
test('10. [static] a "Use this product" button exists in custom-food.js', () => {
  assert.match(cf, /Use this product/);
});
test('11. [static] offer text (name/brand) is passed through esc() before innerHTML', () => {
  assert.match(body, /esc\(\s*[\w.]*\.name\b/, 'esc(offer.name ...)');
  assert.match(body, /esc\(\s*[\w.]*\.brand\b/, 'esc(offer.brand ...) (brand must be escaped too)');
  assert.doesNotMatch(body, /\$\{\s*[\w.]*\.(name|brand)\s*\}/, 'a raw ${x.name} / ${x.brand} interpolation without esc');
});
test('12. [static] the #cBar field is set only when empty and not user-typed', () => {
  const i = at('#cBar');
  assert.ok(i > -1, '#cBar must be referenced in readLabel');
  const win = body.slice(Math.max(0, i - 250), i + 350);
  assert.match(win, /dataset\.user/, 'checks data-user');
  assert.match(win, /\.value\s*(===|==)\s*''|!\s*[\w$.()'#]*\.value\b|\.value\.trim\(\)\s*(===|==)\s*''|\.value\.length\s*===?\s*0/, 'checks that the value is empty');
});
test('13. [static] the #cBar input is marked user-typed when the user types in it', () => {
  assert.match(cf, /#cBar'\)\s*\.addEventListener\(\s*'input'[^\n]*dataset\.user|\['#cBar'[^\]]*\][^\n]*dataset\.user|#cBar[^\n]*dataset\.user\s*=\s*'1'/, 'typing in #cBar must set data-user');
});
test('14. [static] the barcode part never writes to the name/number fields (#cName, #cSize, #cK, #cP, #cC, #cF) after the lookup', () => {
  const s = at('searchAll(');
  assert.ok(s > -1);
  const afterSearch = body.slice(s, body.indexOf('readImageText(') > s ? body.indexOf('readImageText(') : s + 1200);
  assert.doesNotMatch(afterSearch, /#c(Name|Size|K|P|C|F)['"`]\)\s*\.value\s*=/);
});
test('15. [static] the stale-run guard ocrRun is consulted after the lookup resolves', () => {
  const s = at('searchAll(');
  assert.ok(s > -1);
  assert.match(body.slice(s), /ocrRun/, 'ocrRun must be checked after searchAll');
  const guards = body.match(/run\s*(!==|===)\s*ocrRun/g) || [];
  assert.ok(guards.length >= 3, `expected existing guards plus new ones for the lookup, found ${guards.length}`);
});
test('16. [static] the lookup failure is caught (no unhandled rejection) and nothing alarming is shown', () => {
  const s = at('searchAll(');
  assert.ok(s > -1);
  assert.match(body.slice(Math.max(0, s - 300), s + 900), /catch\b/, 'try/catch or .catch around the lookup');
});
test('17. [static] "Use this product" leads to the Search tab with the code (add.barcode / tab switch wired in add-food.js or ctx.js)', () => {
  const af = rd('js/ui/add-food.js'), ctx = rd('js/ui/ctx.js');
  assert.ok(/#?(tab|Tab|search)/i.test(cf + af + ctx));
  assert.match(cf, /Use this product[\s\S]{0,1500}?(add\.|ctx|switchTab|showTab|setTab|runSearch|search)/i, 'the Use handler must reference the search/tab hand-off');
});
test('18. [static] domain/barcode.js is pure (imports only core/domain, no DOM/storage/network globals) and is in the service worker shell; CACHE bumped past v37', () => {
  const d = rd('js/domain/barcode.js');
  for (const m of d.matchAll(/from\s*'([^']+)'/g)) assert.match(m[1], /^(\.\/|\.\.\/core\/)/, `domain import ${m[1]}`);
  assert.doesNotMatch(d, /\b(document|window|localStorage|fetch|navigator)\b/);
  const sw = rd('sw.js');
  assert.match(sw, /'js\/domain\/barcode\.js'/);
  const v = sw.match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(v && Number(v[1]) >= 38, `CACHE must be bumped from v37, got ${v && v[1]}`);
});
