/* MaintainOS service worker.
   Static icons, brand art, and the offline page only.
   Document navigations and API responses are never written to Cache Storage,
   so one person's signed-in shell cannot be replayed for another session. */
const CACHE = 'maintainos-static-v11'

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
      // First install only — later updates wait for SwUpdateBanner → SKIP_WAITING.
      if (!self.registration.active) {
        await self.skipWaiting()
      }
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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

/** Web Push → OS notification (Ops desk + technician assign). */
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data = {
        title: 'MaintainOS',
        body: 'יש עדכון חדש',
        url: '/ops',
        tag: 'maintainos',
      }
      try {
        if (event.data) {
          const parsed = event.data.json()
          if (parsed && typeof parsed === 'object') {
            data = {
              title:
                typeof parsed.title === 'string' && parsed.title.trim()
                  ? parsed.title.trim()
                  : data.title,
              body:
                typeof parsed.body === 'string' && parsed.body.trim()
                  ? parsed.body.trim()
                  : data.body,
              url:
                typeof parsed.url === 'string' && parsed.url.trim()
                  ? parsed.url.trim()
                  : data.url,
              tag:
                typeof parsed.tag === 'string' && parsed.tag.trim()
                  ? parsed.tag.trim()
                  : data.tag,
            }
          }
        }
      } catch {
        try {
          const text = event.data && event.data.text ? event.data.text() : ''
          if (text) data.body = text
        } catch {
          /* keep defaults */
        }
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        data: { url: data.url },
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-32.png',
      })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/ops'
  const targetUrl = new URL(raw, self.location.origin).href
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clientsList) {
        if ('focus' in client) {
          try {
            const clientUrl = new URL(client.url)
            if (clientUrl.origin === self.location.origin) {
              await client.focus()
              if ('navigate' in client && typeof client.navigate === 'function') {
                await client.navigate(targetUrl)
              }
              return
            }
          } catch {
            /* try next client */
          }
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl)
      }
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
