// Pure backup-restore logic. No DOM, storage or globals.
import { foodKey } from './food.js';
import { mergeStates } from './merge.js';
import { migrate } from '../core/schema.js';

import { validEntry } from './entries.js';
export { validEntry };   // the rule lives in entries.js; re-exported for the restore dialog

/** Entries in the backup that this state doesn't have yet (matched by entry id): { [day]: entries[] }. Used for the preview count. */
export function newEntries(state, backup) {
  const out = {};
  for (const [day, list] of Object.entries(backup.days)) {
    if (!Array.isArray(list)) continue;
    const have = new Set((state.days[day] || []).map(e => e.id)), add = list.filter(e => validEntry(e) && !have.has(e.id));
    if (add.length) out[day] = add;
  }
  return out;
}

/**
 * "Restore → Merge": returns a NEW state with the backup merged in; the caller replace()s and saves.
 * The backup is migrated + sanitised first (it is untrusted input) and merged with the conflict-free rules in
 * merge.js, so edits and deletions recorded in the backup apply too, not just additions. Backups from before
 * timestamps existed tie with local data, and on a tie THIS device wins (`preferLocal`), exactly like the old behaviour.
 * Recent foods are a per-device convenience that sync ignores, but a restore may bring useful ones, so they are unioned.
 */
export function mergeRestore(state, backup) {
  const incoming = migrate(structuredClone(backup));
  const merged = mergeStates(state, incoming, { preferLocal: true });
  const seen = new Set((merged.recent || []).map(foodKey));
  merged.recent = [...(merged.recent || []), ...incoming.recent.filter(f => f && f.name && f.per100 && !seen.has(foodKey(f)))].slice(0, 30);
  return merged;
}
