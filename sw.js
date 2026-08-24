const VERSION = 'v11';
const CACHE_NAME = `sls-pwa-${VERSION}`;
const BASE = '/sls-pwa/';

const STATIC_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png'
];

// Store scheduled notifications
let scheduledNotifications = [];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request)
        .then((res) => {
          if (!res || res.status !== 200) return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => {
          if (e.request.headers.get('accept')?.includes('text/html')) {
            return caches.match(BASE + 'index.html');
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();

  // Handle notification scheduling from main app
  if (e.data?.type === 'SCHEDULE_NOTIFICATION') {
    const notification = e.data.notification;
    scheduledNotifications.push(notification);
    scheduleNotificationCheck(notification);
    console.log('SW: Notification scheduled:', notification.id);
  }

  // Handle notification cancellation
  if (e.data?.type === 'CANCEL_NOTIFICATION') {
    const notificationId = e.data.notificationId;
    scheduledNotifications = scheduledNotifications.filter(n => n.id !== notificationId);
    console.log('SW: Notification cancelled:', notificationId);
  }
});

// Schedule notification check for a specific notification
function scheduleNotificationCheck(notification) {
  const now = Date.now();
  const delay = notification.scheduledTime - now;

  if (delay > 0) {
    // Schedule the notification
    setTimeout(() => {
      showNotificationFromSW(notification);
    }, delay);
  } else if (delay > -30000) {
    // If it's within 30 seconds past, show immediately
    showNotificationFromSW(notification);
  }
}

// Show notification from service worker
async function showNotificationFromSW(notification) {
  if (!scheduledNotifications.find(n => n.id === notification.id)) {
    return; // Notification was cancelled
  }

  try {
    // Show the notification
    await self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      tag: 'reminder-' + notification.taskId,
      data: {
        taskId: notification.taskId,
        notificationId: notification.id
      }
    });

    // Remove from scheduled list
    scheduledNotifications = scheduledNotifications.filter(n => n.id !== notification.id);

    console.log('SW: Notification shown:', notification.id);
  } catch (error) {
    console.error('SW: Error showing notification:', error);
  }
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const taskId = event.notification.data?.taskId;
  const notificationId = event.notification.data?.notificationId;

  // Open the app and focus it
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes(BASE) && 'focus' in client) {
          return client.focus().then(() => {
            // Send message to the client about the notification click
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              taskId: taskId,
              notificationId: notificationId
            });
          });
        }
      }

      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(BASE).then((client) => {
          if (client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICKED',
              taskId: taskId,
              notificationId: notificationId
            });
          }
        });
      }
    })
  );
});

// Handle notification actions
self.addEventListener('notificationaction', (event) => {
  const action = event.action;
  const taskId = event.notification.data?.taskId;

  console.log('User clicked action:', action, 'for task:', taskId);

  // Send message to client
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({
          type: 'NOTIFICATION_ACTION',
          action: action,
          taskId: taskId
        });
      }
    })
  );
});

// Push event listener (for server-push notifications in the future)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();

    event.waitUntil(
      self.registration.showNotification(data.title || 'Solo Leveling', {
        body: data.body || 'New notification',
        icon: 'icon-192.png',
        badge: 'icon-512.png',
        data: data.data || {}
      })
    );
  }
});
