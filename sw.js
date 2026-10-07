/* ==========================================================================
   ObraStock — Service Worker
   Foco: aplicativo instalável e carregamento instantâneo do shell.
   NÃO faz fila de escrita offline (decisão de escopo: conexão boa no galpão).
   ========================================================================== */

const VERSION    = 'v2.0.1';
const SHELL      = `obrastock-shell-${VERSION}`;
const RUNTIME    = `obrastock-runtime-${VERSION}`;

/* Arquivos do "casco" do app. Caminhos relativos ao escopo do SW. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

/* --------------------------- INSTALL --------------------------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll é atômico: se 1 arquivo falhar, nada é cacheado.
    // Cacheamos individualmente para o SW não quebrar por um ícone ausente.
    await Promise.all(SHELL_ASSETS.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] não cacheado:', url); }
    }));
  })());
});

/* --------------------------- ACTIVATE --------------------------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('obrastock-') && k !== SHELL && k !== RUNTIME)
          .map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* Permite que a página peça ativação imediata da nova versão */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* --------------------------- FETCH --------------------------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Só interceptamos GET. POST/PATCH (futuro Supabase) passam direto para a rede.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear chamadas de API/autenticação — sempre dados frescos.
  if (/\/(rest|auth|realtime|functions|storage)\/v1\//.test(url.pathname) ||
      url.hostname.endsWith('.supabase.co')) {
    return; // deixa passar para a rede
  }

  /* NAVEGAÇÃO (abrir o app): rede primeiro, cache como reserva.
     Assim o usuário recebe a versão nova assim que publicamos,
     mas o app abre mesmo com rede instável. */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          // Guardar sob a URL pedida, e não sempre como './index.html':
          // senão uma visita a /login.html sobrescreve o app no cache, e
          // offline o usuário recebe a página errada.
          if (preload.ok) (await caches.open(SHELL)).put(req, preload.clone());
          return preload;
        }
        const fresh = await fetch(req);
        if (fresh && fresh.ok) (await caches.open(SHELL)).put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req, { ignoreSearch: true })
                    || await caches.match('./index.html', { ignoreSearch: true });
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>Sem conexão</title>' +
          '<body style="font-family:system-ui;padding:40px;text-align:center;color:#0f2742">' +
          '<h2>Sem conexão</h2><p>Abra o aplicativo novamente quando houver internet.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* CÓDIGO DA APLICAÇÃO (assets/js/*): rede primeiro, cache como reserva.
     Estes arquivos carregam credenciais e regras de autenticação. Se ficassem
     em cache-first, um deploy com credencial nova ou uma correção de segurança
     só chegaria ao usuário na troca de versão do service worker — o que já
     causou confusão em teste. Rede primeiro resolve, e o cache garante que o
     app continue abrindo offline. */
  if (url.origin === self.location.origin && /\/assets\/js\/.+\.js$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) (await caches.open(RUNTIME)).put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  /* MESMA ORIGEM (ícones, manifest): cache primeiro — são versionados. */
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(RUNTIME)).put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  /* CDN (Google Fonts, Font Awesome): stale-while-revalidate.
     Responde instantâneo do cache e atualiza em segundo plano.

     Estes três domínios PRECISAM estar em connect-src no _headers. O pedido
     original é de estilo/fonte, mas nós o refazemos aqui com fetch() — e
     fetch() dentro do service worker é avaliado como connect-src. Sem isso
     o navegador recusa a conexão e o site carrega sem estilo. */
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});
