// Small helpers for running conversions. No DOM here either.

export function abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

// Reject the moment the signal fires, even if the converter ignores the signal.
// The converter may keep working in the background, but its result is dropped
// and the user sees "Cancelled" straight away.
export function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

// Show the converter's own message when it is short and readable.
// Otherwise say something plain. Never show a stack trace to a visitor.
export function friendlyError(err) {
  const message = typeof err?.message === 'string' ? err.message.trim() : '';
  if (message && message.length <= 140 && !/\n|\bat .*:\d+/.test(message)) return message;
  return 'Something went wrong while converting this file. You can try again.';
}

// Runs fn(item) for every item, `limit` at a time. One failure never stops the rest.
export async function runPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try { await fn(item); } catch { /* fn reports its own errors */ }
    }
  });
  await Promise.all(workers);
}
