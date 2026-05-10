/* HVC Scoring — service worker */
/* eslint-disable no-restricted-globals */

const CACHE = "hvc-scoring-v2";

self.addEventListener("install", () => {
  // Skip the waiting state so a fresh SW takes over straight away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Drop any old version caches.
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs go straight to network

  const url = new URL(request.url);

  // Skip Supabase + cross-origin requests (let the browser handle them).
  if (url.origin !== self.location.origin) return;

  // Skip the Server Action / RSC payloads — those are dynamic and the
  // app already retries them via the offline queue.
  if (url.pathname.startsWith("/_next/data/")) return;
  if (url.searchParams.has("_rsc")) return;

  // Treat the navigation HTML as network-first, everything else as
  // stale-while-revalidate (assets rarely change once hashed).
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      "<h1>Offline</h1><p>This page hasn't been cached yet. Connect to the internet to load it.</p>",
      { headers: { "content-type": "text/html" }, status: 503 },
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  return cached ?? (await fetchPromise) ?? new Response("Offline", { status: 503 });
}

// Allow the page to nudge the SW to skip waiting (e.g. after deploy).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ---------------------------------------------------------------------
// Push notifications. The server (web-push) sends a JSON payload with
// { title, body, url, tag? }. Tag de-duplicates: newer pushes with the
// same tag replace the old notification (e.g. striker hits 50 then 100,
// the second notification supersedes the first).
// ---------------------------------------------------------------------
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "HVC Cricket", body: event.data.text() };
  }
  const { title = "HVC Cricket", body = "", url = "/", tag } = data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon1",
      badge: "/icon",
      data: { url },
      tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Re-focus an existing tab that's already on this URL.
      for (const c of list) {
        try {
          const u = new URL(c.url);
          if (u.pathname === url || c.url.endsWith(url)) {
            if ("focus" in c) return c.focus();
          }
        } catch {
          /* ignore */
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
