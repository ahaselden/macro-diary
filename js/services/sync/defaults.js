// Built-in sync project, so an end user only has to sign in. Both values are PUBLIC by design (the project URL and the
// publishable/anon key ship to every browser; Row Level Security is what protects the data). Only ever put those two public
// values here, nothing private. Left empty until the owner decides to host a shared project (docs/VISION.md, docs/DECISIONS.md);
// while empty the app behaves exactly as before and users enter their own project in Settings -> Sync.
export const DEFAULT_SYNC = { url: '', anonKey: '' };
