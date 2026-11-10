/* MaintainOS service worker.
   Static icons, brand art, and the offline page only.
   Document navigations and API responses are never written to Cache Storage,
   so one person's signed-in shell cannot be replayed for another session. */
const CACHE = 'maintainos-static-v9'

const PRECACHE = [
  '/offline.html',
  '/favicon.ico',
  '/icons/icon-16.png',
  '/icons/icon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/brand/oc-mark.png',
  '/brand/oc-mark-transparent.png',
  '/manifest.webmanifest',
  '/manifest-tech.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-store' })
            if (res && res.ok && res.type === 'basic' && !res.redirected) {
              await cache.put(url, res)
            }
          } catch {
            /* A missing file must not block install. */
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

function isStaticAsset(pathname) {
  return (
    pathname === '/offline.html' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/brand/')
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  const path = url.pathname

  // Leave the worker script, API, and auth routes to the network untouched.
  if (path === '/sw.js' || path.startsWith('/api/') || path.startsWith('/auth')) {
    return
  }

  // Full page loads: network only. On failure, the static offline page.
  // The HTML response itself is not cached.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const page = await caches.match('/offline.html')
        return (
          page ||
          new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        )
      }),
    )
    return
  }

  if (!isStaticAsset(path)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        const res = await fetch(req)
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          await cache.put(req, res.clone())
        }
        return res
      } catch {
        const hit = await cache.match(req)
        if (hit) return hit
        const page = await caches.match('/offline.html')
        return (
          page ||
          new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        )
      }
    })(),
  )
})
