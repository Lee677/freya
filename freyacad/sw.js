/* freyacad offline.
 *
 * What this buys: the app keeps working with the network off or flaky, and the
 * ~13 MB kernel stops being at the mercy of HTTP-cache eviction. What it does
 * NOT do is make a first visit faster — that was a scheduling problem, fixed by
 * the preload hints in index.html's <head>.
 *
 * The kernel lives on a CDN, and cross-origin caching is only useful because
 * jsDelivr sends CORS headers: a cross-origin ES module import cannot work
 * without them, so the responses reaching us are real and inspectable, not
 * opaque. An opaque response would be uncacheable-in-practice here (unknown
 * status, heavy quota padding) — so if the kernel ever moves to a host that
 * does not send Access-Control-Allow-Origin, this file stops being able to do
 * its job and offline goes with it.
 *
 * Deliberately NOT aggressive: no skipWaiting, no clients.claim. This is a CAD
 * app, and swapping assets under someone with unsaved work to save them one
 * reload is a bad trade. A new version installs, waits, and takes over on the
 * next load.
 *
 * Escape hatch: load any page with ?nosw — index.html unregisters this worker
 * and drops every cache. Kept because a bad service worker is the one kind of
 * bug that can outlive the fix that removes it.
 */
const VERSION = 'v1';
const SHELL = 'freyacad-shell-' + VERSION;   // same-origin app files
const KERNEL = 'freyacad-kernel-' + VERSION; // the version-pinned CDN kernel

/* Enough to boot with the network off. Anything missing is skipped rather than
   failing the whole install — a 404 here must not cost the user offline. */
const PRECACHE = [
  './', './index.html', './three.min.js', './planegcs.js', './manifold.js', './manifold.wasm',
  './help.html', './manifest.webmanifest', './favicon.svg', './favicon.ico'
];

/* Matched by FILENAME, not by host. The kernel has lived on jsDelivr, falls
   back to unpkg, and is meant to move to our own origin later; an allowlist of
   hostnames would quietly stop caching the moment it moved, and offline would
   disappear with no failing test to notice. These two names are the contract. */
/* Which kernel files we actually hold, answerable SYNCHRONOUSLY — `fetch`
   events must decide whether to respondWith before anything can be awaited.
   null means "not looked yet". Until this is populated, and whenever we do
   hold the file, we intercept; otherwise we stay completely out of the way, so
   a first visit's kernel download goes straight to the network with no extra
   hop through this worker to fail in. */
let kernelHave = null;
(async () => {
  try {
    const c = await caches.open(KERNEL);
    kernelHave = new Set((await c.keys()).map(r => r.url));
  } catch (_) { kernelHave = new Set(); }
})();

const isKernelFile = url => {
  try { return /\/opencascade\.full\.(js|wasm)$/.test(new URL(url).pathname); }
  catch (_) { return false; }
};

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map(u => c.add(new Request(u, {cache: 'reload'}))));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, KERNEL]);
    for (const k of await caches.keys())
      if (k.startsWith('freyacad-') && !keep.has(k)) await caches.delete(k);
  })());
});

self.addEventListener('message', e => {
  const d = e.data;
  // index.html's ?nosw path asks for a clean exit before unregistering.
  if (d === 'freyacad-drop-caches')
    return e.waitUntil(caches.keys().then(ks =>
      Promise.all(ks.filter(k => k.startsWith('freyacad-')).map(k => caches.delete(k)))));
  /* The page hands us the kernel base it ACTUALLY loaded from, once the kernel
     is up. Two reasons it arrives this way instead of being a constant here:
     on a first visit this worker is not controlling the page yet, so it never
     sees the kernel fetch and offline would not work until the third visit;
     and the page may have fallen through to the backup CDN, which only it
     knows. No 'reload' on these — the browser has just downloaded them, so the
     HTTP cache normally satisfies this and it costs nothing. */
  if (d && d.type === 'freyacad-cache-kernel' && typeof d.base === 'string' &&
      /^https?:\/\//.test(d.base) && isKernelFile(d.base + 'opencascade.full.js'))
    e.waitUntil((async () => {
      const c = await caches.open(KERNEL);
      let stored = 0, err = null;
      for (const f of ['opencascade.full.js', 'opencascade.full.wasm']) {
        const req = new Request(d.base + f, {mode: 'cors', credentials: 'omit'});
        if (await c.match(req)) { stored++; if (kernelHave) kernelHave.add(req.url); continue; }
        try {
          const r = await fetch(req);
          if (r && r.ok) { await c.put(req, r); stored++; if (kernelHave) kernelHave.add(req.url); }
          else err = 'status ' + (r && r.status);
        } catch (ex) { err = String(ex && ex.message || ex); }
      }
      /* Tell the page whether offline is actually armed. Silence here used to
         mean "no idea": the kernel is fetched cross-origin and there are
         several honest ways for that to fail. */
      if (e.source) e.source.postMessage({type: 'freyacad-kernel-cached', stored: stored, error: err});
    })());
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // 206s are partial and 0s are opaque; neither is safe to replay from a cache.
  if (res && res.ok && res.status !== 206) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && res.ok && res.status !== 206) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return hit || (await net) || fetch(req);
}

/* Navigations go to the network first so a fresh deploy is picked up the moment
   it exists — index.html IS the app, so this is what keeps "stale forever" off
   the table. The cached copy is the offline fallback, nothing more. */
async function navigate(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const c = await caches.open(SHELL);
      c.put('./index.html', res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    const c = await caches.open(SHELL);
    return (await c.match(req)) || (await c.match('./index.html')) ||
      new Response('Offline, and this page was never cached.',
        {status: 503, headers: {'Content-Type': 'text/plain'}});
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                      // the shelf POSTs; never touch it
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (isKernelFile(req.url)) {
    /* Only take over once we are actually holding it. On a first visit this
       worker has nothing to offer, and interposing would mean the kernel is
       fetched from in here rather than by the page — an extra place for a
       13 MB download to fail, buying nothing. */
    if (kernelHave === null || kernelHave.has(req.url))
      return e.respondWith(cacheFirst(req, KERNEL));
    return;
  }
  if (url.origin !== self.location.origin) return;       // beacons, fonts, anything else
  if (url.pathname.startsWith('/api/')) return;          // the shelf must always be live
  if (req.mode === 'navigate') return e.respondWith(navigate(req));
  e.respondWith(staleWhileRevalidate(req));
});
