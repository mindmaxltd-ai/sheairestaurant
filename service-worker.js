/* ═══════════════════════════════════════════════════════════════
   SAR — She AI Restaurant | Service Worker v1.0
   MindMax Enterprises | mindmaxbd.xyz
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'sar-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Core pages to cache on install
const CORE_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/dashboard.html',
  '/menu.html',
  '/order.html',
  '/track.html',
  '/profile.html',
  '/payment.html',
  '/receipt.html',
  '/manifest.json',
];

// External resources to cache
const EXTERNAL_CACHE = [
  'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Space+Mono:wght@400;700&display=swap',
];

// ── INSTALL ──
self.addEventListener('install', event => {
  console.log('[SAR SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SAR SW] Caching core files');
      return cache.addAll(CORE_CACHE).catch(err => {
        console.warn('[SAR SW] Some files failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  console.log('[SAR SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SAR SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH STRATEGY ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and Supabase API calls (always live)
  if (request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('api.anthropic.com')) return;
  if (url.hostname.includes('wa.me')) return;

  // HTML pages: Network-first with cache fallback
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // Fonts: Cache-first (long-lived)
  if (request.destination === 'font' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else: Stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// ── BACKGROUND SYNC: Order updates ──
self.addEventListener('sync', event => {
  if (event.tag === 'sar-order-sync') {
    event.waitUntil(syncPendingOrders());
  }
  if (event.tag === 'sar-metrics-sync') {
    event.waitUntil(syncPendingMetrics());
  }
});

async function syncPendingOrders() {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingOrders', 'readonly');
    const pending = await tx.objectStore('pendingOrders').getAll();
    for (const order of pending) {
      try {
        await fetch('https://xlkrggspepnysbouatec.supabase.co/rest/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhsa3JnZ3NwZXBueXNib3VhdGVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTU0OTEsImV4cCI6MjA5NTA5MTQ5MX0.dCAkAXL1EDNsxTBn8mcHcUHlXJ1xDBirwBdTgIq927U'
          },
          body: JSON.stringify(order)
        });
        console.log('[SAR SW] Synced order:', order.id);
      } catch (e) {
        console.warn('[SAR SW] Failed to sync order:', e);
      }
    }
  } catch (e) {
    console.warn('[SAR SW] DB sync error:', e);
  }
}

async function syncPendingMetrics() {
  console.log('[SAR SW] Syncing pending metrics...');
  // Similar to syncPendingOrders but for metrics table
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'SAR থেকে নতুন বার্তা',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: [
      { action: 'view', title: 'দেখুন', icon: '/icons/icon-96x96.png' },
      { action: 'dismiss', title: 'বন্ধ করুন' }
    ],
    tag: data.tag || 'sar-notification',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'SAR রেস্তোরাঁ', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── MESSAGE HANDLER (from main thread) ──
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') self.skipWaiting();
  if (event.data?.action === 'clearCache') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ done: true });
    });
  }
});

// ── HELPER: Open IndexedDB ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sar-offline', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pendingOrders'))
        db.createObjectStore('pendingOrders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pendingMetrics'))
        db.createObjectStore('pendingMetrics', { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

console.log('[SAR SW] Service Worker loaded — SAR v1.0.0 by MindMax Enterprises');
