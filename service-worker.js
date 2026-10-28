/* LokalConver service worker.
 *
 * A classic script on purpose (not an ES module): module service workers are
 * not supported everywhere yet.
 *
 * Jobs:
 *   1. Precache the app shell (list made by tools/gen_precache.py).
 *   2. Cache the engines (the pinned libraries in js/vendor/) the first time
 *      they are used, then serve them from cache first.
 *   3. Network first for pages (index.html), so updates arrive.
 *   4. Receive files from the Android Share sheet (Web Share Target).
 *
 * Nothing here ever sends file content anywhere. Shared files only go into
 * Cache Storage on this device, and the page deletes them after reading.
 */
'use strict';

// Sets self.LOKALCONVER_PRECACHE = { version, files }. Generated file.
importScripts('./precache-manifest.js');

const PRECACHE = self.LOKALCONVER_PRECACHE;
const PREFIX = 'lokalconver-';
const SHELL_CACHE = PREFIX + 'shell-' + PRECACHE.version; // new name every release
// Engines live in js/vendor/ with the exact version in their path (for example
// pdf-lib/1.17.1/), so their cache can outlive shell releases. Change the number
// only when you want to flush it on purpose.
const ENGINE_CACHE = PREFIX + 'engines-v1';
// Must be the same name as in js/core/share-intake.js (a test checks the round trip).
const SHARE_CACHE = PREFIX + 'share-v1';
const KEEP_CACHES = [SHELL_CACHE, ENGINE_CACHE, SHARE_CACHE];

const SHARE_PATH = 'share-target'; // same as share_target.action in the manifest
const SHARE_MAX_AGE_MS = 60 * 60 * 1000; // forget shared files nobody picked up
const NAV_TIMEOUT_MS = 4000; // on a bad network, use the cached page after this

// Shared files are checked here too, because anything can POST to this URL.
const SHARE_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const SHARE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif', 'avif', 'ico',
  'pdf',
  'mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus',
  'mp4', 'mov', 'webm', 'mkv', 'm4v',
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const SHELL_URLS = new Set(PRECACHE.files.map(scopeUrl));

// ---------------------------------------------------------------- lifecycle

self.addEventListener('install', (event) => {
  // No skipWaiting() here. An open page keeps its own version until the person
  // taps "Reload", so old page code never mixes with new cached files.
  event.waitUntil(precacheShell());
});

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  // cache: 'reload' skips the browser HTTP cache, so a stale copy can never
  // be frozen into the new versioned cache. addAll is all or nothing: if one
  // file fails, the install fails and the old version keeps working.
  await cache.addAll(PRECACHE.files.map((file) => new Request(scopeUrl(file), { cache: 'reload' })));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(PREFIX) && !KEEP_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await purgeOldShares();
      await self.clients.claim(); // so the first visit is already controlled
      await tellClients({ type: 'SHELL_READY', version: PRECACHE.version });
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_STATUS' && event.ports && event.ports[0]) {
    const port = event.ports[0];
    event.waitUntil(shellStatus().then((status) => port.postMessage(status)));
  }
});

// Real check, not a guess: is every shell file really in the cache right now?
// (The browser may clear caches when the phone is short of space.)
async function shellStatus() {
  const cache = await caches.open(SHELL_CACHE);
  const keys = await cache.keys();
  return { ready: keys.length >= SHELL_URLS.size, version: PRECACHE.version };
}

async function tellClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

// ------------------------------------------------------------------- routing

// Decide what to do with a request. Returns a name, or null to leave it alone.
// Only our own address is handled. The page policy allows no other address.
function route(request) {
  const url = new URL(request.url);
  if (url.origin !== new URL(self.registration.scope).origin) return null;

  if (request.method === 'POST') return url.href === scopeUrl(SHARE_PATH) ? 'share' : null;
  if (request.method !== 'GET') return null;

  if (request.mode === 'navigate') return 'navigation';
  if (SHELL_URLS.has(url.origin + url.pathname)) return 'shell';
  if (isEngine(url)) return 'engine';
  return null;
}

