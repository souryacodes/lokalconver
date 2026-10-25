// worker.js - runs converters inside a module Web Worker, off the main thread,
// so the page never freezes.
//
// Messages from the page (see workerClient.js):
//   { type: 'run', id, converterId, converterModule, job }
//   { type: 'cancel', id }
// Messages back to the page:
//   { type: 'progress', id, value }
//   { type: 'done', id, blob }
//   { type: 'error', id, error: { name, message, code, userMessage, retryable } }
//
// Rules for a converter that runs here: no DOM (no document, no window), and
// job.options must be plain data. A File or Blob is fine: it is passed by
// reference, not copied.
//
// The page must allow this with a CSP like: script-src 'self'; worker-src 'self'

/** Keep only what is safe and useful to send back. Never a file name. */
function serializeError(err) {
  return {
    name: String(err?.name ?? 'Error'),
    message: String(err?.message ?? ''),
    code: err?.code,
    userMessage: err?.userMessage,
    retryable: err?.retryable,
    bytes: err?.bytes,
    limitBytes: err?.limitBytes,
  };
}

function pickConverter(mod, converterId) {
  const list = Array.isArray(mod?.converters) ? mod.converters : [mod?.converter ?? mod?.default];
  return list.find((c) => c && c.id === converterId && typeof c.run === 'function') ?? null;
}

/**
 * Build the message handler. `importModule` is a parameter so tests can run
 * the whole protocol in Node without a browser.
 */
export function createHandler(importModule = (url) => import(url)) {
  const active = new Map(); // job id -> AbortController

  async function runOne(message, post) {
    const { id, converterId, converterModule, job } = message;
    const controller = new AbortController();
    active.set(id, controller);
    try {
      const mod = await importModule(converterModule);
      const converter = pickConverter(mod, converterId);
      if (!converter) throw new Error('Converter module does not export the converter.');
      // Load inside the worker: this is where an engine library is needed.
      if (typeof converter.load === 'function') await converter.load();
      if (controller.signal.aborted) return;
      const blob = await converter.run(
        { ...job },
        (value) => post({ type: 'progress', id, value }),
        controller.signal,
      );
      if (!controller.signal.aborted) post({ type: 'done', id, blob });
    } catch (err) {
      if (!controller.signal.aborted) post({ type: 'error', id, error: serializeError(err) });
    } finally {
      active.delete(id);
    }
  }

  return function handle(message, post) {
    if (message?.type === 'cancel') {
      active.get(message.id)?.abort();
      return undefined;
    }
    if (message?.type === 'run') return runOne(message, post);
    return undefined;
  };
}

// Only wire up messages when this file really is a worker. Importing it in
// Node (for tests) does nothing.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const handle = createHandler();
  globalThis.addEventListener('message', (event) => {
    handle(event.data, (message) => globalThis.postMessage(message));
  });
}
