// Spec: docs/specs/import-dev-tools.md (Part B). Corpus tooling. Everything here is invented text on reserved domains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { siteSlug, buildFixture, expectedFor, checkSite, runCorpus } from '../scripts/lib/site-corpus.mjs';
import { importFromJsonLd } from '../js/domain/recipe-import.js';

const ROOT = new URL('..', import.meta.url);
const rootPath = p => new URL(p, ROOT);
const rootDir = rootPath('.').pathname.replace(/^\/([A-Za-z]:)/, '$1');

const NODE = { '@type': 'Recipe', name: 'Synthetic Toast', recipeIngredient: ['2 slices bread', '1 tbsp butter'], recipeInstructions: ['Toast the bread.', 'Butter it.'], recipeYield: '2', totalTime: 'PT5M' };
// hand-computed from the node above
const EXPECTED = { name: 'Synthetic Toast', description: '', servings: 2, totalTime: 5, tags: [], steps: ['Toast the bread.', 'Butter it.'], ingredients: ['2 slices bread', '1 tbsp butter'], warnings: [] };
const FIXTURE = { sourceUrl: 'https://toast.example.test/synthetic-toast', fetchedAt: '2026-01-01T00:00:00.000Z', node: NODE };

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'corpus-test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const put = (dir, name, v) => writeFile(join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));

test('18 siteSlug: charset, length, never empty, stable, host and last segment kept', () => {
  const s = siteSlug('https://www.Example.com/Recipes/Lentil-Soup/');
  assert.match(s, /^[a-z0-9-]+$/);
  assert.ok(s.length > 0 && s.length <= 60);
  assert.ok(s.includes('example'), s);
  assert.ok(s.includes('lentil-soup'), s);
  assert.equal(siteSlug('https://www.Example.com/Recipes/Lentil-Soup/'), s);
  assert.notEqual(siteSlug('https://a.example.com/x'), siteSlug('https://b.example.com/x'));
  assert.match(siteSlug('https://example.com/'), /^[a-z0-9-]+$/);
  assert.ok(siteSlug('https://example.com/').length > 0);
});

test('19 siteSlug hostile input stays a safe, non-empty name', () => {
  assert.equal(siteSlug('../../etc/passwd'), 'site');
  assert.equal(siteSlug(''), 'site');
  for (const v of [undefined, null, 42, {}, [], true, '   ', 'garbage']) assert.equal(siteSlug(v), 'site', String(v));
  const hostile = ['..\\..\\windows\\system32', 'https://example.com/../../etc/passwd', 'https://example.com/%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'https://example.com/a/b/..%5c..%5cx',
    'https://exämple.com/café', 'https://例え.jp/レシピ', 'https://example.com/' + 'x'.repeat(500), 'https://' + 'a'.repeat(200) + '.com/y', 'https://example.com/?q=../../x#../y',
    'https://example.com/CON', 'https://example.com/a b c', 'file:///etc/passwd', 'https://example.com/\u0000nul', 'https://example.com/' + 'ü'.repeat(100)];
  for (const u of hostile) {
    const s = siteSlug(u);
    assert.match(s, /^[a-z0-9-]+$/, u);
    assert.ok(s.length >= 1 && s.length <= 60, `${u} -> ${s}`);
    assert.ok(!s.includes('..') && !/[\\/]/.test(s), u);
    assert.equal(siteSlug(u), s, 'stable');
  }
});

test('20 buildFixture takes the first Recipe, records url and time, null when none, JSON-safe', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'WebSite', name: 'x' })}</script>
    <script type="application/ld+json">${JSON.stringify(NODE)}</script>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Second' })}</script></head></html>`;
  const f = buildFixture('https://toast.example.test/synthetic-toast', html, Date.UTC(2026, 0, 1));
  assert.equal(f.sourceUrl, 'https://toast.example.test/synthetic-toast');
  assert.ok(f.fetchedAt === Date.UTC(2026, 0, 1) || f.fetchedAt === '2026-01-01T00:00:00.000Z', String(f.fetchedAt));
  assert.deepEqual(f.node, NODE);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
  const none = buildFixture('https://toast.example.test/x', '<html><p>no recipe</p></html>', 0);
  assert.equal(none.node, null);
  assert.equal(buildFixture('https://toast.example.test/x', '', 0).node, null);
  assert.equal(buildFixture('https://toast.example.test/x', null, 0).node, null);
});

