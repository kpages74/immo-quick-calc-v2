// Service Worker der Immo Quick-Calc 2.0: Offline-Nutzung. Bei jeder Änderung der Dateien CACHE_NAME erhöhen,
// damit alte Caches entfernt und die neuen Dateien geladen werden.
const CACHE_NAME = 'iqc2-v6';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/logo.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/calc.js',
  './js/fields.js',
  './js/format.js',
  './js/model.js',
  './js/session.js',
  './js/store.js',
  './js/present.js',
  './js/quickie.js',
  './js/expose.js',
  './js/defaults.js',
  './js/library.js',
  './js/backup.js',
  './js/share.js',
  './js/pricelist.js',
  './js/pdf.js',
  './js/ui/app.js',
  './js/ui/controls.js',
  './js/ui/scroll.js',
  './js/ui/dialogs.js',
  './js/ui/files.js',
  './js/ui/objects.js',
  './js/ui/settings.js',
  './js/ui/actions.js',
  './js/ui/pricebox.js',
  './js/ui/quickie.js',
  './js/ui/pdfreader.js',
  './js/vendor/pdf.min.js',
  './js/vendor/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Nur eigene Caches (Präfix iqc2-) entfernen, die nicht der aktuelle sind.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('iqc2-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Netzwerk zuerst (Aktualität), bei Fehler der Cache (Offline).
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
