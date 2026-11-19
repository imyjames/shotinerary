// Keeps Shotinerary working with no signal. When a new version is published, this file changes,
// the phone downloads the new version in the background, and the app offers "Update available".
// Your photos and data live in the phone's database, not in this cache, so updating never touches them.
const VERSION = "1580dbeea1";
const CACHE = "shotinerary-" + VERSION;
const SHELL = ["./", "index.html", "local.js", "cities.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))); });
self.addEventListener("activate", (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== location.origin) return; // maps, fonts etc. go straight to the internet
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await c.match("index.html") : null);
    if (hit) return hit;
    try { return await fetch(req); } catch { return new Response("Offline", { status: 503 }); }
  })());
});
