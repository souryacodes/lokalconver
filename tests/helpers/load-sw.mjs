// Runs service-worker.js inside a Node vm, with a fake "self", so the real
// file is tested and not a copy.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FakeCacheStorage } from './fake-caches.mjs';

const ROOT = new URL('../../', import.meta.url);
export const SCOPE = 'https://example.test/app/';

// files: the precache list. network: (url, init) => Response, can throw to act offline.
export function loadServiceWorker({ files = ['index.html', 'js/app.js'], version = 'v1', network } = {}) {
  const calls = { fetch: [], skipWaiting: 0, claim: 0, posted: [] };
  const fetchFn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.fetch.push({ url, init });
    return network(url, init);
  };
  const listeners = {};
  const sandbox = {
    console, URL, URLSearchParams, Request, Response, Headers, FormData, File, Blob,
    AbortController, setTimeout, clearTimeout, crypto,
    fetch: fetchFn,
    caches: new FakeCacheStorage(fetchFn),
    registration: { scope: SCOPE },
    clients: {
      claim: async () => { calls.claim += 1; },
      matchAll: async () => [{ postMessage: (m) => calls.posted.push(m) }],
    },
    skipWaiting: () => { calls.skipWaiting += 1; },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    importScripts: () => { sandbox.LOKALCONVER_PRECACHE = { version, files }; },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('service-worker.js', ROOT), 'utf8'), sandbox);

  // Fire an event and wait for everything the worker handed to waitUntil/respondWith.
  async function fire(type, extra = {}) {
    const waits = [];
    let responded;
    const event = { ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => { responded = p; } };
    listeners[type](event);
    await Promise.all(waits);
    return { responded: responded ? await responded : undefined, handled: responded !== undefined };
  }
  return { sandbox, calls, fire, caches: sandbox.caches };
}
