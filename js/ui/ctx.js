// UI-only shared state that is NOT saved: which day the diary is showing.
import { fmt } from '../core/dates.js';

export const view = { day: fmt(new Date()) };
