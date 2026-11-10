// DEVELOPMENT ONLY. Regression corpus for recipe import: one snapshot per real recipe site (just the schema.org Recipe data of one
// page) and the result we expect the parser to give for it. Real snapshots hold third-party text, so they live ONLY in the
// git-ignored tests/local-sites/ folder and are never committed; the committed tests use invented recipes (tests/fixtures/site-corpus/).
// Pure apart from runCorpus's file reads (injectable). See docs/specs/import-dev-tools.md.
import * as nodeFs from 'node:fs/promises';
import { extractRecipeJsonLd, importFromJsonLd } from '../../js/domain/recipe-import.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_SLUG = 60;

/** Lowercase letters, digits and single dashes only; never contains a path separator or "..". '' when nothing usable is left. */
export function slugPart(text) {
  const s = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, MAX_SLUG).replace(/-+$/g, '');
}

/** A safe file name stem from an address: host (without www) plus the last path segment. Anything unusable gives 'site'. */
export function siteSlug(url) {
  let u;
  try { u = new URL(typeof url === 'string' ? url.trim() : ''); } catch { return 'site'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'site';
  let last = '';
  try { last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || ''); } catch { last = u.pathname.split('/').filter(Boolean).pop() || ''; }
  const slug = slugPart(`${u.hostname.replace(/^www\./, '')}-${last}`);
  return slug || 'site';
}

/** { sourceUrl, fetchedAt, node } where node is the first schema.org Recipe on the page, or null. JSON-safe. */
export function buildFixture(url, html, nowMs) {
  const nodes = extractRecipeJsonLd(html);
  const when = Number.isFinite(nowMs) ? nowMs : Date.now();
  const node = nodes.length ? JSON.parse(JSON.stringify(nodes[0])) : null;
  return { sourceUrl: String(url ?? ''), fetchedAt: new Date(when).toISOString(), node };
}

/** What the parser gives for a node today: the starting point of a reviewed expected file. */
export const expectedFor = node => JSON.parse(JSON.stringify(importFromJsonLd(node)));

const show = v => { const t = JSON.stringify(v); return t === undefined ? 'undefined' : t.length > 160 ? t.slice(0, 157) + '...' : t; };

/** Compare today's parse of fixture.node with the expected result. diffs name each differing field. */
export function checkSite(fixture, expected) {
  if (!plain(fixture) || !plain(fixture.node)) return { ok: false, diffs: ['the fixture has no recipe node'] };
  if (!plain(expected)) return { ok: false, diffs: ['the expected result is missing or not an object'] };
  const actual = importFromJsonLd(fixture.node);
  const diffs = [];
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const a = JSON.stringify(actual[key]), e = JSON.stringify(expected[key]);
    if (a !== e) diffs.push(`${key}: expected ${show(expected[key])} but got ${show(actual[key])}`);
  }
  return { ok: diffs.length === 0, diffs };
}

/** Run every <name>.json / <name>.expected.json pair in dir. A missing folder is not an error (nothing to check). */
export async function runCorpus(dir, fsApi = nodeFs) {
  const out = { total: 0, passed: 0, failed: [], skipped: [] };
  let entries;
  try { entries = await fsApi.readdir(dir); } catch { return out; }
  const names = [];
  for (const f of [...entries].sort()) {
    if (typeof f === 'string' && f.endsWith('.json') && !f.endsWith('.expected.json')) names.push(f.slice(0, -5));
    else out.skipped.push(String(f));
  }
  const read = async (path) => JSON.parse(await fsApi.readFile(path, 'utf8'));
  for (const name of names) {
    const fail = diff => out.failed.push({ name, diffs: [diff] });
    let fixture, expected;
    try { fixture = await read(`${dir}/${name}.json`); } catch { fail('the fixture file is unreadable or not valid JSON'); continue; }
    try { expected = await read(`${dir}/${name}.expected.json`); }
    catch (e) { fail(e && e.code === 'ENOENT' ? `missing ${name}.expected.json` : 'the expected file is unreadable or not valid JSON'); continue; }
    const r = checkSite(fixture, expected);
    if (r.ok) out.passed++; else out.failed.push({ name, diffs: r.diffs });
  }
  out.total = out.passed + out.failed.length;
  return out;
}