test('21 expectedFor is the importFromJsonLd result', () => {
  assert.deepEqual(expectedFor(NODE), importFromJsonLd(NODE));
  assert.deepEqual(expectedFor(NODE), EXPECTED);
  assert.deepEqual(expectedFor(null), importFromJsonLd(null));
});

test('22 checkSite passes on a hand-computed expectation and names differing fields', () => {
  const good = checkSite(FIXTURE, EXPECTED);
  assert.equal(good.ok, true);
  assert.deepEqual(good.diffs, []);
  const bad = checkSite(FIXTURE, { ...EXPECTED, name: 'Something else', servings: 9 });
  assert.equal(bad.ok, false);
  assert.ok(bad.diffs.length >= 2);
  assert.ok(bad.diffs.every(d => typeof d === 'string' && d.length > 0));
  assert.ok(bad.diffs.some(d => d.includes('name')));
  assert.ok(bad.diffs.some(d => d.includes('servings')));
  const arr = checkSite(FIXTURE, { ...EXPECTED, ingredients: ['2 slices bread'] });
  assert.equal(arr.ok, false);
  assert.ok(arr.diffs.some(d => d.includes('ingredients')));
  assert.equal(checkSite(FIXTURE, null).ok, false);
  assert.equal(checkSite({ ...FIXTURE, node: null }, EXPECTED).ok, false);
});

test('23 runCorpus counts a pass and a named field difference', () => withDir(async dir => {
  await put(dir, 'good.json', FIXTURE); await put(dir, 'good.expected.json', EXPECTED);
  await put(dir, 'drift.json', FIXTURE); await put(dir, 'drift.expected.json', { ...EXPECTED, totalTime: 99 });
  const r = await runCorpus(dir, { readdir, readFile: (await import('node:fs/promises')).readFile });
  assert.equal(r.total, 2);
  assert.equal(r.passed, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, 'drift');
  assert.ok(r.failed[0].diffs.some(d => d.includes('totalTime')));
  assert.ok(Array.isArray(r.skipped));
  // default fsApi also works
  const r2 = await runCorpus(dir);
  assert.equal(r2.total, 2);
}));

test('24 runCorpus: missing expected file and invalid JSON are failures, not crashes', () => withDir(async dir => {
  await put(dir, 'noexpected.json', FIXTURE);
  await put(dir, 'badfixture.json', '{ not json'); await put(dir, 'badfixture.expected.json', EXPECTED);
  await put(dir, 'badexpected.json', FIXTURE); await put(dir, 'badexpected.expected.json', '][');
  await put(dir, 'ok.json', FIXTURE); await put(dir, 'ok.expected.json', EXPECTED);
  const r = await runCorpus(dir);
  assert.equal(r.total, 4);
  assert.equal(r.passed, 1);
  assert.deepEqual(r.failed.map(f => f.name).sort(), ['badexpected', 'badfixture', 'noexpected']);
  for (const f of r.failed) assert.ok(Array.isArray(f.diffs) && f.diffs.length > 0 && f.diffs.every(d => typeof d === 'string'));
}));

test('25 runCorpus: empty and missing directories give total 0 and no error', () => withDir(async dir => {
  const empty = await runCorpus(dir);
  assert.equal(empty.total, 0); assert.equal(empty.passed, 0); assert.deepEqual(empty.failed, []);
  const missing = await runCorpus(join(dir, 'does', 'not', 'exist'));
  assert.equal(missing.total, 0); assert.deepEqual(missing.failed, []);
  await put(dir, 'README.txt', 'hello'); await put(dir, 'x.expected.json', EXPECTED);
  const other = await runCorpus(dir);
  assert.equal(other.total, 0);
}));

