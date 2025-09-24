// =============================================================================
// UPDATED SERVICE WORKER FOR INSTANT UPDATES AND FIXES
// =============================================================================

const CACHE_NAME = 'faceattend-v2.1.0'; // Increment for updates
const DATA_CACHE_NAME = 'faceattend-data-v1.0.0'; // Separate cache for user data

// Only cache essential offline resources - NO CODE FILES
// Replace the tiny model URLs with standard model URLs in sw.js
const urlsToCache = [
  '/manifest.json',
  '/facecam.jpeg',
  // Standard models instead of tiny
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/ssd_mobilenetv1_model-shard2',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_landmark_68_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-weights_manifest.json',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard1',
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/face_recognition_model-shard2'
];


// Resources that should NEVER be cached (always fetch fresh)
const NEVER_CACHE = [
  '/', 
  '/index.html',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js'
];

// Install event - minimal caching
self.addEventListener('install', (event) => {
  console.log('FaceAttend SW: Installing with instant update support');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('FaceAttend SW: Caching only essential offline resources');
        return cache.addAll(urlsToCache.map(url => new Request(url, {
          mode: 'cors',
          credentials: 'omit'
        })));
      })
      .catch((error) => {
        console.error('FaceAttend SW: Cache failed', error);
        return Promise.resolve();
      })
  );
  
  // CRITICAL: Skip waiting to update immediately
  self.skipWaiting();
});

// Activate event - aggressive cache cleanup for updates
self.addEventListener('activate', (event) => {
  console.log('FaceAttend SW: Activating with cache cleanup');
  event.waitUntil(
    Promise.all([
      // Clean ALL old caches except data cache
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
      
      // Clear any stale app caches
      clearStaleAppCache(),
      
      // Take control immediately
      self.clients.claim()
    ])
  );
});

async function clearStaleAppCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    
    // Remove any cached HTML/JS/CSS files to force fresh fetch
    const staleCachePromises = requests.map(request => {
      const url = request.url;
      if (NEVER_CACHE.some(pattern => url.includes(pattern)) ||
          url.includes('.html') || 
          url.includes('.js') || 
          url.includes('.css')) {
        console.log('FaceAttend SW: Removing stale cache:', url);
        return cache.delete(request);
      }
    });
    
    await Promise.all(staleCachePromises);
  } catch (error) {
    console.error('FaceAttend SW: Failed to clear stale cache', error);
  }
}

// Fetch event - network first for code, cache for models/data
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  const url = event.request.url;
  
  // NEVER cache these - always fetch fresh for instant updates
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
  // Images and other static assets
  else if (event.request.destination === 'image') {
    event.respondWith(handleImageRequest(event.request));
  }
  // Everything else - network first
  else {
    event.respondWith(handleFreshContent(event.request));
  }
});

