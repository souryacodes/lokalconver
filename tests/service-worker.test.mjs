import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorker, SCOPE } from './helpers/load-sw.mjs';
import { SHARE_CACHE, readShareParams, takeSharedFiles } from '../js/core/share-intake.js';

const page = (path) => new URL(path, SCOPE).href;
const ENGINE = page('js/vendor/fflate-0.8.3.js'); // an engine: kept in js/vendor/

// A network that serves the shell files and a pinned engine, and can go offline.
function makeNetwork(state = { offline: false }) {
  const network = async (url) => {
    if (state.offline) throw new TypeError('offline');
    if (url.startsWith(SCOPE)) return new Response('body of ' + url, { status: 200 });
    return new Response('nope', { status: 404 });
  };
  return { network, state };
}

async function installed(options = {}) {
  const net = makeNetwork();
  const sw = loadServiceWorker({ network: net.network, ...options });
  await sw.fire('install');
  await sw.fire('activate');
  return { sw, ...net };
}

const get = (url, mode = 'cors') => {
  const request = new Request(url);
  Object.defineProperty(request, 'mode', { value: mode });
  return { request };
};

test('install: precaches every shell file in a versioned cache, without skipWaiting', async () => {
  const net = makeNetwork();
  const sw = loadServiceWorker({ network: net.network, version: 'abc123' });
  await sw.fire('install');
  assert.deepEqual(await sw.caches.keys(), ['lokalconver-shell-abc123']);
  const cache = await sw.caches.open('lokalconver-shell-abc123');
  assert.deepEqual((await cache.keys()).map((r) => r.url).sort(), [page('index.html'), page('js/app.js')]);
  assert.equal(sw.calls.skipWaiting, 0);
  assert.ok(sw.calls.fetch.every((c) => c.init.cache === 'reload'), 'bypasses the HTTP cache');
});

test('install: if one file fails, the install fails (old version keeps working)', async () => {
  const network = async (url) => new Response('x', { status: url.endsWith('app.js') ? 404 : 200 });
  const sw = loadServiceWorker({ network });
  await assert.rejects(sw.fire('install'));
});

test('activate: deletes old lokalconver caches, keeps current, engines, shares and foreign caches', async () => {
  const { sw } = await installed({ version: 'new' });
  for (const name of ['lokalconver-shell-old', 'lokalconver-engines-v1', 'lokalconver-share-v1', 'other-app']) {
    await sw.caches.open(name);
  }
  await sw.fire('activate');
  const names = (await sw.caches.keys()).sort();
  assert.deepEqual(names, ['lokalconver-engines-v1', 'lokalconver-share-v1', 'lokalconver-shell-new', 'other-app']);
  assert.ok(sw.calls.claim >= 1);
  assert.ok(sw.calls.posted.some((m) => m.type === 'SHELL_READY'));
});

test('messages: SKIP_WAITING works, GET_STATUS tells the truth', async () => {
  const { sw } = await installed({ version: 'v9' });
  await sw.fire('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.calls.skipWaiting, 1);

  const ask = async () => {
    const replies = [];
    await sw.fire('message', { data: { type: 'GET_STATUS' }, ports: [{ postMessage: (m) => replies.push(m) }] });
    return replies[0];
  };
  const status = await ask(); // compare fields: the object comes from another VM realm
  assert.equal(status.ready, true);
  assert.equal(status.version, 'v9');

  await sw.caches.delete('lokalconver-shell-v9'); // the browser cleared it
  assert.equal((await ask()).ready, false);
});

test('shell files come from the cache first, with no network', async () => {
  const { sw, state } = await installed();
  state.offline = true;
  const before = sw.calls.fetch.length;
  const { responded } = await sw.fire('fetch', get(page('js/app.js'), 'cors'));
  assert.equal(await responded.text(), 'body of ' + page('js/app.js'));
  assert.equal(sw.calls.fetch.length, before);
});

test('pages: network first, cache when offline, and search strings do not matter', async () => {
  const { sw, state } = await installed();
  let res = (await sw.fire('fetch', get(page('index.html'), 'navigate'))).responded;
  assert.equal(await res.text(), 'body of ' + page('index.html')); // from the network
  assert.deepEqual(sw.calls.fetch.at(-1).init.cache, 'no-cache');

  state.offline = true;
  res = (await sw.fire('fetch', get(page('index.html'), 'navigate'))).responded;
  assert.equal(await res.text(), 'body of ' + page('index.html'));
  res = (await sw.fire('fetch', get(page('./?shared=abc#/convert'), 'navigate'))).responded;
  assert.equal(await res.text(), 'body of ' + page('index.html'), 'start page falls back to index.html');
});

test('pages: network copies are NOT written to the cache', async () => {
  const { sw } = await installed();
  const cache = await sw.caches.open('lokalconver-shell-v1');
  const before = [...cache.entries.values()];
  await sw.fire('fetch', get(page('index.html'), 'navigate'));
  assert.deepEqual([...cache.entries.values()], before);
});

test('pages: a server error falls back to the cached page', async () => {
  const { sw, state } = await installed();
  state.offline = false;
  const original = sw.sandbox.fetch;
  sw.sandbox.fetch = async () => new Response('boom', { status: 503 });
  const res = (await sw.fire('fetch', get(page('index.html'), 'navigate'))).responded;
  assert.equal(await res.text(), 'body of ' + page('index.html'));
  sw.sandbox.fetch = original;
});

test('engines (js/vendor): saved on first use, then served from cache while offline', async () => {
  const { sw, state } = await installed();
  const first = await sw.fire('fetch', get(ENGINE, 'cors'));
  assert.equal(await first.responded.text(), 'body of ' + ENGINE);
  assert.equal(sw.calls.fetch.at(-1).url, ENGINE);

  state.offline = true;
  const second = await sw.fire('fetch', get(ENGINE, 'cors'));
  assert.equal(await second.responded.text(), 'body of ' + ENGINE);
});

test('engines: the engine cache survives a new shell version', async () => {
  const { sw } = await installed({ version: 'one' });
  await sw.fire('fetch', get(ENGINE));
  const next = loadServiceWorker({ network: sw.sandbox.fetch, version: 'two' });
  next.sandbox.caches.stores = sw.sandbox.caches.stores; // same browser storage
  await next.fire('install');
  await next.fire('activate');
  const engines = await next.sandbox.caches.open('lokalconver-engines-v1');
  assert.ok(await engines.match(ENGINE), 'engine still cached');
  assert.deepEqual((await next.sandbox.caches.keys()).filter((n) => n.startsWith('lokalconver-shell-')), ['lokalconver-shell-two']);
});

test('engines: own .wasm files are cached on first use too', async () => {
  const { sw, state } = await installed();
  const url = page('js/engines/core.wasm');
  await sw.fire('fetch', get(url));
  state.offline = true;
  assert.equal(await (await sw.fire('fetch', get(url))).responded.text(), 'body of ' + url);
});

test('engines: partial or failed answers are not saved', async () => {
  const sw = loadServiceWorker({ network: async () => new Response('x', { status: 206 }) });
  await sw.fire('install').catch(() => {});
  await sw.fire('fetch', get(ENGINE));
  const engines = await sw.caches.open('lokalconver-engines-v1');
  assert.equal(engines.entries.size, 0);
});

test('other sites are never touched', async () => {
  const { sw } = await installed();
  for (const url of [
    'https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js',
    'https://elsewhere.test/js/vendor/x.js',
    'http://example.test/app/js/vendor/x.js', // other origin (http)
  ]) {
    assert.equal((await sw.fire('fetch', get(url))).handled, false, url);
  }
});

test('other requests are left to the browser', async () => {
  const { sw } = await installed();
  assert.equal((await sw.fire('fetch', get('https://elsewhere.test/a.png'))).handled, false);
  assert.equal((await sw.fire('fetch', get(page('unknown.json')))).handled, false);
  const post = { request: new Request(page('api'), { method: 'POST', body: 'x' }) };
  assert.equal((await sw.fire('fetch', post)).handled, false);
});

// ---- share target

function shareRequest(files, { url = page('share-target') } = {}) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return { request: new Request(url, { method: 'POST', body: form }) };
}

