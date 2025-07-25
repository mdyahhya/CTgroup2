const CACHE_NAME = 'faceattend-v2.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  '/facecam.jpeg',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard2'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('FaceAttend SW: Install event triggered');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('FaceAttend SW: Caching app shell and AI models');
        return cache.addAll(urlsToCache.map(url => new Request(url, {
          mode: 'cors',
          credentials: 'omit'
        })));
      })
      .catch((error) => {
        console.error('FaceAttend SW: Cache failed', error);
        // Continue installation even if some resources fail to cache
        return Promise.resolve();
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('FaceAttend SW: Activate event triggered');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('FaceAttend SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension requests
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // Handle different types of requests
  if (event.request.destination === 'document') {
    // HTML documents - try cache first, then network
    event.respondWith(handleDocumentRequest(event.request));
  } else if (event.request.url.includes('face-api') || 
             event.request.url.includes('vladmandic')) {
    // AI model files - prioritize cache for offline functionality
    event.respondWith(handleModelRequest(event.request));
  } else if (event.request.destination === 'image') {
    // Images - cache first
    event.respondWith(handleImageRequest(event.request));
  } else {
    // Other resources - network first, fallback to cache
    event.respondWith(handleGenericRequest(event.request));
  }
});

async function handleDocumentRequest(request) {
  try {
    // Try cache first for offline functionality
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('FaceAttend SW: Serving document from cache');
      return cachedResponse;
    }

    // Fallback to network
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('FaceAttend SW: Document request failed, serving offline page');
    // Return cached index.html as fallback
    return caches.match('/index.html') || caches.match('/');
  }
}

async function handleModelRequest(request) {
  try {
    // For AI models, always try cache first for performance
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

    // Cache model files for offline use
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;

  } catch (error) {
    console.error('FaceAttend SW: AI model request failed', error);
    // Try to return cached version
    return caches.match(request);
  }
}

async function handleImageRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('FaceAttend SW: Image request failed');
    return new Response('', { status: 404 });
  }
}

async function handleGenericRequest(request) {
  try {
    // Try network first for fresh content
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('FaceAttend SW: Network request failed, trying cache');
    // Fallback to cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

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
    
    // Get pending attendance records from IndexedDB or localStorage
    const clients = await self.clients.matchAll();
    
    if (clients.length > 0) {
      // Notify the app about sync opportunity
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

// Push notifications for attendance reminders
self.addEventListener('push', (event) => {
  console.log('FaceAttend SW: Push notification received');
  
  let notificationData = {
    title: 'FaceAttend Reminder',
    body: 'Time to take attendance!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png'
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
        icon: '/icons/icon-96.png'
      },
      {
        action: 'view-records',
        title: 'View Records',
        icon: '/icons/icon-96.png'
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

// Handle notification clicks
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
      return; // Just close the notification
    default:
      urlToOpen = event.notification.data?.url || '/';
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            // Navigate to the desired URL
            client.postMessage({
              type: 'NAVIGATE',
              url: urlToOpen
            });
            return client.focus();
          }
        }
        
        // If not open, open new window
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
      .catch((error) => {
        console.error('FaceAttend SW: Failed to handle notification click', error);
      })
  );
});

// Handle messages from the main thread
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
    // Preload AI models when requested
    event.waitUntil(
      preloadAIModels().catch(error => {
        console.error('FaceAttend SW: Failed to preload AI models', error);
      })
    );
  }

  if (event.data && event.data.type === 'REGISTER_SYNC') {
    // Register background sync for offline attendance
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
      self.registration.sync.register('attendance-sync');
    }
  }
});

// Preload AI models for better offline performance
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

// Error handling
self.addEventListener('error', (event) => {
  console.error('FaceAttend SW: Global error', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('FaceAttend SW: Unhandled promise rejection', event.reason);
  event.preventDefault();
});

// Periodic background sync (if supported)
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
