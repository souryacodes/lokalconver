// Runs js/engines/lib-worker.js inside a Node "vm" that looks like a Web Worker,
// so the real worker code and the real vendored libraries are tested without a browser.
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIBS } from '../../js/converters/libs.js';

const root = new URL('../../', import.meta.url);

export const vendorExists = (key) => fs.existsSync(new URL(LIBS[key].path, root));

export function startWorker() {
  const listeners = new Map();
  const ctx = {
    console, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    // Only the binary types are shared with Node, so buffers made here pass instanceof checks inside the worker.
    // Array, Object and friends must stay the context's own, or instanceof breaks in the libraries.
    ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array, DataView,
    location: { origin: 'null' },
    importScripts(url) {
      const file = fileURLToPath(url);
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    },
    postMessage(msg) { const l = listeners.get(msg.id); if (l) { listeners.delete(msg.id); l(msg); } },
  };
  ctx.self = ctx;
  ctx.__LC_DEBUG = !!process.env.LC_DEBUG;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('js/engines/lib-worker.js', root), 'utf8'), ctx, { filename: 'lib-worker.js' });
  const libs = Object.fromEntries(Object.keys(LIBS).map((k) => [k, pathToFileURL(fileURLToPath(new URL(LIBS[k].path, root))).href]));
  let id = 0;
  ctx.onmessage({ data: { id: 0, op: 'init', payload: { libs } } });
  return (op, payload) => new Promise((resolve) => {
    const myId = ++id;
    listeners.set(myId, resolve);
    ctx.onmessage({ data: { id: myId, op, payload } });
  });
}

export const sample = (name) => fs.readFileSync(new URL(`samples/${name}`, root));
export const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