test('26 tests/local-sites/ is git-ignored and nothing in it is tracked', t => {
  const gi = readFileSync(rootPath('.gitignore'), 'utf8');
  assert.ok(/^\/?tests\/local-sites\/?\s*$/m.test(gi), '.gitignore lists tests/local-sites/');
  let git = true;
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { git = false; }
  if (!git) { t.diagnostic('git unavailable: skipped the git assertions'); return; }
  const opts = { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let inRepo = true;
  try { execFileSync('git', ['rev-parse', '--git-dir'], opts); } catch { inRepo = false; }
  if (!inRepo) { t.diagnostic('not a git checkout: skipped'); return; }
  assert.equal(execFileSync('git', ['ls-files', 'tests/local-sites'], opts).trim(), '');
  const r = spawnSync('git', ['check-ignore', '-q', 'tests/local-sites/anything.json'], opts);
  assert.equal(r.status, 0, 'git check-ignore says the folder is ignored');
});

test('27 package.json scripts: test:sites and sites:add exist; npm test is unchanged', () => {
  const s = JSON.parse(readFileSync(rootPath('package.json'), 'utf8')).scripts;
  assert.equal(s['test:sites'], 'node scripts/site-corpus.mjs check');
  assert.match(s['sites:add'], /^node scripts\/site-corpus\.mjs add\b/);
  assert.equal(s.test, 'node --test "tests/**/*.test.js"');
});

function cli(args) {
  return spawnSync(process.execPath, ['scripts/site-corpus.mjs', ...args], { cwd: rootDir, encoding: 'utf8', timeout: 20000 });
}
const listLocal = () => { const d = rootPath('tests/local-sites/'); return existsSync(d) ? readdirSync(d).sort() : null; };

test('28 CLI refuses bad addresses before any network and writes nothing', () => {
  const before = listLocal();
  for (const args of [['add', 'http://localhost/x'], ['add', 'http://127.0.0.1/x'], ['add', 'http://169.254.169.254/latest'], ['add', '../../etc/passwd'], ['add', 'file:///etc/passwd'], ['add', 'ftp://example.com/x'], ['add'], ['bogus-command']]) {
    const r = cli(args);
    assert.equal(r.error, undefined, `${args.join(' ')}: ${r.error}`);
    assert.notEqual(r.status, 0, args.join(' '));
  }
  assert.deepEqual(listLocal(), before, 'no file written');
  assert.ok(!existsSync(rootPath('etc')) && !existsSync(rootPath('passwd')));
});

test('29 CLI source (static, weak): guarded, slugged, local folder only, no overwrite without --force', () => {
  const src = readFileSync(rootPath('scripts/site-corpus.mjs'), 'utf8');
  assert.ok(src.includes('local-sites'));
  assert.ok(src.includes('checkUrl'));
  assert.ok(src.includes('siteSlug'));
  assert.ok(src.includes('--force'));
  assert.ok(/\bwx\b|existsSync|access\(|stat\(|EEXIST/.test(src), 'has an exists/exclusive-write guard');
  // the file name must not be built straight from argv
  assert.ok(!/join\([^)]*argv/.test(src) && !/writeFile\w*\(\s*(?:process\.)?argv/.test(src));
  assert.ok(!/join\([^)]*(?:\burl\b|\bname\b)\s*[,)]/.test(src.replace(/siteSlug\([^)]*\)/g, 'SLUG')), 'raw url/name never joined into a path');
});

test('30 committed fixtures are synthetic (json only, reserved hosts) and pass runCorpus end to end', async () => {
  const dir = rootPath('tests/fixtures/site-corpus/');
  const files = readdirSync(dir);
  assert.ok(files.length >= 2);
  for (const f of files) {
    assert.ok(f.endsWith('.json'), f);
    const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    if (!f.endsWith('.expected.json')) {
      const host = new URL(j.sourceUrl).hostname;
      assert.ok(/(^|\.)example\.(com|org|net)$|\.test$|\.invalid$|\.example$/.test(host), `${f}: ${host} is not a reserved domain`);
    }
  }
  const r = await runCorpus(rootDir + '/tests/fixtures/site-corpus');
  assert.ok(r.total >= 1);
  assert.deepEqual(r.failed, []);
  assert.equal(r.passed, r.total);
});
