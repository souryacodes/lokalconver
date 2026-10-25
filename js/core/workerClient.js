// workerClient.js - the page side of worker.js.
//
// run(converter, job, onProgress, signal) is a "runner" for jobs.js:
//   createJobQueue({ runner: createWorkerClient().run })
//
// It uses a Web Worker when the converter supports one (converter.worker) and
// the browser has the features it needs (for example OffscreenCanvas).
// Otherwise, or if the worker cannot start, it runs on the main thread.
//
// Cancel: the worker is told to stop AND terminated. Terminating is the only
// way to stop heavy WebAssembly work that never checks the signal.

import { mainThreadRunner } from './jobs.js';

// What a converter may ask for in worker.needs. Unknown names count as "no".
export const FEATURE_TESTS = Object.freeze({
  Worker: () => typeof Worker === 'function',
  OffscreenCanvas: () => typeof OffscreenCanvas === 'function',
  createImageBitmap: () => typeof createImageBitmap === 'function',
  WebAssembly: () => typeof WebAssembly === 'object',
});

export function supportsFeatures(needs, tests = FEATURE_TESTS) {
  return needs.every((name) => {
    const test = tests[name];
    return typeof test === 'function' && Boolean(test());
  });
}

function defaultCreateWorker() {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

// Errors cross the worker border as plain objects. Make a real Error again.
function rebuildError(data = {}) {
  const err = new Error(data.message ?? '');
  err.name = data.name ?? 'Error';
  for (const key of ['code', 'userMessage', 'retryable', 'bytes', 'limitBytes']) {
    if (data[key] !== undefined) err[key] = data[key];
  }
  return err;
}

/**
 * options:
 *   createWorker   () => Worker       (tests pass a fake)
 *   featureTests   { name: () => bool }
 *   maxIdle        how many finished workers to keep warm (default 2)
 */
export function createWorkerClient({ createWorker = defaultCreateWorker, featureTests = FEATURE_TESTS, maxIdle = 2 } = {}) {
  const idle = [];
  const busy = new Set();
  const proven = new WeakSet(); // workers that have answered at least once
  let broken = false; // true once a fresh worker failed to start

  function canUseWorker(converter) {
    if (broken || !converter?.worker) return false;
    return supportsFeatures(['Worker', ...converter.worker.needs], featureTests);
  }

  function run(converter, job, onProgress, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (!canUseWorker(converter)) return mainThreadRunner(converter, job, onProgress, signal);

    let worker;
    try {
      worker = idle.pop() ?? createWorker();
    } catch {
      broken = true; // for example the CSP or file:// blocks workers
      return mainThreadRunner(converter, job, onProgress, signal);
    }
    busy.add(worker);

    return new Promise((resolve, reject) => {
      let settled = false;
      let heard = false;

      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onMessageError);
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      // Keep a healthy worker for the next job; its engine is already loaded.
      const release = () => {
        busy.delete(worker);
        if (idle.length < maxIdle) idle.push(worker);
        else worker.terminate();
      };
      const discard = () => {
        busy.delete(worker);
        worker.terminate();
      };
      const fallBack = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (signal?.aborted) reject(abortError());
        else mainThreadRunner(converter, job, onProgress, signal).then(resolve, reject);
      };

      function onMessage(event) {
        const message = event.data;
        if (!message || message.id !== job.id) return;
        heard = true;
        proven.add(worker);
        if (message.type === 'progress') {
          onProgress?.(message.value);
        } else if (message.type === 'done') {
          release();
          settle(resolve, message.blob);
        } else if (message.type === 'error') {
          release();
          settle(reject, rebuildError(message.error));
        }
      }

      function onError(event) {
        event?.preventDefault?.();
        discard();
        // A worker that never spoke could not start: stop using workers.
        if (!heard && !proven.has(worker)) {
          broken = true;
          fallBack();
        } else {
          settle(reject, new Error('The background worker stopped unexpectedly.'));
        }
      }

      function onMessageError() {
        discard();
        settle(reject, new Error('The background worker sent something we could not read.'));
      }

      function onAbort() {
        try {
          worker.postMessage({ type: 'cancel', id: job.id });
        } catch {
          // The worker is about to be terminated anyway.
        }
        discard();
        settle(reject, abortError());
      }

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onMessageError);
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        worker.postMessage({
          type: 'run',
          id: job.id,
          converterId: converter.id,
          converterModule: converter.worker.module,
          job: {
            id: job.id,
            file: job.file,
            fromExt: job.fromExt,
            toExt: job.toExt,
            options: job.options,
            bytesIn: job.bytesIn,
          },
        });
      } catch {
        // Something in the job cannot be copied to a worker (for example a
        // function inside options). The main thread can still do it.
        release();
        fallBack();
      }
    });
  }

  function dispose() {
    for (const worker of [...idle, ...busy]) worker.terminate();
    idle.length = 0;
    busy.clear();
  }

  return {
    run,
    dispose,
    canUseWorker,
    stats: () => ({ idle: idle.length, busy: busy.size, broken }),
  };
}
