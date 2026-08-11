const CACHE_VERSION = "final-judo-mobile-shell-v4";
const APP_SHELL_URLS = [
  "/app",
  "/manifest.webmanifest",
  "/icons/final-judo-icon-192.png",
  "/icons/final-judo-icon-512.png",
];
const NETWORK_ONLY_NAVIGATION_PREFIXES = ["/login", "/signup", "/reset-password", "/select-role", "/invite"];

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  );
}

function isNextStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

function isNetworkOnlyNavigation(pathname) {
  return NETWORK_ONLY_NAVIGATION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) =>
        Promise.all(
          clients.map((client) => {
            const clientUrl = new URL(client.url);

            if (clientUrl.origin === self.location.origin && clientUrl.pathname.startsWith("/app")) {
              return client.navigate(client.url).catch(() => undefined);
            }

            return undefined;
          }),
        ),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "FINAL_JUDO_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  if (isNextStaticAsset(requestUrl.pathname)) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            await cache.put(request, response.clone());
          }

          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_VERSION);
          return (await cache.match(request)) ?? Response.error();
        }),
    );
    return;
  }

  if (isStaticAsset(requestUrl.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);

        if (cached) {
          return cached;
        }

        const response = await fetch(request);

        if (response.ok) {
          await cache.put(request, response.clone());
        }

        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    if (isNetworkOnlyNavigation(requestUrl.pathname)) {
      event.respondWith(fetch(request));
      return;
    }

    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_VERSION);
            await cache.put(request, response.clone());
          }

          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_VERSION);
          return (await cache.match(request)) ?? (await cache.match("/app")) ?? Response.error();
        }),
    );
  }
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "파이널 유도 공지",
    body: "새 공지가 도착했습니다.",
    url: "/app/notifications",
  };
  const payload = event.data ? event.data.json() : fallback;

  event.waitUntil(
    self.registration.showNotification(payload.title || fallback.title, {
      body: payload.body || fallback.body,
      icon: "/icons/final-judo-icon-192.png",
      badge: "/icons/final-judo-icon-192.png",
      tag: payload.tag || "final-judo-notice",
      data: {
        url: payload.url || fallback.url,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const targetUrl = new URL(event.notification.data?.url || "/app/notifications", self.location.origin).href;

  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const client = clients.find((item) => item.url === targetUrl);

        if (client) {
          return client.focus();
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
