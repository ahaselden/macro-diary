// Pure formatting helpers (no DOM, no storage, no global state). Safe to import from domain/.
import { OZ } from './constants.js';

/** Escape text for insertion into HTML. Use on EVERYTHING that came from a database, file or the user. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const rd = n => Math.round(n || 0);
export const r1 = n => Math.round((n || 0) * 10) / 10;
export const r2 = n => Math.round((n || 0) * 100) / 100;

/** Weight as text in the user's chosen unit ('g' or 'oz'). */
export const fmtW = (g, unit) => unit === 'oz' ? `${r1(g / OZ)} oz` : `${rd(g)} g`;

/** How an entry's amount is shown: "1.5 cup (366 g)" or just "250 g". */
export const amtLabel = (e, unit) => e.disp ? `${e.disp} (${fmtW(e.grams, unit)})` : fmtW(e.grams, unit);
