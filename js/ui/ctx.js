// UI-only shared state that is NOT saved (resets on reload).
import { fmt } from '../core/dates.js';

/** The diary screen: which day ('YYYY-MM-DD') is being shown. */
export const view = { day: fmt(new Date()) };

/** The add/edit-food dialog: meal being added to, active tab, last search text and results. */
export const add = { meal: 'Breakfast', edit: null, tab: 'search', results: [], q: '', barcode: '', offer: '' };
