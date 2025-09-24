// =============================================================================
// FIXED SERVICE WORKER - WORKING ON LIVE SITES
// =============================================================================

const CACHE_NAME = 'faceattend-v3.0.1'; // Increment this for each update
const DATA_CACHE_NAME = 'faceattend-data-v1.0.0'; // User data cache (never cleared)

// Cache essential resources including the main page
const urlsToCache = [
  '/',
  '/manifest.json',
  '/facecam.jpeg',
  // AI Models - cache for offline functionality
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard2'
];

// Install event - cache essential resources
self.addEventListener('install', (event) => {
  console.log('FaceAttend SW: Installing');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('FaceAttend SW: Caching resources');
        return cache.addAll(urlsToCache.map(url => {
          // Don't add cache busting to models during install
          return new Request(url, {
            mode: url.startsWith('http') ? 'cors' : 'same-origin',
            credentials: 'omit'
          });
        }));
      })
      .catch((error) => {
        console.error('FaceAttend SW: Cache failed', error);
        return Promise.resolve();
      })
  );
  
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('FaceAttend SW: Activating');
  
  event.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
              console.log('FaceAttend SW: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      self.clients.claim()
    ])
  );
});

// Fetch event - simplified and working approach
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  const url = event.request.url;
  
  // AI model files - cache first for performance
  if (url.includes('face-api') || url.includes('vladmandic')) {
    event.respondWith(handleModelRequest(event.request));
  }
  // External CDN resources - cache first
  else if (url.includes('cdn.tailwindcss.com') || 
           url.includes('cdnjs.cloudflare.com') ||
           url.includes('cdn.jsdelivr.net')) {
    event.respondWith(handleCDNRequest(event.request));
  }
  // Main app files - network first with fallback
  else if (url.includes(self.location.origin)) {
    event.respondWith(handleAppRequest(event.request));
  }
  // Everything else - just fetch normally
  else {
    event.respondWith(fetch(event.request));
  }
});

// Handle AI model requests - cache first for performance
async function handleModelRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('FaceAttend SW: Serving model from cache');
      return cachedResponse;
    }

    console.log('FaceAttend SW: Fetching model from network');
    const networkResponse = await fetch(request, {
      mode: 'cors',
      credentials: 'omit'
    });

    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(e => 
        console.warn('Failed to cache model:', e)
      );
    }

    return networkResponse;

  } catch (error) {
    console.error('FaceAttend SW: Model request failed', error);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Handle CDN requests - cache first with network update
async function handleCDNRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // Return cached version immediately
      fetch(request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, response).catch(e => 
              console.warn('Failed to update CDN cache:', e)
            );
          });
        }
      }).catch(() => {}); // Ignore network errors for background update
      
      return cachedResponse;
    }

    // No cache, fetch from network
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(e => 
        console.warn('Failed to cache CDN resource:', e)
      );
    }
    return networkResponse;

  } catch (error) {
    console.error('FaceAttend SW: CDN request failed', error);
    throw error;
  }
}

