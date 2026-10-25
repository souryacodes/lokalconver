// jobs.js - the queue that runs conversions.
//
// - Runs N jobs at the same time (see defaultConcurrency).
// - Tells the page what happens through events.
// - Cancel works through AbortController. Retry puts a failed job back.
// - One failed job NEVER stops the others.
// - Errors become short plain-language messages (friendlyError).
//
// Pure logic: no DOM. A `runner` decides WHERE a converter runs (main thread
// by default, or a Web Worker through workerClient.js).

import { extOf, normalizeExt } from './detect.js';
import { defaultRegistry, ensureLoaded } from './registry.js';
import { MemoryLimitError, createMemoryGuard, formatBytes } from './safe.js';

// ---------------------------------------------------------------- errors

/**
 * Throw this from a converter when you already know the user-facing reason.
 *   throw new ConvertError('password-protected', 'This PDF needs a password.')
 * `code` is a stable key, so i18n can translate the message later.
 */
export class ConvertError extends Error {
  constructor(code, userMessage, { retryable = false } = {}) {
    super(userMessage);
    this.name = 'ConvertError';
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = retryable;
  }
}

const OUT_OF_MEMORY = /out of memory|cannot enlarge memory|\bOOM\b|array buffer allocation|invalid array length|could not allocate/i;
const LOAD_FAILED = /dynamically imported module|importing a module script|failed to fetch|networkerror|load failed/i;

/**
 * Turn any thrown value into { code, message, retryable }.
 * The message never contains file names or file content.
 */
export function friendlyError(err) {
  const name = err?.name ?? '';
  const text = String(err?.message ?? '');

  if (err instanceof ConvertError || (typeof err?.userMessage === 'string' && err.userMessage)) {
    return {
      code: err.code ?? 'convert-error',
      message: err.userMessage,
      retryable: Boolean(err.retryable),
    };
  }
  if (err instanceof MemoryLimitError || err?.code === 'too-large') {
    const detail =
      Number.isFinite(err.bytes) && Number.isFinite(err.limitBytes)
        ? ` This file is ${formatBytes(err.bytes)}; the limit here is ${formatBytes(err.limitBytes)}.`
        : '';
    return { code: 'too-large', message: `This file is too big for this device.${detail} Try a smaller file.`, retryable: false };
  }
  if (name === 'AbortError') {
    return { code: 'cancelled', message: 'Cancelled.', retryable: true };
  }
  if (name === 'QuotaExceededError' || OUT_OF_MEMORY.test(text) || (name === 'RangeError' && /memory|allocat/i.test(text))) {
    return {
      code: 'out-of-memory',
      message: 'Your device ran out of memory. Close other tabs, or try a smaller file.',
      retryable: true,
    };
  }
  if (name === 'NotSupportedError') {
    return {
      code: 'unsupported',
      message: 'Your browser cannot do this conversion yet. Try a recent Chrome, Edge, Firefox or Safari.',
      retryable: false,
    };
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return { code: 'blocked', message: 'Your browser blocked this step. Please try again.', retryable: true };
  }
  if (name === 'EncodingError' || name === 'DataError' || name === 'InvalidStateError') {
    return {
      code: 'unreadable',
      message: 'We could not read this file. It may be damaged, or it may not be the type its name says.',
      retryable: false,
    };
  }
  if (err instanceof TypeError && LOAD_FAILED.test(text)) {
    return {
      code: 'engine-load-failed',
      message: 'The converter could not be loaded. Check your internet connection and try again.',
      retryable: true,
    };
  }
  return {
    code: 'unknown',
    message: 'Something went wrong. Your file stays on your device. You can try again.',
    retryable: true,
  };
}

// ---------------------------------------------------------------- concurrency

/** min(4, cores - 1), never below 1. Unknown core count counts as 2. */
export function defaultConcurrency(cores = globalThis.navigator?.hardwareConcurrency) {
  const count = Number.isFinite(cores) && cores > 0 ? cores : 2;
  return Math.max(1, Math.min(4, count - 1));
}

// ---------------------------------------------------------------- runners

/** Run a converter on the main thread. Fine for light work; heavy work should use a worker. */
export async function mainThreadRunner(converter, job, onProgress, signal) {
  await ensureLoaded(converter);
  return converter.run(job, onProgress, signal);
}

function looksLikeBlob(value) {
  return value != null && typeof value.size === 'number' && typeof value.arrayBuffer === 'function';
}

// ---------------------------------------------------------------- the queue

/**
 * Create a queue.
 * options: { registry, runner, concurrency, memoryGuard }
 *
 * Job: { id, file, fromExt, toExt, options, engine, converterId, status,
 *        progress, bytesIn, bytesOut, resultBlob, error, warning, attempts }
 * status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
 * error:  { code, message, retryable } or null
 *
 * Jobs are live objects. The page may read them but must not change them.
 *
 * Events (queue.on(type, fn) returns an unsubscribe function; fn gets the job):
 *   added, start, progress, warning, done, error, cancelled, update (every
 *   change), idle (nothing queued, nothing running).
 */
