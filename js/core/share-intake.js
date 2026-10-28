// Picks up files that the service worker kept after an Android "Share".
// Files only travel through Cache Storage on this device.

// Must be the same name as SHARE_CACHE in service-worker.js.
export const SHARE_CACHE = 'lokalconver-share-v1';
const BATCH_ID = /^[0-9a-f-]{36}$/i;

// Reads the query string the service worker redirected us to.
// Returns null when this page load has nothing to do with sharing.
export function readShareParams(search) {
  const params = new URLSearchParams(search);
  const batchId = params.get('shared');
  const skipped = Number(params.get('skipped') || params.get('share-empty')) || 0;
  const error = params.has('share-error');
  const empty = params.has('share-empty');
  if (!batchId && !error && !empty) return null;
  return {
    batchId: batchId && BATCH_ID.test(batchId) ? batchId : null,
    skipped,
    error,
  };
}

// Returns the shared files as File objects and deletes them from the cache.
export async function takeSharedFiles(batchId, cacheStorage = globalThis.caches) {
  if (!BATCH_ID.test(batchId) || !cacheStorage) return [];
  const cache = await cacheStorage.open(SHARE_CACHE);
  const marker = '/__shared__/' + batchId + '/';
  const found = (await cache.keys())
    .map((request) => ({ request, path: new URL(request.url).pathname }))
    .filter((item) => item.path.includes(marker))
    .sort((a, b) => indexOf(a.path) - indexOf(b.path));

  const files = [];
  for (const { request } of found) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      const name = cleanName(decodeName(response.headers.get('X-Name')));
      files.push(
        // No lastModified: a multipart share does not carry the original date.
        new File([blob], name, { type: response.headers.get('Content-Type') || blob.type }),
      );
    }
    await cache.delete(request); // temporary means temporary
  }
  return files;
}

function indexOf(path) {
  return Number(path.split('/').pop()) || 0;
}

function decodeName(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return '';
  }
}

// Keep only the last part of a path. The name is shown with textContent
// elsewhere, but a plain name is safer anyway.
function cleanName(name) {
  return name.split(/[\\/]/).pop().trim() || 'shared-file';
}
