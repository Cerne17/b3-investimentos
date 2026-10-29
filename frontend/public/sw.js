// Service worker do PWA: a interface abre mesmo sem rede (último index.html e os assets já baixados).
// Dados (/api) nunca vêm do cache: cotação velha sem aviso seria pior que a mensagem de erro.
const VERSAO = 'b3-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icone-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/assets/')) {
    // assets têm hash no nome: do cache, e só baixa o que faltar
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copia = resp.clone()
      if (resp.ok) caches.open(VERSAO).then((c) => c.put(e.request, copia))
      return resp
    })))
    return
  }
  if (e.request.mode === 'navigate') {
    // página: rede primeiro (versão nova), cache se estiver offline
    e.respondWith(fetch(e.request).then((resp) => {
      const copia = resp.clone()
      if (resp.ok) caches.open(VERSAO).then((c) => c.put('/', copia))
      return resp
    }).catch(() => caches.match('/')))
  }
})
