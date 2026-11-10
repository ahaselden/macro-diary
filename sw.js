// Caches the app shell so it opens offline. Food-database requests always go to the network.
// Keep SHELL in sync with the files that ship: tests/sw.test.js fails if a js/css file is missing from it.
// After changing ANY shipped file, bump CACHE so installed copies (phones) pick up the update.
const CACHE = 'macro-diary-v8';
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
  'js/domain/entries.js',
  'js/domain/food.js',
  'js/domain/merge.js',
  'js/domain/nutrition.js',
  'js/domain/reports.js',
  'js/domain/summary.js',
  'js/domain/units.js',
  'js/main.js',
  'js/services/barcode.js',
  'js/services/files.js',
  'js/services/foods.js',
  'js/services/http.js',
  'js/services/off.js',
  'js/services/share.js',
  'js/services/usda.js',
  'js/ui/add-food.js',
  'js/ui/amount-picker.js',
  'js/ui/ctx.js',
  'js/ui/custom-food.js',
  'js/ui/diary.js',
  'js/ui/export-view.js',
  'js/ui/restore-dialog.js',
  'js/ui/settings-view.js',
  'js/ui/share-result.js',
  'js/ui/tabs.js',
  'js/ui/theme.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first so updates show up, fall back to cache when offline
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
