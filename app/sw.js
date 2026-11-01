/* Offline mode: serve the app from cache when there is no signal, refresh the cache when there is.
 * Firestore traffic is not touched here; its own offline cache handles your data. */
const CACHE = "cut-tracker-v2";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./cloud-config.js",
  "./vendor/firebase-10.14.1/firebase-app-compat.js", "./vendor/firebase-10.14.1/firebase-auth-compat.js", "./vendor/firebase-10.14.1/firebase-firestore-compat.js"];
const CDN = ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://www.gstatic.com/firebasejs/"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;
  const same = new URL(url).origin === self.location.origin;
  if (!same && !CDN.some(p => url.startsWith(p))) return;
  if (/\.mp4(\?|$)/i.test(url)) return; // demo clips use range requests; the browser or WebView handles them
  // Stale-while-revalidate: answer from cache at once, update it in the background.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: same });
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    if (r) return r;
    if (req.mode === "navigate") return (await c.match("./index.html")) || Response.error();
    return Response.error();
  }));
});
