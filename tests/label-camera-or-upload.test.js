// Spec: docs/specs/label-camera-or-upload.md
// WARNING: these are STATIC TEXT assertions over shipped files. They prove the
// markup/ids/version are present, NOT that the camera opens, buttons disable, etc.
// Behaviour is covered by the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? (d.name === 'vendor' ? [] : walk(join(dir, d.name))) : [join(dir, d.name)]);
const files = [...walk(join(root, 'js')), ...walk(join(root, 'css')), join(root, 'index.html')];
const sources = files.map(f => [f, readFileSync(f, 'utf8')]);
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

// All opening tags (any quote style, any attribute order) that carry id="<id>".
function tagsWithId(id) {
  const out = [];
  for (const [f, text] of sources) {
    for (const m of text.matchAll(/<[a-zA-Z][^<>]*>/g)) {
      if (new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(m[0])) out.push({ file: f, tag: m[0] });
    }
  }
  return out;
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`)); return m ? m[1] : null; };
const hasAttr = (tag, name) => new RegExp(`\\s${name}(\\s|=|/?>)`, 'i').test(tag);

test('1. camera input #cFileCam exists once, is a file input accepting images, with capture="environment"', () => {
  const t = tagsWithId('cFileCam');
  assert.equal(t.length, 1, 'expected exactly one element with id cFileCam');
  assert.match(t[0].tag, /^<input\b/i);
  assert.equal(attr(t[0].tag, 'type'), 'file');
  assert.equal(attr(t[0].tag, 'accept'), 'image/*');
  assert.equal(attr(t[0].tag, 'capture'), 'environment');
});

test('2. gallery input #cFile exists once, accepts images, and has NO capture attribute', () => {
  const t = tagsWithId('cFile');
  assert.equal(t.length, 1, 'expected exactly one element with id cFile');
  assert.match(t[0].tag, /^<input\b/i);
  assert.equal(attr(t[0].tag, 'type'), 'file');
  assert.equal(attr(t[0].tag, 'accept'), 'image/*');
  assert.equal(hasAttr(t[0].tag, 'capture'), false, 'capture would force the camera and remove the gallery option');
});

test('3. both file inputs are hidden from view', () => {
  for (const id of ['cFileCam', 'cFile']) {
    const { tag } = tagsWithId(id)[0];
    const hidden = hasAttr(tag, 'hidden') || /display\s*:\s*none/.test(attr(tag, 'style') || '') || /\bclass\s*=\s*["'][^"']*\bhidden\b/.test(tag);
    assert.ok(hidden, `${id} should be hidden (hidden attr, display:none, or a "hidden" class): ${tag}`);
  }
});

test('4. buttons #cCam ("Take a photo") and #cPick ("Choose an image") exist once each as buttons', () => {
  for (const [id, label] of [['cCam', 'Take a photo'], ['cPick', 'Choose an image']]) {
    const t = tagsWithId(id);
    assert.equal(t.length, 1, `expected exactly one element with id ${id}`);
    assert.match(t[0].tag, /^<button\b/i);
    const text = sources.find(([f]) => f === t[0].file)[1];
    const at = text.indexOf(t[0].tag);
    const inner = text.slice(at + t[0].tag.length, text.indexOf('</button>', at));
    assert.ok(inner.includes(label), `${id} label should contain "${label}", got: ${inner}`);
  }
});

test('5. the old single button id "cLabel" is gone as an HTML element (js, css, index.html)', () => {
  // Only checks for an element id; a leftover mention in a comment or JS variable is not flagged here.
  assert.deepEqual(tagsWithId('cLabel'), []);
});

test('6. old label text "Read a nutrition label from a photo" is no longer a button label', () => {
  const hits = sources.filter(([, t]) => /Read a nutrition label from a photo/.test(t)).map(([f]) => f);
  assert.deepEqual(hits, [], 'old single-button label still shipped');
});

test('7. service worker cache name is bumped to macro-diary-v18 or later', () => {
  const m = sw.match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(m, 'CACHE constant not found');
  assert.ok(Number(m[1]) >= 18, `CACHE is v${m[1]}, must be >= v18 (was v17)`);
});

test('8. the same page element ids are not duplicated across shipped files (cCam, cPick, cFile, cFileCam)', () => {
  for (const id of ['cCam', 'cPick', 'cFile', 'cFileCam']) assert.equal(tagsWithId(id).length, 1, id);
});
