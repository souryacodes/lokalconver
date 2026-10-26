// "Download all as ZIP". fflate is vendored at an exact version
// (js/vendor/fflate-0.8.3.js, MIT) and only loaded when someone asks for a ZIP.
// We use its streaming Zip class, which is synchronous and needs no Web Worker
// (so no blob: worker, and it works with a strict Content-Security-Policy).
// To keep the page smooth we hand the files over one at a time and yield
// between them, and we only compress small text-like files.
import { extOf } from './format.js';

const DEFLATE_EXTS = new Set(['svg', 'txt', 'csv', 'json', 'md', 'html']);
const DEFLATE_MAX_BYTES = 8 * 1024 * 1024;

// Photos, PDFs, audio and video are already compressed: store them as they are.
export function shouldDeflate(path, size) {
  return DEFLATE_EXTS.has(extOf(path)) && size <= DEFLATE_MAX_BYTES;
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

// entries: [{ path: 'photos/a.jpg', blob }]  ->  Blob (application/zip)
export async function buildZip(entries, { onProgress, signal } = {}) {
  const { Zip, ZipPassThrough, ZipDeflate } = await import('../vendor/fflate-0.8.3.js');
  const chunks = [];
  let failure = null;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });

  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err; else chunks.push(chunk);
    if (final) finish();
  });

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) { zip.terminate?.(); throw new DOMException('Cancelled', 'AbortError'); }
    const { path, blob } = entries[i];
    const data = new Uint8Array(await blob.arrayBuffer());
    const file = shouldDeflate(path, data.length) ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(file);
    file.push(data, true);
    onProgress?.((i + 1) / entries.length);
    await nextTurn();
  }
  zip.end();
  await finished;
  if (failure) throw failure;
  return new Blob(chunks, { type: 'application/zip' });
}
