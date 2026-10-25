// image.js - the image converter (engine 'native').
//
// Pictures in:  png, jpg, gif (first frame), webp, bmp, svg, avif (if the
//               browser can open it), and heic/heif (extra decoder).
// Pictures out: jpg, png, webp, bmp, ico, avif (only if the browser can save it).
//
// How the work is split:
//   image-core.js    pure maths and file writers (tested in Node)
//   image-engine.js  drawing and saving on a canvas
//   image.worker.js  runs the engine off the main thread
//   image.js         (this file) picks the route, opens SVG/HEIC, registers
//
// Nothing here uploads anything. The only network request is the optional,
// same-origin download of the HEIC decoder file.

import { registerConverter } from '../core/registry.js';
import {
  HEIC_EXTS, INPUT_EXTS, OUTPUT_EXTS, ImageError, abortError,
  bestQualityForTarget, inferInputExt, looksLikeHeif, normalizeExt, validateOptions,
} from './image-core.js';
import { convertImage, detectSupport, rasteriseSvg } from './image-engine.js';

export { bestQualityForTarget };

// ---------- HEIC / HEIF decoder (loaded only when needed) ----------

// Package: heic-to (npm), licence LGPL-3.0 (it contains libheif). The "csp"
// build is the one that works under a strict Content-Security-Policy.
// The file is kept in our own repo (js/vendor/...) so that:
//  - the page makes no request to a third party, and
//  - the version is pinned for real.
// See js/vendor/heic-to-1.5.2/README.md for how to put the file there.
const HEIC_ENGINE_VERSION = '1.5.2';
const HEIC_ENGINE_URL = new URL(`../vendor/heic-to-${HEIC_ENGINE_VERSION}/heic-to.js`, import.meta.url);
// Used only when the server does not tell us the file size.
const HEIC_FALLBACK_KB = 3000;

let heicApi = null;
let heicSizeKB = null;

// Asks the server how big the decoder file is (a tiny HEAD request).
async function measureHeicEngineKB() {
  if (heicSizeKB !== null) return heicSizeKB;
  try {
    const res = await fetch(HEIC_ENGINE_URL, { method: 'HEAD' });
    if (res.status === 404) {
      throw new ImageError(`The HEIC decoder file is missing from this site (js/vendor/heic-to-${HEIC_ENGINE_VERSION}/heic-to.js).`);
    }
    const bytes = Number(res.headers.get('content-length'));
    heicSizeKB = bytes > 0 ? Math.ceil(bytes / 1000) : HEIC_FALLBACK_KB;
  } catch (err) {
    if (err instanceof ImageError) throw err;
    heicSizeKB = HEIC_FALLBACK_KB; // offline or odd server: use the estimate
  }
  return heicSizeKB;
}

async function loadHeicEngine(onProgress) {
  if (heicApi) return heicApi;
  const kb = await measureHeicEngineKB();
  // The visitor sees this BEFORE the download starts.
  onProgress(0.02, `Downloading engine: ${kb} KB (once)`);
  const mod = await import(HEIC_ENGINE_URL.href);
  const api = mod.heicTo ? mod : mod.default?.heicTo ? mod.default : null;
  if (!api) throw new ImageError('The HEIC decoder loaded, but it is not the file we expected.');
  heicApi = api;
  return api;
}

// Opens a HEIC photo. Returns an ImageBitmap, or the original file when it
// is not really a HEIC (a JPEG renamed to .heic still works that way).
async function openHeic(file, onProgress) {
  // Safari can open HEIC itself. Then no download is needed at all.
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Chrome, Edge and Firefox cannot. Use the decoder.
  }
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!looksLikeHeif(head)) return file;
  const api = await loadHeicEngine(onProgress);
  onProgress(0.2, 'Opening HEIC photo');
  try {
    // The decoder turns the photo upright itself, so we ask for nothing more.
    // It runs in its own worker, so the page stays smooth.
    return await api.heicTo({ blob: file, type: 'bitmap' });
  } catch (err) {
    throw new ImageError(`Could not open this HEIC photo (${err?.message ?? 'unknown error'}).`);
  }
}

// ---------- Running a job ----------

function isBitmap(x) {
  return typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap;
}

// Starts a worker, passes the job, waits. Cancelling kills the worker.
function runInWorker(payload, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let worker;
    try {
      worker = new Worker(new URL('./image.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      return reject(Object.assign(new Error('no worker'), { workerUnavailable: true, cause: err }));
    }
    const transfer = isBitmap(payload.source) ? [payload.source] : [];
    let started = false;
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e) => {
      started = true;
      const m = e.data;
      if (m.type === 'progress') {
        onProgress(m.value, m.text);
      } else if (m.type === 'done') {
        finish();
        resolve({ blob: m.blob, info: m.info });
      } else if (m.type === 'error') {
        finish();
        reject(new ImageError(m.message, m.code));
      }
    };
    worker.onerror = () => {
      finish();
      // If the picture was already handed over we cannot retry on the page.
      reject(Object.assign(new Error('worker failed'), {
        workerUnavailable: !started && transfer.length === 0,
      }));
    };
    worker.postMessage(payload, transfer);
  });
}

