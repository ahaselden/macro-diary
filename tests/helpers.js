// Shared test helpers: load golden/fixture JSON captured from the ORIGINAL single-file app.
import { readFileSync } from 'node:fs';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
export const golden = name => load(`./golden/${name}.json`);
export const fixture = name => load(`./fixtures/${name}.json`);
export const clone = o => JSON.parse(JSON.stringify(o));
/** The golden files store `undefined` inputs as this marker (JSON can't hold undefined). */
export const unmark = v => (v === '__undef__' ? undefined : v);
