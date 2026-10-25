// registry.js - the list of everything LokalConver can convert.
//
// A converter says: "I turn these formats into those formats, using this
// engine". The router rule from AGENTS.md is: always use the LIGHTEST engine
// that can do the job. Lower tier = lighter:
//   0 native browser API, 1 small JS library, 2 WebAssembly, 3 Python Bridge.
//
// Converter shape (from PROJECT_BRIEF.md):
//   { id, from: ['heic'], to: ['jpg','png'], engine,
//     estimate(file) -> { downloadKB }, load(), run(job, onProgress, signal) -> Blob }
// Optional extra field:
//   worker: { module: <absolute URL string>, needs: ['OffscreenCanvas'] }
//     Says "this converter can run inside a Web Worker". `module` must export
//     the same converter as `converter` (or in a `converters` array) and must
//     not touch the DOM. Build the URL with new URL('./x.js', import.meta.url).href.

import { normalizeExt } from './detect.js';

export const ENGINE_TIERS = Object.freeze({ native: 0, js: 1, wasm: 2, bridge: 3 });

// "Most likely wanted" target for each source format. The first entry that is
// really registered wins. This is only a table: tune it as we learn more.
export const SUGGESTIONS = Object.freeze({
  // images
  heic: ['jpg', 'png', 'webp'],
  heif: ['jpg', 'png', 'webp'],
  avif: ['jpg', 'png', 'webp'],
  webp: ['png', 'jpg'],
  png: ['webp', 'jpg', 'pdf'],
  jpg: ['pdf', 'webp', 'png'],
  gif: ['png', 'webp', 'jpg'],
  bmp: ['png', 'jpg', 'webp'],
  svg: ['png', 'jpg', 'webp', 'pdf'],
  ico: ['png'],
  // documents
  pdf: ['png', 'jpg', 'txt'],
  docx: ['txt', 'html', 'md', 'pdf'],
  pptx: ['pdf'],
  md: ['html', 'pdf'],
  txt: ['pdf'],
  // data
  csv: ['json'],
  json: ['csv'],
  xlsx: ['csv', 'json'],
  // audio
  wav: ['mp3', 'ogg', 'flac', 'm4a'],
  mp3: ['wav', 'ogg', 'm4a', 'flac'],
  ogg: ['mp3', 'wav'],
  m4a: ['mp3', 'wav'],
  flac: ['mp3', 'wav', 'ogg', 'm4a'],
  // video
  mov: ['mp4', 'webm', 'mp3'],
  mp4: ['mp3', 'webm', 'gif'],
  webm: ['mp4', 'mp3', 'gif'],
  mkv: ['mp4', 'webm', 'mp3'],
});

function cleanExtList(value, label) {
  const list = (Array.isArray(value) ? value : [value]).map(normalizeExt).filter(Boolean);
  if (list.length === 0) {
    throw new TypeError(`registerConverter: "${label}" needs at least one format.`);
  }
  return [...new Set(list)];
}

function cleanWorker(worker) {
  if (worker == null) return null;
  const module = String(worker.module ?? '');
  if (!module) throw new TypeError('registerConverter: worker.module must be a URL string.');
  const needs = Array.isArray(worker.needs) ? worker.needs.map(String) : [];
  return { module, needs };
}

function validate(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('registerConverter: expected an object.');
  }
  if (typeof spec.id !== 'string' || spec.id.trim() === '') {
    throw new TypeError('registerConverter: "id" must be a non-empty string.');
  }
  if (!(spec.engine in ENGINE_TIERS)) {
    throw new TypeError(
      `registerConverter: "engine" must be one of ${Object.keys(ENGINE_TIERS).join(', ')}.`,
    );
  }
  if (typeof spec.run !== 'function') {
    throw new TypeError('registerConverter: "run" must be a function.');
  }
  return {
    ...spec,
    id: spec.id.trim(),
    from: cleanExtList(spec.from, 'from'),
    to: cleanExtList(spec.to, 'to'),
    tier: ENGINE_TIERS[spec.engine],
    estimate: typeof spec.estimate === 'function' ? spec.estimate : () => ({ downloadKB: 0 }),
    load: typeof spec.load === 'function' ? spec.load : async () => {},
    worker: cleanWorker(spec.worker),
  };
}

