// Keeps Radius usable with no signal, like on a Metro platform. The app shell is
// network-first, so updates show up straight away, with the cache as a fallback. Map
// tiles are cached as they're viewed, so the most recent route's map still draws.
// API calls always go to the network; the page keeps the last result itself.
const SHELL = "radius-shell-v1";
const TILES = "radius-tiles-v1";
const MAX_TILES = 400; // roughly a few routes' worth across zoom levels
const SHELL_URLS = [
  "/",
  "/public/app.js",
  "/public/style.css",
  "/public/manifest.webmanifest",
  "/public/icons/icon.svg",
  "/public/icons/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => cache.delete(k)));
}

// Cache first. Hits are re-stored so they count as recent and survive trimming.
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) {
    cache.delete(req).then(() => cache.put(req, hit.clone()));
    return hit;
  }
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).then(() => trimTiles(cache));
  return res;
}

async function networkFirst(req, key = req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "tile.openstreetmap.org") return e.respondWith(tile(req));
  if (url.hostname === "unpkg.com") return e.respondWith(cacheFirst(req));
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Every page is the same shell (shared links just add a query string), so store it as "/".
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, "/"));
  if (url.pathname.startsWith("/public/")) return e.respondWith(networkFirst(req));
});
