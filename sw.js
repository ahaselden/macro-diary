// Caches the app shell so it opens offline. Food-database requests always go to the network.
// Keep SHELL in sync with the files that ship: tests/sw.test.js fails if a js/css file is missing from it.
// After changing ANY shipped file, bump CACHE so installed copies (phones) pick up the update.
const CACHE = 'macro-diary-v39';
const OCR_CACHE = 'macro-diary-ocr-v1';   // ~7 MB OCR engine, fetched on first label scan; survives CACHE bumps. Change the name if /vendor/tesseract/ is ever updated.
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'css/base.css',
  'css/components.css',
  'css/themes.css',
  'js/core/bus.js',
  'js/core/constants.js',
  'js/core/dates.js',
  'js/core/dom.js',
  'js/core/format.js',
  'js/core/schema.js',
  'js/core/store.js',
  'js/domain/backup.js',
  'js/domain/cooking.js',
  'js/domain/entries.js',
  'js/domain/food-match.js',
  'js/domain/food.js',
  'js/domain/ingredient-parse.js',
  'js/domain/ingredient-tokens.js',
  'js/domain/label-parse.js',
  'js/domain/merge.js',
  'js/domain/nutrition.js',
  'js/domain/plan.js',
  'js/domain/autoplan.js',
  'js/domain/barcode.js',
  'js/domain/recipe-import.js',
  'js/domain/recipes.js',
  'js/domain/reports.js',
  'js/domain/shopping.js',
  'js/domain/summary.js',
  'js/domain/sync-records.js',
  'js/domain/units.js',
  'js/main.js',
  'js/services/barcode.js',
  'js/services/files.js',
  'js/services/food-suggest.js',
  'js/services/foods.js',
  'js/services/http.js',
  'js/services/ocr.js',
  'js/services/off.js',
  'js/services/script.js',
  'js/services/wakelock.js',
  'js/services/recipe-fetch.js',
  'js/services/share.js',
  'js/services/sync/config.js',
  'js/services/sync/connection.js',
  'js/services/sync/defaults.js',
  'js/services/sync/engine.js',
  'js/services/sync/index.js',
  'js/services/sync/memory-adapter.js',
  'js/services/sync/setup-link.js',
  'js/services/sync/supabase-adapter.js',
  'js/services/usda.js',
  'js/ui/add-food.js',
  'js/ui/amount-picker.js',
  'js/ui/cook-view.js',
  'js/ui/ctx.js',
  'js/ui/custom-food.js',
  'js/ui/diary.js',
  'js/ui/export-view.js',
  'js/ui/plan-view.js',
  'js/ui/recipe-editor.js',
  'js/ui/recipe-view.js',
  'js/ui/recipe-import.js',
  'js/ui/recipes-view.js',
  'js/ui/restore-dialog.js',
  'js/ui/settings-view.js',
  'js/ui/share-result.js',
  'js/ui/shop-view.js',
  'js/ui/sync-view.js',
  'js/ui/tabs.js',
  'js/ui/theme.js',
  'js/vendor/zxing.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // OCR files never change for a given cache name: cache-first, so the big download happens once.
  if (url.pathname.includes('/vendor/tesseract/')) {
    e.respondWith(caches.open(OCR_CACHE).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) e.waitUntil(c.put(e.request, r.clone()).catch(() => {}));   // waitUntil: the worker must not be stopped mid-write
      return r;
    }));
    return;
  }
  // network first so updates show up, fall back to cache when offline
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