// Our engines: everything under js/vendor/ (libraries, workers, cmaps, fonts)
// and any WebAssembly file. They are big and used rarely, so they are NOT in the
// shell. They are saved the first time a conversion asks for them.
function isEngine(url) {
  const base = new URL(self.registration.scope).pathname;
  const own = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : '';
  return own.startsWith('js/vendor/') || own.endsWith('.wasm');
}

self.addEventListener('fetch', (event) => {
  const kind = route(event.request);
  if (kind === 'share') event.respondWith(handleShare(event.request));
  else if (kind === 'navigation') event.respondWith(handleNavigation(event.request));
  else if (kind === 'shell') event.respondWith(handleShell(event.request));
  else if (kind === 'engine') event.respondWith(handleEngine(event));
  // Anything else: no respondWith, so the browser does its normal thing.
});

// ----------------------------------------------------------------- strategies

// Shell files: cache first. They belong to this exact release.
async function handleShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const url = new URL(request.url);
  return (await cache.match(url.origin + url.pathname)) || fetch(request);
}

// Pages: network first, so a new index.html is seen straight away.
// We do NOT save the network copy. New files only enter the cache through a
// new service worker install, so HTML and JS cannot be from different releases
// inside the cache.
async function handleNavigation(request) {
  try {
    const response = await fetchWithTimeout(request.url, NAV_TIMEOUT_MS);
    // Anything below 500 is a real answer from the server (even a 404), and an
    // 'opaqueredirect' (status 0, for example /app to /app/) must be passed on as it is.
    if (response.status < 500) return response;
  } catch (error) {
    // offline, timeout or DNS failure: fall through to the cache
  }
  const cache = await caches.open(SHELL_CACHE);
  return (
    (await cache.match(request.url, { ignoreSearch: true })) ||
    (await cache.match(scopeUrl('index.html'))) ||
    Response.error()
  );
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    // no-cache: always ask the server if the page changed (a cheap 304 when not).
    // redirect manual: a redirected response is not allowed for a navigation.
    return await fetch(url, { cache: 'no-cache', redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Engines: cache first, saved the first time they are used.
async function handleEngine(event) {
  const { request } = event;
  const cache = await caches.open(ENGINE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;

  const response = await fetch(request);
  // Only whole, good answers. Partial (206) or error answers are never saved.
  if (response.status === 200) {
    event.waitUntil(cache.put(request.url, response.clone()));
  }
  return response;
}

// --------------------------------------------------------------- share target

// Android sends the shared files as a POST. We keep them in Cache Storage for
// a moment, then send the person to the app page, which collects them.
async function handleShare(request) {
  try {
    await purgeOldShares();
    const form = await request.formData();
    const all = form.getAll('files').filter((item) => typeof item !== 'string');
    const accepted = all.filter(isAcceptedShare);
    const skipped = all.length - accepted.length;

    if (accepted.length === 0) {
      return redirectToApp('share-empty=' + skipped);
    }
    const batchId = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    const sharedAt = String(Date.now());
    for (let i = 0; i < accepted.length; i += 1) {
      const file = accepted[i];
      await cache.put(
        shareKey(batchId, i),
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            // Headers cannot hold every character, so the name is encoded.
            'X-Name': encodeURIComponent(file.name || 'shared-file'),
            'X-Shared-At': sharedAt,
          },
        }),
      );
    }
    return redirectToApp('shared=' + batchId + (skipped ? '&skipped=' + skipped : ''));
  } catch (error) {
    // Too big for memory or storage, or a broken request.
    return redirectToApp('share-error=1');
  }
}

function isAcceptedShare(file) {
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || SHARE_MIME_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    return true;
  }
  // Some phones send an empty or generic type (for example for .heic or .mkv).
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return SHARE_EXTENSIONS.includes(ext);
}

function shareKey(batchId, index) {
  return scopeUrl('__shared__/' + batchId + '/' + index);
}

// 303 = "now GET this page", so a refresh never sends the files again.
function redirectToApp(query) {
  return Response.redirect(scopeUrl('./?' + query + '#/convert'), 303);
}

async function purgeOldShares() {
  const cache = await caches.open(SHARE_CACHE);
  const now = Date.now();
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    const sharedAt = Number(response && response.headers.get('X-Shared-At'));
    if (!sharedAt || now - sharedAt > SHARE_MAX_AGE_MS) await cache.delete(request);
  }
}
