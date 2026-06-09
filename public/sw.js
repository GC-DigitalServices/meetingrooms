const CACHE = "mrbs-display-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/display")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Immutable Next.js static chunks — cache-first (content-hashed, never change)
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches
        .match(request)
        .then(
          (hit) =>
            hit ??
            fetch(request).then((res) => {
              if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
              return res;
            }),
        ),
    );
    return;
  }

  // Display page — network-first, fall back to cached shell on failure
  if (request.mode === "navigate" && url.pathname === "/display") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match("/display")),
    );
    return;
  }
});
