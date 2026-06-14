/**
 * Service worker do JuridFlow (PWA).
 *
 * Estratégia conservadora — o objetivo é "instalável + abre offline", sem
 * NUNCA prender o usuário numa versão antiga:
 *
 *  - Navegação (HTML): network-first com fallback pro index.html cacheado.
 *    Sempre busca o HTML novo (que referencia os assets com hash atuais);
 *    se offline, serve a casca pra abrir o app.
 *  - Assets com hash (/assets/*): cache-first — o nome muda quando o
 *    conteúdo muda, então é seguro servir do cache (rápido + offline).
 *  - Ícones/manifest: stale-while-revalidate.
 *  - /api, /uploads, /events (SSE): NUNCA passam pelo cache — sempre rede.
 *
 * Versionar CACHE invalida tudo ao publicar. skipWaiting + clients.claim
 * fazem a versão nova assumir na hora.
 */
const VERSION = "v2";
const CACHE = `juridflow-${VERSION}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Permite a página forçar a ativação imediata da versão nova.
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

// ─── Web Push ─────────────────────────────────────────────────────────────
// Mostra a notificação (app fechado/segundo plano). Se já houver uma janela
// VISÍVEL (usuário olhando), não duplica — o toast in-app (SSE) já cobre o
// primeiro plano. `forcar` (teste) ignora essa supressão.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "JuridFlow", body: event.data ? event.data.text() : "" };
  }
  const titulo = data.title || "JuridFlow";
  const url = data.url || "/atendimento";
  const forcar = !!(data.dados && data.dados.forcar);

  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const emFoco = clientes.some((c) => c.focused === true);
      if (emFoco && !forcar) return;

      await self.registration.showNotification(titulo, {
        body: data.body || "",
        icon: "/pwa-192.png",
        badge: "/pwa-192.png",
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url, ...(data.dados || {}) },
      });
    })(),
  );
});

// Toque na notificação: foca uma janela aberta (e navega) ou abre uma nova.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/atendimento";
  event.waitUntil(
    (async () => {
      const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientes) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) c.navigate(url).catch(() => {});
          else c.postMessage({ type: "NAVEGAR", url });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});

function ehAsterHash(url) {
  return url.pathname.startsWith("/assets/");
}
function ehIconeOuManifest(url) {
  return /\.(png|svg|webmanifest|ico)$/.test(url.pathname);
}
function naoCachear(url) {
  return (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/uploads") ||
    url.pathname.startsWith("/media") ||
    url.pathname.startsWith("/events") ||
    url.pathname === "/sw.js"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // só same-origin
  if (naoCachear(url)) return; // deixa ir direto pra rede (auth/dados/SSE)

  // Navegação (abrir/recarregar página): network-first → casca offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Assets com hash: cache-first (imutáveis).
  if (ehAsterHash(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) => hit || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }),
      ),
    );
    return;
  }

  // Ícones/manifest: stale-while-revalidate.
  if (ehIconeOuManifest(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const rede = fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }).catch(() => hit);
        return hit || rede;
      }),
    );
  }
});