test('share: stores files, redirects 303 to the Convert page, page takes them back', async () => {
  const { sw } = await installed();
  const photo = new File([new Uint8Array([1, 2, 3, 4])], 'Ráma photo.heic', { type: 'image/heic' });
  const doc = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' });
  const { responded } = await sw.fire('fetch', shareRequest([photo, doc]));

  assert.equal(responded.status, 303);
  const location = new URL(responded.headers.get('Location'));
  assert.equal(location.hash, '#/convert');
  assert.equal(location.pathname, '/app/');
  const params = readShareParams(location.search);
  assert.ok(params.batchId);

  const files = await takeSharedFiles(params.batchId, sw.caches);
  assert.deepEqual(files.map((f) => f.name), ['Ráma photo.heic', 'scan.pdf']);
  assert.deepEqual(files.map((f) => f.type), ['image/heic', 'application/pdf']);
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())], [1, 2, 3, 4]);
  // temporary means temporary
  assert.equal((await sw.caches.open(SHARE_CACHE)).entries.size, 0);
  assert.deepEqual(await takeSharedFiles(params.batchId, sw.caches), []);
});

test('share: files with an empty type are accepted by extension, others are skipped', async () => {
  const { sw } = await installed();
  const heic = new File(['x'], 'IMG_1.HEIC', { type: '' });
  const exe = new File(['x'], 'setup.exe', { type: 'application/octet-stream' });
  const { responded } = await sw.fire('fetch', shareRequest([heic, exe]));
  const params = readShareParams(new URL(responded.headers.get('Location')).search);
  assert.equal(params.skipped, 1);
  assert.deepEqual((await takeSharedFiles(params.batchId, sw.caches)).map((f) => f.name), ['IMG_1.HEIC']);
});

test('share: nothing acceptable gives an empty answer, not a crash', async () => {
  const { sw } = await installed();
  const { responded } = await sw.fire('fetch', shareRequest([new File(['x'], 'a.exe', { type: 'application/x-msdownload' })]));
  const params = readShareParams(new URL(responded.headers.get('Location')).search);
  assert.equal(params.batchId, null);
  assert.equal(params.skipped, 1);
});

test('share: a broken request redirects with an error flag', async () => {
  const { sw } = await installed();
  const request = new Request(page('share-target'), { method: 'POST', body: 'not multipart', headers: { 'Content-Type': 'text/plain' } });
  const { responded } = await sw.fire('fetch', { request });
  assert.equal(responded.status, 303);
  assert.equal(readShareParams(new URL(responded.headers.get('Location')).search).error, true);
});

test('share: old files nobody collected are removed on the next share and on activate', async () => {
  const { sw } = await installed();
  const cache = await sw.caches.open(SHARE_CACHE);
  const old = String(Date.now() - 2 * 60 * 60 * 1000);
  await cache.put(page('__shared__/old/0'), new Response('x', { headers: { 'X-Shared-At': old } }));
  await sw.fire('activate');
  assert.equal(cache.entries.size, 0);
});

test('share intake ignores bad batch ids', async () => {
  const { sw } = await installed();
  assert.deepEqual(await takeSharedFiles('../../etc', sw.caches), []);
  assert.equal(readShareParams('?other=1'), null);
  assert.equal(readShareParams('?shared=not-a-uuid').batchId, null);
});
