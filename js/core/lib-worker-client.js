// Talks to js/engines/lib-worker.js.
// Every call gets its OWN worker, and the worker is stopped when the call ends.
// Why: the Convert page runs two files at once. With one shared worker, cancelling
// file A would also stop file B. With one worker per call, cancelling stops only A,
// and the memory used by the big libraries is given back as soon as the job is done.
import { ConvertError } from './errors.js';
import { libUrls } from '../converters/libs.js';

const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError' });

export function callWorker(op, payload, { signal, transfer = [] } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('../engines/lib-worker.js', import.meta.url));
    } catch {
      reject(new ConvertError('ENGINE_FAILED', 'This browser could not start the conversion engine. Try a recent Chrome, Edge, Firefox or Safari.'));
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      return true;
    };
    const onAbort = () => { if (finish()) reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (e) => {
      const { ok, result, error } = e.data;
      if (!finish()) return;
      if (ok) resolve(result);
      else reject(new ConvertError(error.code, error.message));
    };
    worker.onerror = () => {
      if (finish()) reject(new ConvertError('ENGINE_FAILED', 'The conversion engine stopped unexpectedly. Try again, or try a smaller file.'));
    };
    worker.postMessage({ id: 0, op: 'init', payload: { libs: libUrls() } });
    worker.postMessage({ id: 1, op, payload }, transfer);
  });
}