export function createJobQueue(options = {}) {
  const {
    registry = defaultRegistry,
    runner = mainThreadRunner,
    concurrency = defaultConcurrency(),
    memoryGuard = createMemoryGuard(),
  } = options;
  const limit = Math.max(1, Math.floor(concurrency));

  const jobs = new Map(); // id -> job
  const waiting = []; // ids in the order they were added
  const running = new Map(); // id -> AbortController
  const listeners = new Map(); // event type -> Set of fn
  const idleWaiters = [];
  let counter = 0;

  // -- events --

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function emit(type, job) {
    // Every job event also counts as an 'update'. 'idle' has no job, so it stands alone.
    for (const t of type === 'update' || type === 'idle' ? [type] : [type, 'update']) {
      for (const fn of [...(listeners.get(t) ?? [])]) {
        try {
          fn(job);
        } catch (err) {
          // A broken listener must not break the queue.
          console.error('Job listener failed:', err?.name);
        }
      }
    }
  }

  // -- state changes --

  function fail(job, err) {
    job.status = 'error';
    job.error = friendlyError(err);
    job.resultBlob = null;
    emit('error', job);
  }

  function makeJob({ file, fromExt, toExt, options: jobOptions = {} }) {
    if (!file || typeof file.size !== 'number') {
      throw new TypeError('queue.add: "file" must be a File or Blob.');
    }
    counter += 1;
    const from = normalizeExt(fromExt ?? extOf(file.name));
    return {
      id: `job-${counter}`,
      file,
      fromExt: from,
      toExt: normalizeExt(toExt),
      options: jobOptions,
      engine: null,
      converterId: null,
      status: 'queued',
      progress: 0,
      bytesIn: file.size,
      bytesOut: 0,
      resultBlob: null,
      error: null,
      warning: null,
      attempts: 0,
    };
  }

  function resolveConverter(job) {
    const converter = registry.getConverter(job.fromExt, job.toExt);
    if (converter) {
      job.engine = converter.engine;
      job.converterId = converter.id;
    }
    return converter;
  }

  function add(spec) {
    const job = makeJob(spec);
    jobs.set(job.id, job);
    emit('added', job);
    if (!resolveConverter(job)) {
      fail(job, new ConvertError('no-converter', `We cannot convert ${job.fromExt || 'this file'} to ${job.toExt || 'that format'} yet.`));
      return job;
    }
    waiting.push(job.id);
    pump();
    return job;
  }

  async function start(job) {
    const controller = new AbortController();
    running.set(job.id, controller);
    job.status = 'running';
    job.progress = 0;
    job.error = null;
    job.warning = null;
    job.attempts += 1;
    emit('start', job);

    // After cancel() the job leaves `running`; anything the old run says is ignored.
    const current = () => running.get(job.id) === controller;

    try {
      const converter = registry.getConverter(job.fromExt, job.toExt);
      if (!converter) throw new ConvertError('no-converter', 'We cannot convert this file yet.');

      const guard = memoryGuard.check(job.bytesIn);
      if (guard.level === 'block') throw new MemoryLimitError(guard.bytes, guard.limitBytes);
      if (guard.level === 'warn') {
        job.warning = guard.message;
        emit('warning', job);
      }

      const onProgress = (value) => {
        if (!current() || typeof value !== 'number' || Number.isNaN(value)) return;
        job.progress = Math.min(1, Math.max(0, value));
        emit('progress', job);
      };

      const blob = await runner(converter, job, onProgress, controller.signal);
      if (!current()) return;
      if (!looksLikeBlob(blob)) {
        throw new ConvertError('bad-result', 'The converter finished but gave no file. Please try again.', { retryable: true });
      }
      job.resultBlob = blob;
      job.bytesOut = blob.size;
      job.progress = 1;
      job.status = 'done';
      emit('done', job);
    } catch (err) {
      if (!current()) return;
      fail(job, err);
    } finally {
      if (current()) running.delete(job.id);
      pump();
    }
  }

  function pump() {
    while (running.size < limit && waiting.length > 0) {
      const job = jobs.get(waiting.shift());
      if (job && job.status === 'queued') start(job);
    }
    if (running.size === 0 && waiting.length === 0) {
      emit('idle', null);
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  }

  // -- actions --

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      emit('cancelled', job);
      pump();
      return true;
    }
    if (job.status === 'running') {
      const controller = running.get(id);
      running.delete(id); // frees the slot at once, even if the converter ignores the signal
      job.status = 'cancelled';
      job.resultBlob = null;
      emit('cancelled', job);
      controller?.abort();
      pump();
      return true;
    }
    return false;
  }

  function cancelAll() {
    for (const job of [...jobs.values()]) cancel(job.id);
  }

  /** Put a failed or cancelled job back in the queue. */
  function retry(id) {
    const job = jobs.get(id);
    if (!job || (job.status !== 'error' && job.status !== 'cancelled')) return false;
    job.status = 'queued';
    job.progress = 0;
    job.error = null;
    job.warning = null;
    job.resultBlob = null;
    job.bytesOut = 0;
    emit('update', job);
    if (!resolveConverter(job)) {
      fail(job, new ConvertError('no-converter', `We cannot convert ${job.fromExt || 'this file'} to ${job.toExt || 'that format'} yet.`));
      return true;
    }
    waiting.push(job.id);
    pump();
    return true;
  }

  /** Forget a job and let its result be garbage collected. */
  function remove(id) {
    const job = jobs.get(id);
    if (!job) return false;
    cancel(id);
    job.resultBlob = null;
    jobs.delete(id);
    return true;
  }

  function whenIdle() {
    const busy = running.size > 0 || waiting.some((id) => jobs.get(id)?.status === 'queued');
    return busy ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
  }

  return {
    add,
    cancel,
    cancelAll,
    retry,
    remove,
    whenIdle,
    on,
    get: (id) => jobs.get(id),
    jobs: () => [...jobs.values()],
    concurrency: limit,
  };
}
