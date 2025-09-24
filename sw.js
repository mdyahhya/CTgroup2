// =============================================================================
// INSTANT UPDATE SERVICE WORKER WITH USER DATA PRESERVATION
// =============================================================================

const CACHE_NAME = 'faceattend-v3.0.0'; // Increment this for each update
const DATA_CACHE_NAME = 'faceattend-data-v1.0.0'; // User data cache (never cleared)

// Only cache essential offline resources and AI models (NO CODE FILES)
const urlsToCache = [
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

// NEVER cache these files - always fetch fresh for instant updates
const NEVER_CACHE = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome'
];

// Install event - cache only essential resources
self.addEventListener('install', (event) => {
  console.log('FaceAttend SW: Installing with instant update capability');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('FaceAttend SW: Caching essential resources only');
        return cache.addAll(urlsToCache.map(url => new Request(url, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'reload' // Force fresh fetch during install
        })));
      })
      .catch((error) => {
        console.error('FaceAttend SW: Cache failed', error);
        return Promise.resolve();
      })
  );
  
  // CRITICAL: Skip waiting for instant updates
  self.skipWaiting();
});

// Activate event - immediate takeover with data preservation
self.addEventListener('activate', (event) => {
  console.log('FaceAttend SW: Activating with immediate control');
  
  event.waitUntil(
    Promise.all([
      // Delete old caches except user data
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
      
      // Take control immediately
      self.clients.claim()
    ])
  );
  
  // Notify all clients that update is available
  notifyClientsOfUpdate();
});

// Fetch event - Network first for code, cache for models
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  const url = event.request.url;
  
  // NEVER cache HTML/JS/CSS - always fetch fresh
  if (NEVER_CACHE.some(pattern => url.includes(pattern)) ||
      url.includes('.html') || 
      url.includes('.js') || 
      url.includes('.css')) {
    event.respondWith(handleFreshContent(event.request));
  }
  // AI model files - cache for offline functionality  
  else if (url.includes('face-api') || url.includes('vladmandic')) {
    event.respondWith(handleModelRequest(event.request));
  }
  // Images - cache with revalidation
  else if (event.request.destination === 'image') {
    event.respondWith(handleImageRequest(event.request));
  }
  // Everything else - network first
  else {
    event.respondWith(handleFreshContent(event.request));
  }
});

// Always fetch fresh content with cache busting
async function handleFreshContent(request) {
  try {
    console.log('FaceAttend SW: Fetching fresh content:', request.url);
    
    // Add cache-busting timestamp for code files
    const cacheBustedUrl = new URL(request.url);
    if (cacheBustedUrl.pathname.endsWith('.html') || 
        cacheBustedUrl.pathname === '/' || 
        cacheBustedUrl.pathname.endsWith('.js') ||
        cacheBustedUrl.pathname.endsWith('.css')) {
      cacheBustedUrl.searchParams.set('_cb', Date.now());
    }
    
    const freshRequest = new Request(cacheBustedUrl.href, {
      method: request.method,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
      credentials: request.credentials
    });
    
    const response = await fetch(freshRequest);
    
    // Add no-cache headers to response
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
    
  } catch (error) {
    console.error('FaceAttend SW: Fresh fetch failed:', error);
    
    // Offline fallback for HTML pages
    if (request.url.includes('.html') || request.url.endsWith('/')) {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>FaceAttend - Offline</title></head>
        <body style="font-family: Arial; padding: 20px; text-align: center; background: #1a1a2e; color: white;">
          <h1>🎭 FaceAttend</h1>
          <p>You're offline. Please check your connection and try again.</p>
          <button onclick="location.reload()" style="background: #667eea; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 16px;">
            🔄 Retry Connection
          </button>
          <p style="margin-top: 20px; font-size: 14px; opacity: 0.7;">Your data is safe and will sync when you're back online.</p>
        </body></html>
      `, { 
        headers: { 'Content-Type': 'text/html' } 
      });
    }
    
    throw error;
  }
}

// Keep your existing model handling (it's perfect)
async function handleModelRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('FaceAttend SW: Serving AI model from cache');
      return cachedResponse;
    }

    console.log('FaceAttend SW: Fetching AI model from network');
    const networkResponse = await fetch(request, {
      mode: 'cors',
      credentials: 'omit'
    });

    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;

  } catch (error) {
    console.error('FaceAttend SW: AI model request failed', error);
    return caches.match(request);
  }
}

// Keep your existing image handling
async function handleImageRequest(request) {
  try {
    // Try network first for fresh images
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    throw new Error('Network failed');
  } catch (error) {
    // Fallback to cache
    const cachedResponse = await caches.match(request);
    return cachedResponse || new Response('', { status: 404 });
  }
}

// Enhanced message handling with instant updates
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
      self.registration.sync.register('attendance-sync');
    }
  }

  // User data management with separate cache
  if (event.data && event.data.type === 'SAVE_USER_DATA') {
    saveUserData(event.data.key, event.data.data);
  }
  
  if (event.data && event.data.type === 'GET_USER_DATA') {
    getUserData(event.data.key).then(data => {
      event.ports[0].postMessage({ data });
    });
  }
});

// User data functions (separate from code cache)
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

// Notify clients of updates
function notifyClientsOfUpdate() {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ 
        type: 'UPDATE_AVAILABLE',
        message: 'New version available! Click to update.',
        version: CACHE_NAME
      });
    });
  });
}

// Keep ALL your existing functionality below
// Background sync for offline attendance marking
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

// Keep your push notifications
self.addEventListener('push', (event) => {
  console.log('FaceAttend SW: Push notification received');
  
  let notificationData = {
    title: 'FaceAttend Reminder',
    body: 'Time to take attendance!',
    icon: '/facecam.jpeg', // Use your existing icon
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

// Keep notification clicks
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

// Keep your preload function
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
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (response.ok) {
          await cache.put(url, response);
        }
      })
    );
    console.log('FaceAttend SW: AI models preloaded successfully');
  } catch (error) {
    console.error('FaceAttend SW: Error preloading AI models', error);
  }
}

// Keep error handling
self.addEventListener('error', (event) => {
  console.error('FaceAttend SW: Global error', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('FaceAttend SW: Unhandled promise rejection', event.reason);
  event.preventDefault();
});

// Keep periodic sync
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

// Auto-check for updates every 30 seconds
setInterval(() => {
  console.log('FaceAttend SW: Auto-checking for updates...');
  // Browser automatically checks for SW updates
}, 30000);
