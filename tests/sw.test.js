import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]).filter(x => x !== 'SHELL');

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
const shipped = [...walk(join(root, 'js')), ...walk(join(root, 'css'))].map(f => relative(root, f).split(sep).join('/'));

test('every js/ and css/ file that ships is in the service worker precache list', () => {
  const missing = shipped.filter(f => !shell.includes(f));
  assert.deepEqual(missing, [], `add these to SHELL in sw.js (and bump CACHE): ${missing.join(', ')}`);
});

test('every precache entry exists on disk (a 404 would make the whole install fail)', () => {
  const gone = shell.filter(f => f !== './' && !existsSync(join(root, f)));
  assert.deepEqual(gone, [], `remove from SHELL or restore: ${gone.join(', ')}`);
});

test('index.html only loads scripts/styles/icons that are precached', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#:]+\.(?:css|js|svg|png|webmanifest))"/g)].map(m => m[1]);
  assert.deepEqual(refs.filter(r => !shell.includes(r)), []);
});

test('CACHE version is set', () => assert.match(sw, /const CACHE = 'macro-diary-v\d+'/));