async function runImageJob(job, onProgress = () => {}, signal) {
  const fromExt = job.fromExt ? normalizeExt(job.fromExt) : inferInputExt(job.file);
  const toExt = normalizeExt(job.toExt);
  const checked = validateOptions(job.options ?? {}, toExt);
  if (!checked.ok) throw new ImageError(checked.errors.join(' '));

  const support = await detectSupport();
  if ((toExt === 'webp' || toExt === 'avif') && !support.encode[toExt]) {
    throw new ImageError(`This browser cannot save ${toExt.toUpperCase()} files. Pick another format.`);
  }

  const notes = [];
  let options = checked.options;
  let source = job.file;

  // SVG and HEIC are opened here on the page; the worker gets a ready bitmap.
  if (fromExt === 'svg') {
    onProgress(0.03, 'Drawing SVG');
    source = await rasteriseSvg(job.file, options.resize, notes);
    options = { ...options, resize: { mode: 'none' } }; // already at its final size
  } else if (HEIC_EXTS.includes(fromExt)) {
    source = await openHeic(job.file, onProgress);
  }

  const payload = {
    source,
    ext: fromExt,
    toExt,
    options,
    target: options.maxKB ? { maxKB: options.maxKB } : null,
  };

  let result;
  const canUseWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  try {
    if (!canUseWorker) throw Object.assign(new Error('no worker'), { workerUnavailable: true });
    result = await runInWorker(payload, onProgress, signal);
  } catch (err) {
    if (!err.workerUnavailable) throw err;
    // Older browser: do the work on the page. It may pause for a moment.
    notes.push('This browser could not use a background worker, so the page may pause while converting.');
    result = await convertImage({ ...payload, onProgress, signal });
  }

  // The job object carries the extra facts for the UI and the Receipt card.
  job.notes = [...notes, ...result.info.notes];
  job.resultInfo = {
    width: result.info.width,
    height: result.info.height,
    bytes: result.info.bytes,
    quality: result.info.quality,
    fits: result.info.fits,
    message: result.info.message,
  };
  return result.blob;
}

// ---------- Public helper: "make this picture fit under N KB" ----------

// Returns { blob, fits, message, width, height, bytes, quality }.
// If the target cannot be reached without ruining the picture, `fits` is
// false, `blob` is the smallest result, and `message` says so plainly.
export async function compressToTarget(file, { maxKB, format = 'jpg', resize, background, onProgress, signal } = {}) {
  if (!(Number(maxKB) >= 1)) throw new ImageError('Give a target size in KB (1 or more).');
  const job = {
    file,
    fromExt: inferInputExt(file),
    toExt: format,
    options: { maxKB, resize, background },
  };
  const blob = await runImageJob(job, onProgress ?? (() => {}), signal);
  return { blob, notes: job.notes, ...job.resultInfo };
}

// ---------- Registering ----------

// These arrays are changed in place once the browser tests finish, so any
// code that already holds a reference sees the final list.
const FROM = [...INPUT_EXTS];
const TO = [...OUTPUT_EXTS];

const ready = detectSupport().then((support) => {
  const outputs = ['jpg', 'png'];
  if (support.encode.webp) outputs.push('webp');
  if (support.encode.avif) outputs.push('avif'); // only if the browser can really save it
  outputs.push('bmp', 'ico');
  TO.splice(0, TO.length, ...outputs);
  if (!support.decodeAvif) FROM.splice(FROM.indexOf('avif'), 1);
  return support;
});

export const imageConverter = {
  id: 'image-native',
  from: FROM,
  to: TO,
  engine: 'native',
  ready,
  estimate: () => ({ downloadKB: 0 }),
  load: () => ready.then(() => undefined),
  run: runImageJob,
};

// HEIC/HEIF go through the same pipeline once they are opened, so every
// image output is available. The decoder is "Tier 2" (WebAssembly/asm.js).
export const heicConverter = {
  id: 'image-heic',
  from: [...HEIC_EXTS],
  to: TO,
  engine: 'wasm',
  ready,
  // Safari opens HEIC itself, so this is the most it can cost.
  estimate: () => ({ downloadKB: heicApi ? 0 : heicSizeKB ?? HEIC_FALLBACK_KB }),
  load: () => ready.then(() => undefined),
  run: runImageJob,
};

registerConverter(imageConverter);
registerConverter(heicConverter);
