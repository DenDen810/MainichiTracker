/* ============================================================
   MainichiTracker service worker

   The old one was network-first for the page. That means every single
   launch waits for index.html to come down the wire before anything can be
   drawn — on a slow or flaky connection that is the pause and the flash you
   see when opening the app, and offline it is worse.

   This one is cache-first with a background update: the page you already
   have is shown immediately, and a fresh copy is fetched quietly afterwards
   and used next time. So launches are instant, the app works with no signal
   at all, and you still get updates without ever pressing anything.

   The only cost is that a new build appears on the SECOND launch rather than
   the first. The build letter on the Data tab tells you which one you are
   running, which is exactly what it is for.
   ============================================================ */

const VERSION = "mainichi-v1";
const PAGE = "./index.html";

/* Everything needed to open the app with no network at all. The audio is
   deliberately NOT in here: it is many megabytes, it is not needed to use
   the app, and it caches itself on first play. */
const SHELL = [
  "./",
  "./index.html",
  "./icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => {}))   /* a missing icon must not fail the install */
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* fetch a fresh copy and put it away for next time, quietly */
function revalidate(req) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;

  /* Only GETs, and only our own origin. Anything cross-origin — the API, the
     fonts, Google's sign-in — passes straight through untouched. Intercepting
     those is how a service worker breaks audio and auth. */
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations: show what we have, update behind you. This is the change. */
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match(PAGE).then((hit) => {
        const fresh = revalidate(new Request(PAGE, { cache: "reload" }));
        return hit || fresh.then((r) => r || caches.match(PAGE)) ||
               new Response("Offline", { status: 503 });
      })
    );
    return;
  }

  /* The audio is large and never changes once written, so once it is in the
     cache it is served from there forever and never re-fetched. */
  if (url.pathname.indexOf("/sfx/") > -1) {
    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => new Response("", { status: 504 }));
      })
    );
    return;
  }

  /* Everything else of ours: cached copy first, fresh copy in the background. */
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = revalidate(req);
      return hit || fresh.then((r) => r || new Response("", { status: 504 }));
    })
  );
});

/* lets the page ask for the newest build on demand, if you ever want a button */
self.addEventListener("message", (e) => {
  if (e.data === "update") revalidate(new Request(PAGE, { cache: "reload" }));
});