// Handle app requests - network first with cache fallback
async function handleAppRequest(request) {
  try {
    // Try network first
    const networkResponse = await fetch(request, {
      method: request.method,
      headers: request.headers,
      mode: 'same-origin',
      credentials: request.credentials,
      cache: 'default' // Use browser's default caching
    });

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone()).catch(e => 
        console.warn('Failed to cache app resource:', e)
      );
    }

    return networkResponse;

  } catch (error) {
    console.error('FaceAttend SW: Network failed for app request');
    
    // Try cache fallback
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('FaceAttend SW: Serving from cache');
      return cachedResponse;
    }

    // If it's the main page, return offline page
    if (request.url.endsWith('/') || request.url.includes('.html')) {
      return new Response(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>FaceAttend - Offline</title>
          <style>
            body { 
              font-family: system-ui, -apple-system, sans-serif; 
              padding: 20px; 
              text-align: center; 
              background: #1a1a2e; 
              color: white; 
              min-height: 100vh; 
              display: flex; 
              flex-direction: column; 
              justify-content: center; 
              align-items: center;
            }
            .container { max-width: 400px; }
            h1 { color: #667eea; margin-bottom: 20px; }
            button { 
              background: #667eea; 
              color: white; 
              border: none; 
              padding: 12px 24px; 
              border-radius: 8px; 
              cursor: pointer; 
              font-size: 16px; 
              margin-top: 20px;
            }
            button:hover { background: #5a6fd8; }
            .status { 
              margin-top: 20px; 
              font-size: 14px; 
              opacity: 0.7; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>FaceAttend</h1>
            <p>Unable to connect to the server. Please check your internet connection and try again.</p>
            <button onclick="location.reload()">Retry Connection</button>
            <div class="status">Your data is safe and will be available when you're back online.</div>
          </div>
        </body>
        </html>
      `, { 
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        } 
      });
    }
    
    // For other requests, just throw the error
    throw error;
  }
}

// Message handling
self.addEventListener('message', (event) => {
  console.log('FaceAttend SW: Message received', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports[0];
    if (port) {
      port.postMessage({ version: CACHE_NAME });
    } else {
      event.source.postMessage({ version: CACHE_NAME });
    }
  }
  
  if (event.data && event.data.type === 'CACHE_MODELS') {
    event.waitUntil(
      preloadAIModels().catch(error => {
        console.error('FaceAttend SW: Failed to preload AI models', error);
      })
    );
  }

  if (event.data && event.data.type === 'REGISTER_SYNC') {
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      self.registration.sync.register('attendance-sync').catch(() => {});
    }
  }

  if (event.data && event.data.type === 'SAVE_USER_DATA') {
    saveUserData(event.data.key, event.data.data);
  }
  
  if (event.data && event.data.type === 'GET_USER_DATA') {
    getUserData(event.data.key).then(data => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ data });
      }
    });
  }
});

// User data functions
async function saveUserData(key, data) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = new Response(JSON.stringify(data));
    await cache.put(key, response);
  } catch (error) {
    console.error('Failed to save user data:', error);
  }
}

async function getUserData(key) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = await cache.match(key);
    return response ? await response.json() : null;
  } catch (error) {
    console.error('Failed to get user data:', error);
    return null;
  }
}

// Background sync for offline functionality
self.addEventListener('sync', (event) => {
  if (event.tag === 'attendance-sync') {
    console.log('FaceAttend SW: Background sync triggered');
    event.waitUntil(syncAttendanceData());
  }
});

async function syncAttendanceData() {
  try {
    console.log('FaceAttend SW: Syncing attendance data');
    
    const clients = await self.clients.matchAll();
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'SYNC_ATTENDANCE',
        timestamp: Date.now()
      });
    }
    return Promise.resolve();
  } catch (error) {
    console.error('FaceAttend SW: Attendance sync failed', error);
    return Promise.reject(error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('FaceAttend SW: Push notification received');
  
  let notificationData = {
    title: 'FaceAttend Reminder',
    body: 'Time to take attendance!',
    icon: '/facecam.jpeg',
    badge: '/facecam.jpeg'
  };
  
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = { ...notificationData, ...data };
    } catch (error) {
      console.error('FaceAttend SW: Failed to parse push data', error);
    }
  }
  
  const options = {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: notificationData.primaryKey || '1',
      url: notificationData.url || '/?from=notification'
    },
    actions: [
      {
        action: 'take-attendance',
        title: 'Take Attendance',
        icon: '/facecam.jpeg'
      },
      {
        action: 'view-records',
        title: 'View Records',
        icon: '/facecam.jpeg'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ],
    requireInteraction: false,
    silent: false,
    tag: 'attendance-reminder',
    renotify: true
  };
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
      .catch((error) => {
        console.error('FaceAttend SW: Failed to show notification', error);
      })
  );
});

// Notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('FaceAttend SW: Notification clicked', event.action);
  event.notification.close();
  
  let urlToOpen = '/';
  
  switch (event.action) {
    case 'take-attendance':
      urlToOpen = '/?shortcut=recognize';
      break;
    case 'view-records':
      urlToOpen = '/?shortcut=attendance';
      break;
    case 'dismiss':
      return;
    default:
      urlToOpen = event.notification.data?.url || '/';
  }
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.postMessage({
              type: 'NAVIGATE',
              url: urlToOpen
            });
            return client.focus();
          }
        }
        
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error('FaceAttend SW: Failed to handle notification click', error);
      })
  );
});

// Preload AI models
async function preloadAIModels() {
  console.log('FaceAttend SW: Preloading AI models');
  const cache = await caches.open(CACHE_NAME);
  
  const modelUrls = [
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-weights_manifest.json',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-shard1',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-weights_manifest.json',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-shard1',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-weights_manifest.json',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard1',
    'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard2'
  ];

  try {
    await Promise.allSettled(
      modelUrls.map(async url => {
        try {
          const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (error) {
          console.warn(`Failed to preload model: ${url}`, error);
        }
      })
    );
    console.log('FaceAttend SW: AI models preloaded');
  } catch (error) {
    console.error('FaceAttend SW: Error preloading AI models', error);
  }
}

// Error handling
self.addEventListener('error', (event) => {
  console.error('FaceAttend SW: Global error', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('FaceAttend SW: Unhandled promise rejection', event.reason);
  event.preventDefault();
});

// Periodic sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'attendance-backup') {
    event.waitUntil(backupAttendanceData());
  }
});

async function backupAttendanceData() {
  console.log('FaceAttend SW: Performing periodic attendance backup');
  
  try {
    const clients = await self.clients.matchAll();
    if (clients.length > 0) {
      clients[0].postMessage({
        type: 'BACKUP_DATA',
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('FaceAttend SW: Backup failed', error);
  }
}
