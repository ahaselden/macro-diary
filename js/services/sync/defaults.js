// Built-in sync project, so an end user only has to sign in. Both values are PUBLIC by design (the project URL and the
// publishable/anon key ship to every browser; Row Level Security is what protects the data). Only ever put those two public
// values here, nothing private. Clearing both values (empty strings) turns the built-in project off: the app then asks users
// for their own project in Settings -> Sync, exactly as before (docs/VISION.md, docs/DECISIONS.md D25).
export const DEFAULT_SYNC = {
  url: 'https://rblowifmbeokvwengabb.supabase.co',
  anonKey: 'sb_publishable_IcIF_cSMn1hVE5Pd-Pxr7w_9135Amzx',
};
