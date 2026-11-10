// The sync settings this device has right now, read fresh from its own storage key. Lets screens other than Settings (for example
// recipe import) find the project URL and public key without importing the Settings screen. Returns the stored config object
// ({ url, anonKey, session, ... }); pass it to effectiveConnection() to get the project to talk to. Never throws.
import { createSyncConfig } from './config.js';

export function readSyncConfig(storage = globalThis.localStorage) {
  try { return createSyncConfig(storage).get() || {}; } catch { return {}; }
}
