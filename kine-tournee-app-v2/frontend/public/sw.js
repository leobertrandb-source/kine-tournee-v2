// Service Worker — Kiné Tournée PWA
const CACHE_NAME = 'kine-tournee-v1'

// Ressources à mettre en cache lors de l'installation
const PRECACHE = [
  '/',
  '/manifest.json',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // Ne pas mettre en cache les appels API ou OSRM
  if (url.pathname.startsWith('/api') || url.hostname.includes('osrm') || url.hostname.includes('supabase')) {
    return
  }

  // Stratégie Network First pour l'app shell, Cache Fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Mettre à jour le cache
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone))
        }
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
