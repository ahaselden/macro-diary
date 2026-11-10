// DEVELOPMENT ONLY. Keep real-site recipe snapshots LOCALLY (tests/local-sites/ is git-ignored: third-party text is never committed) and
// check that the importer still reads them the way you reviewed.
//   node scripts/site-corpus.mjs add <url> [name] [--force]   fetch one page, save its recipe data + the parser's result for REVIEW
//   node scripts/site-corpus.mjs check                         re-run the parser on every saved site (npm run test:sites)
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkUrl } from '../supabase/functions/fetch-recipe/guard.js';
import { createFetchRecipeHandler } from './lib/fetch-recipe-core.mjs';
import { siteSlug, slugPart, buildFixture, expectedFor, runCorpus } from './lib/site-corpus.mjs';

const LOCAL_DIR = fileURLToPath(new URL('../tests/local-sites/', import.meta.url));
const say = (...a) => console.log(...a);
// Finish by setting the exit code and unwinding (process.exit() while a fetch/DNS handle is still closing crashes Node on Windows).
class Quit extends Error { constructor(code) { super('quit'); this.code = code; } }
const die = (msg, code = 1) => { console.error(msg); throw new Quit(code); };
const usage = () => die('Usage:\n  node scripts/site-corpus.mjs add <url> [name] [--force]\n  node scripts/site-corpus.mjs check', 2);

async function main() {
const [command, ...rest] = process.argv.slice(2);
const force = rest.includes('--force');
const args = rest.filter(a => a !== '--force');

if (command === 'add') {
  const [address, label] = args;
  if (!address) usage();
  const checked = checkUrl(address);                       // refuse bad addresses before any network
  if (!checked.ok) die(`Not fetched: ${checked.reason}`);
  const fetchRecipe = createFetchRecipeHandler({ resolveHost: async h => (await lookup(h, { all: true })).map(a => a.address) });
  const r = await fetchRecipe({ method: 'POST', bodyText: JSON.stringify({ url: checked.url }) });
  if (!r.json.ok) die(`Not fetched: ${r.json.error}`);
  const fixture = buildFixture(r.json.finalUrl, r.json.html, Date.now());
  if (!fixture.node) die('No schema.org Recipe data was found on that page, so there is nothing to save. (Pasting the text still works in the app.)');
  const slug = label ? (slugPart(label) || 'site') : siteSlug(r.json.finalUrl);   // the file name never comes straight from what was typed
  const flag = force ? 'w' : 'wx';                                                // 'wx' refuses to overwrite an existing file
  const fixturePath = join(LOCAL_DIR, `${slug}.json`), expectedPath = join(LOCAL_DIR, `${slug}.expected.json`);
  if (!force && (existsSync(fixturePath) || existsSync(expectedPath))) die(`tests/local-sites/${slug}.json (or its .expected.json) already exists. Use --force to replace it.`);   // never leave a half-written pair
  await mkdir(LOCAL_DIR, { recursive: true });
  try {
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', { flag });
    await writeFile(expectedPath, JSON.stringify(expectedFor(fixture.node), null, 2) + '\n', { flag });
  } catch (e) {
    if (e && e.code === 'EEXIST') die(`tests/local-sites/${slug}.json already exists. Use --force to replace it.`);
    die('Could not write the files: ' + (e && e.code ? e.code : 'error'));
  }
  const exp = expectedFor(fixture.node);
  say(`Saved tests/local-sites/${slug}.json and ${slug}.expected.json`);
  say(`  parsed: "${exp.name}", ${exp.ingredients.length} ingredient lines, ${exp.steps.length} steps, ${exp.tags.length} tags, ${exp.warnings.length} warnings`);
  say('Now REVIEW the expected file by hand (fix any value the parser got wrong, then fix the parser), and run: npm run test:sites');
  say('These files hold third-party text. They are git-ignored; never commit them.');
} else if (command === 'check') {
  const res = await runCorpus(LOCAL_DIR);
  if (res.total === 0) { say('No saved sites yet (tests/local-sites/ is empty or missing). Add one with: npm run sites:add -- <url>'); return; }
  for (const f of res.failed) { say(`FAIL ${f.name}`); for (const d of f.diffs) say(`  - ${d}`); }
  say(`${res.passed}/${res.total} sites pass`);
  if (res.failed.length) throw new Quit(1);
} else usage();
}

try { await main(); } catch (e) { if (e instanceof Quit) process.exitCode = e.code; else throw e; }
