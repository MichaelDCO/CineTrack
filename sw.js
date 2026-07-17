/* ============================================================
   CinéTrack — service worker
   - Coquille de l'app en cache (fonctionne hors-ligne)
   - Affiches (TVmaze / OMDb-Amazon) en cache (limité)
   - Appels API (TVmaze, OMDb) : toujours réseau (jamais mis en cache ici)
   ============================================================ */
'use strict';

const VERSION = 'cinetrack-v3';
const NETWORK_TIMEOUT_MS = 3500; // au-delà, on sert la version en cache (« lie-fi », réseau très lent)
const SHELL_CACHE = VERSION + '-shell';
const IMG_CACHE = VERSION + '-img';
const IMG_CACHE_MAX = 300;

const SHELL_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/** Garde le cache d'images sous la limite (supprime les plus anciennes entrées). */
async function trimImageCache() {
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  if (keys.length <= IMG_CACHE_MAX) return;
  for (const key of keys.slice(0, keys.length - IMG_CACHE_MAX)) {
    await cache.delete(key);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // APIs : réseau uniquement (les données doivent rester fraîches)
  if (url.hostname === 'api.tvmaze.com' || url.hostname === 'www.omdbapi.com') return;

  // Affiches : cache d'abord, réseau sinon
  const IMG_HOSTS = ['static.tvmaze.com', 'm.media-amazon.com', 'ia.media-imdb.com'];
  if (IMG_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          cache.put(req, res.clone());
          trimImageCache();
        }
        return res;
      })
    );
    return;
  }

  // Fichiers de l'app : réseau d'abord (pour recevoir les mises à jour), mais avec un
  // délai maximal — sur un réseau qui « pendouille », on sert le cache au lieu de bloquer
  // le lancement ; la réponse réseau, si elle finit par arriver, met le cache à jour.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const networkPromise = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => null);

      const winner = await Promise.race([
        networkPromise,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS)),
      ]);
      if (winner && winner !== 'timeout') return winner;

      const hit = await caches.match(req);
      if (hit) return hit;

      // rien en cache : on laisse sa chance au réseau jusqu'au bout
      const late = await networkPromise;
      if (late) return late;

      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    })());
  }
});