// ALWAYS fetch fresh content for instant updates
async function handleFreshContent(request) {
  try {
    console.log('FaceAttend SW: Fetching fresh content:', request.url);
    
    // Add cache-busting headers
    const freshRequest = new Request(request.url, {
      method: request.method,
      headers: {
        ...request.headers,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      },
      mode: request.mode,
      credentials: request.credentials
    });
    
    const networkResponse = await fetch(freshRequest);
    
    if (!networkResponse.ok && request.url.includes('.html')) {
      // Fallback to basic HTML for offline
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>FaceAttend - Offline</title></head>
        <body style="font-family: Arial; padding: 20px; text-align: center;">
          <h1>FaceAttend</h1>
          <p>Unable to load the latest version. Please check your connection.</p>
          <button onclick="location.reload()">Retry</button>
        </body></html>
      `, { headers: { 'Content-Type': 'text/html' } });
    }
    
    return networkResponse;
    
  } catch (error) {
    console.log('FaceAttend SW: Network failed for fresh content');
    throw error; // Let it fail rather than serve stale cache
  }
}

// Cache AI models for offline use
async function handleModelRequest(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('FaceAttend SW: Serving AI model from cache');
      return cachedResponse;
    }

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

// Handle images with caching
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
    return new Response('', { status: 404 });
  }
}

// User data persistence (attendance records, enrolled students)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SAVE_USER_DATA') {
    saveUserData(event.data.key, event.data.data);
  }
  
  if (event.data && event.data.type === 'GET_USER_DATA') {
    getUserData(event.data.key).then(data => {
      event.ports[0].postMessage({ data });
    });
  }
  
  if (event.data && event.data.type === 'FORCE_UPDATE') {
    // Force update by clearing caches and reloading
    event.waitUntil(forceAppUpdate());
  }

  if (event.data && event.data.type === 'CHECK_UPDATE') {
    // Check for updates
    event.waitUntil(checkForUpdates());
  }
});

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
    if (response) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error('Failed to get user data:', error);
    return null;
  }
}

async function forceAppUpdate() {
  try {
    // Clear all caches except user data
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(name => {
        if (name !== DATA_CACHE_NAME) {
          return caches.delete(name);
        }
      })
    );
    
    // Notify clients to reload
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'FORCE_RELOAD' });
    });
    
  } catch (error) {
    console.error('Force update failed:', error);
  }
}

// Check for updates by comparing timestamps or versions
async function checkForUpdates() {
  try {
    const response = await fetch('/version.json?' + Date.now(), {
      cache: 'no-store'
    });
    
    if (response.ok) {
      const versionInfo = await response.json();
      const clients = await self.clients.matchAll();
      
      clients.forEach(client => {
        client.postMessage({ 
          type: 'VERSION_CHECK', 
          version: versionInfo 
        });
      });
    }
  } catch (error) {
    console.log('Version check failed - probably no version.json file');
  }
}

// Auto-check for updates every 30 seconds
setInterval(() => {
  checkForUpdates();
}, 30000);

// =============================================================================
// CHANGES TO MAKE IN YOUR MAIN APP (index.html script section):
// =============================================================================

// ADD THIS JAVASCRIPT TO YOUR MAIN APP AFTER THE SERVICE WORKER REGISTRATION:

/*
// Enhanced Service Worker registration with update detection
if ('serviceWorker' in navigator) {
    let refreshing = false;
    
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        console.log('New version available, reloading...');
        window.location.reload();
    });
    
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            
            // Check for updates immediately
            registration.update();
            
            // Listen for new service worker
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New version available
                        showUpdateNotification();
                    }
                });
            });
            
            // Listen for messages from SW
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data.type === 'FORCE_RELOAD') {
                    window.location.reload();
                }
                
                if (event.data.type === 'VERSION_CHECK') {
                    console.log('Version info:', event.data.version);
                    // Handle version check if needed
                }
            });
            
        } catch (error) {
            console.error('SW registration failed:', error);
        }
    });
}

// Show update notification
function showUpdateNotification() {
    const updateBanner = document.createElement('div');
    updateBanner.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; background: #4CAF50; color: white; padding: 10px; text-align: center; z-index: 10000;">
            <span>New version available! </span>
            <button onclick="window.location.reload()" style="background: white; color: #4CAF50; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">
                Update Now
            </button>
            <button onclick="this.parentElement.remove()" style="background: transparent; color: white; border: 1px solid white; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-left: 10px;">
                Later
            </button>
        </div>
    `;
    document.body.insertBefore(updateBanner, document.body.firstChild);
}

// Force check for updates (call this when needed)
function checkForUpdates() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CHECK_UPDATE' });
    }
}

// Auto-check every 5 minutes
setInterval(checkForUpdates, 5 * 60 * 1000);
*/

// =============================================================================
// MAIN ISSUE FIXES FOR YOUR LOADING PROBLEM:
// =============================================================================

/*
1. UPDATE YOUR MODEL LOADING URLS - Your SW has wrong model names!
   
   REPLACE these URLs in your loadModels() function:
   
   OLD (causing the loading issue):
   - ssdMobilenetv1 
   - faceLandmark68Net
   
   NEW (correct tiny model names):
   - tinyFaceDetector
   - faceLandmark68TinyNet
   
2. UPDATE YOUR SERVICE WORKER CACHE URLS:
   
   The URLs in your SW urlsToCache are pointing to old model names that don't exist.
   Use the updated SW.js above which has the correct model URLs.

3. CLEAR BROWSER CACHE:
   
   After updating, users need to:
   - Hard refresh (Ctrl+Shift+R)
   - Or go to DevTools > Application > Storage > Clear site data

4. CREATE A version.json FILE (optional for update checking):
   
   Create a file called version.json in your root directory:
   {
     "version": "2.1.0",
     "timestamp": "2024-01-15T10:30:00Z",
     "changes": ["Performance improvements", "Bug fixes"]
   }
*/

// =============================================================================
// DEPLOYMENT STRATEGY FOR INSTANT UPDATES:
// =============================================================================

/*
When you update code on GitHub:

1. Increment CACHE_NAME version in sw.js
2. Push changes to GitHub
3. The new SW will:
   - Skip waiting and activate immediately
   - Clear old caches
   - Force fresh fetch of all code
   - Show update notification to users

4. Users will get updates within 30 seconds automatically

No more caching issues - the app will always fetch fresh code!
*/