// An estimate must never break the screen: a bad answer becomes "unknown".
function safeDownloadKB(converter, file) {
  try {
    const kb = converter.estimate(file)?.downloadKB;
    return Number.isFinite(kb) && kb >= 0 ? kb : null;
  } catch {
    return null;
  }
}

/** Make an isolated registry. Tests use this; the app uses the default one. */
export function createRegistry() {
  const converters = []; // registration order matters: it breaks ties

  function registerConverter(spec) {
    const converter = validate(spec);
    if (converters.some((c) => c.id === converter.id)) {
      throw new Error(`Converter "${converter.id}" is already registered.`);
    }
    converters.push(converter);
    return converter;
  }

  /** Every converter that can go from -> to, lightest engine first. */
  function findConverters(fromExt, toExt) {
    const from = normalizeExt(fromExt);
    const to = normalizeExt(toExt);
    if (!from || !to || from === to) return [];
    return converters
      .filter((c) => c.from.includes(from) && c.to.includes(to))
      .sort((a, b) => a.tier - b.tier); // sort is stable: ties keep registration order
  }

  /** The converter the router would use for from -> to, or null. */
  function getConverter(fromExt, toExt) {
    return findConverters(fromExt, toExt)[0] ?? null;
  }

  /**
   * Possible targets for a source format.
   * Each: { ext, converterId, engine, tier, downloadKB } (downloadKB null = unknown).
   * Pass the file to get a size estimate that fits it.
   */
  function findTargets(fromExt, file = null) {
    const from = normalizeExt(fromExt);
    const best = new Map(); // target ext -> lightest converter
    for (const c of converters) {
      if (!c.from.includes(from)) continue;
      for (const to of c.to) {
        if (to === from) continue;
        const current = best.get(to);
        if (!current || c.tier < current.tier) best.set(to, c);
      }
    }
    return [...best.entries()]
      .map(([ext, c]) => ({
        ext,
        converterId: c.id,
        engine: c.engine,
        tier: c.tier,
        downloadKB: safeDownloadKB(c, file),
      }))
      .sort((a, b) => a.tier - b.tier); // stable: first registered stays first
  }

  /** The one target we would pre-select, or null when nothing is possible. */
  function suggestTarget(fromExt, file = null) {
    const from = normalizeExt(fromExt);
    const targets = findTargets(from, file);
    if (targets.length === 0) return null;
    for (const ext of SUGGESTIONS[from] ?? []) {
      const hit = targets.find((t) => t.ext === ext);
      if (hit) return hit;
    }
    return targets[0]; // not in our table: fall back to the lightest engine
  }

  function listConverters() {
    return [...converters];
  }

  function clear() {
    converters.length = 0;
  }

  return { registerConverter, findConverters, getConverter, findTargets, suggestTarget, listConverters, clear };
}

// ------------------------------------------------ load once per converter

const loading = new WeakMap();

/**
 * Call converter.load() once and share the answer. If it fails, forget the
 * failure so a retry can try again (for example after the network is back).
 */
export function ensureLoaded(converter) {
  let promise = loading.get(converter);
  if (!promise) {
    promise = Promise.resolve().then(() => converter.load());
    loading.set(converter, promise);
    promise.catch(() => {
      if (loading.get(converter) === promise) loading.delete(converter);
    });
  }
  return promise;
}

// ------------------------------------------------ the app-wide registry

export const defaultRegistry = createRegistry();
export const registerConverter = defaultRegistry.registerConverter;
export const findConverters = defaultRegistry.findConverters;
export const getConverter = defaultRegistry.getConverter;
export const findTargets = defaultRegistry.findTargets;
export const suggestTarget = defaultRegistry.suggestTarget;
export const listConverters = defaultRegistry.listConverters;
