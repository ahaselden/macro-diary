// The compact one-line description of the USDA key shown in Settings. PURE; never shows more than the last 4 characters.
import { cleanApiKey, isPlaceholderKey } from '../core/schema.js';

export function apiKeySummary(key) {
  if (typeof key !== 'string' || !key.trim()) return 'USDA key: not set';
  if (isPlaceholderKey(key)) return 'USDA key: using the shared demo key';
  const k = cleanApiKey(key);
  if (!k) return 'USDA key: not set';
  return k.length >= 12 ? `USDA key: set (ends …${k.slice(-4)})` : 'USDA key: set';
}
