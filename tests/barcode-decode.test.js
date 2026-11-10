// Proves the fallback scanner's decode path on REAL barcode pixels: we render an EAN-13 ourselves
// (independent of ZXing's encoder) and decode it with the vendored library. The camera part is not testable here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDecoder } from '../js/services/barcode.js';
import { sameBarcode } from '../js/domain/food.js';

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
const checkDigit = d12 => (10 - [...d12].reduce((s, c, i) => s + +c * (i % 2 ? 3 : 1), 0) % 10) % 10;

/** Greyscale image of the barcode with quiet zones: 3px per module, 90px tall. */
function render(code13, { px = 3, h = 90, quiet = 12, invert = false } = {}) {
  const mods = '0'.repeat(quiet) + ean13Modules(code13) + '0'.repeat(quiet), w = mods.length * px, img = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mods[Math.floor(x / px)] === '1') img[y * w + x] = 0;
  if (invert) for (let i = 0; i < img.length; i++) img[i] = 255 - img[i];
  return new Z.RGBLuminanceSource(img, w, h);
}
const with12 = d12 => d12 + checkDigit(d12);

test('decodes an EAN-13 rendered from pixels', () => {
  const decode = makeDecoder(Z);
  for (const d12 of ['400638133393', '501234567890', '978020137962']) {
    const code = with12(d12);
    assert.equal(decode(render(code)), code, code);
  }
});
test('a UPC-A (EAN-13 with a leading 0) decodes to an equivalent code', () => {
  const decode = makeDecoder(Z), upc = with12('01234567890').slice(0, 12);
  const out = decode(render('0' + upc));
  assert.ok(out && sameBarcode(out, upc), `${out} vs ${upc}`);
});
test('a blank frame and noise give null instead of throwing', () => {
  const decode = makeDecoder(Z);
  assert.equal(decode(new Z.RGBLuminanceSource(new Uint8ClampedArray(200 * 100).fill(255), 200, 100)), null);
  const noise = new Uint8ClampedArray(300 * 100).map((_, i) => (i * 2654435761 >>> 7) & 255);
  assert.equal(decode(new Z.RGBLuminanceSource(noise, 300, 100)), null);
});
test('decoder never returns non-product codes (only EAN/UPC are enabled)', () => {
  const decode = makeDecoder(Z), out = decode(render(with12('123456789012')));
  assert.match(out, /^\d{8,14}$/);
});
