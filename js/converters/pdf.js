// js/converters/pdf.js
// The PDF toolkit. Everything runs in the visitor's browser.
//
// Tier 1 engines, all loaded lazily with PINNED exact versions:
//   pdf-lib   (MIT)         build and change PDFs: merge, split, rotate, images to PDF
//   pdf.js    (Apache-2.0)  read and draw PDFs: to PNG/JPG, to text, compress
//   fflate    (MIT)         ZIP files for results with many files
//
// Nothing here downloads anything when the page loads. A library is fetched
// the first time a PDF action asks for it (load() or run()).
//
// The pure parts (ranges, page-size maths) live in pdf-utils.js so Node can
// test them.

import {
  PdfError,
  MSG_LOCKED,
  MSG_NO_TEXT,
  MAX_CANVAS_PIXELS,
  parseRangeGroups,
  parseRanges,
  describePages,
  getPageSize,
  placeImage,
  limitLongestSide,
  safeRenderScale,
  dpiToScale,
  pickQualityForTarget,
  estimateBytesAtQuality,
  safeBaseName,
  padPageNumber,
  addRotation,
} from './pdf-utils.js';

export { PdfError } from './pdf-utils.js';

// ------------------------------------------------------ pinned libraries

// Every version below is an exact number, and each is more than two weeks
// old (pdfjs-dist 6.4.299 came out on 2026-10-03). To change one, edit the
// number here AND in docs/LICENSES.md.
const PDFJS_VERSION = '6.4.299';
const PDFLIB_VERSION = '1.17.1';
const FFLATE_VERSION = '0.8.2';
const CDN = 'https://cdn.jsdelivr.net/npm/';

// Where the files come from. Tests (or a future self-hosted copy) can
// replace these with configurePdfLibs().
const libUrls = {
  // Folder with build/, legacy/, cmaps/, standard_fonts/, wasm/, iccs/.
  pdfjsRoot: `${CDN}pdfjs-dist@${PDFJS_VERSION}/`,
  pdfLib: `${CDN}pdf-lib@${PDFLIB_VERSION}/dist/pdf-lib.esm.min.js`,
  fflate: `${CDN}fflate@${FFLATE_VERSION}/esm/browser.js`,
};

// Download size of each engine over the network, gzip, in KB (measured on
// the real files). pdf.js is the "legacy" build: about 35 KB bigger than the
// modern one, but it also runs on older phone browsers.
const LIB_KB = Object.freeze({
  pdfjs: 542, // pdf.min.mjs 151 + pdf.worker.min.mjs 391
  pdflib: 206,
  fflate: 22,
});

// Lets tests or a self-hosted copy point at other files. Call it BEFORE the
// first PDF action. Loaded engines are forgotten so the new URLs are used.
export function configurePdfLibs(overrides = {}) {
  Object.assign(libUrls, overrides);
  loading.clear();
  ready.clear();
}

const loading = new Map(); // name -> Promise of the loaded module
const ready = new Set(); // names that finished loading (for estimate())

const MSG_LIB = 'Could not load the PDF engine. Check your connection and try again.';
const MSG_BAD_PDF = 'This file is not a PDF I can read. It may be damaged.';
const MSG_FAILED = 'Something went wrong with this PDF. It may be damaged.';

function loadOnce(name, importer) {
  if (!loading.has(name)) {
    const promise = importer().then(
      (mod) => {
        ready.add(name);
        return mod;
      },
      (cause) => {
        loading.delete(name); // let the visitor try again
        throw new PdfError('LIB_LOAD', MSG_LIB, { cause });
      },
    );
    loading.set(name, promise);
  }
  return loading.get(name);
}

function getPdfLib() {
  return loadOnce('pdflib', () => import(/* pinned */ libUrls.pdfLib));
}

function getPdfJs() {
  return loadOnce('pdfjs', async () => {
    const mod = await import(/* pinned */ `${libUrls.pdfjsRoot}legacy/build/pdf.min.mjs`);
    // pdf.js runs its heavy parsing in its own Web Worker. The worker file
    // must be named explicitly when there is no bundler.
    mod.GlobalWorkerOptions.workerSrc = `${libUrls.pdfjsRoot}legacy/build/pdf.worker.min.mjs`;
    return mod;
  });
}

function getFflate() {
  return loadOnce('fflate', () => import(/* pinned */ libUrls.fflate));
}

const LOADERS = { pdfjs: getPdfJs, pdflib: getPdfLib, fflate: getFflate };

// KB still to download for these engines (0 once they are loaded).
function downloadKB(names) {
  return names.reduce((sum, name) => sum + (ready.has(name) ? 0 : LIB_KB[name]), 0);
}

// ------------------------------------------------------------- helpers

function makeAbortError() {
  return new DOMException('Cancelled', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw makeAbortError();
}

// Give the browser a turn so the page stays responsive between pages.
function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function noop() {}

// Turn any error from pdf-lib, pdf.js or the browser into a PdfError with a
// sentence a student can act on. Cancel stays a cancel.
function toFriendlyError(err, signal) {
  if (signal?.aborted || err?.name === 'AbortError') return makeAbortError();
  if (err instanceof PdfError) return err;

  const name = err?.name ?? '';
  // pdf.js: asked for a password and we did not give one.
  if (name === 'PasswordException') return new PdfError('LOCKED', MSG_LOCKED, { cause: err });
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') {
    return new PdfError('BAD_PDF', MSG_BAD_PDF, { cause: err });
  }
  // pdf-lib 1.17.1 is built for old browsers (ES5), so its errors are plain
  // Error objects: instanceof and err.name do not work. We read the message
  // instead. This is safe because the version is pinned: the text cannot
  // change under us. If you ever upgrade pdf-lib, re-check these two.
  const message = String(err?.message ?? '');
  if (/PDFDocument\.load.*is encrypted/.test(message)) {
    return new PdfError('LOCKED', MSG_LOCKED, { cause: err });
  }
  if (message.startsWith('Failed to parse PDF document')) {
    return new PdfError('BAD_PDF', MSG_BAD_PDF, { cause: err });
  }
  return new PdfError('FAILED', MSG_FAILED, { cause: err });
}

// Read a job's options using the converter's option list: unknown values
// fall back to the default and numbers are kept inside their limits, so a
// bad value never breaks the run.
function readOptions(spec, given = {}) {
  const out = {};
  for (const item of spec) {
    const raw = given[item.key];
    if (item.type === 'choice') {
      const match = item.choices.find((c) => String(c.value) === String(raw));
      out[item.key] = match ? match.value : item.default;
    } else if (item.type === 'number') {
      const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
      // Not a number: use the default. A number outside the limits: use
      // the nearest limit, so a typo like 999999 does not silently turn
      // a setting off.
      out[item.key] = Number.isFinite(n) ? Math.min(item.max, Math.max(item.min, n)) : item.default;
    } else if (item.type === 'color') {
      out[item.key] = /^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw) : item.default;
    } else {
      out[item.key] = typeof raw === 'string' ? raw.trim() : item.default;
    }
  }
  return out;
}

// Files for a job. Merge and images-to-PDF pass the whole ordered list in
// job.options.files; everything else uses job.file.
function jobFiles(job) {
  const list = job.options?.files;
  return Array.isArray(list) && list.length > 0 ? list : [job.file];
}

// Extra facts for the UI (for example "target not reached").
function setInfo(job, patch) {
  job.info = { ...(job.info ?? {}), ...patch };
}

function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new PdfError('ENCODE', 'This device could not make the image. Try a lower DPI.')),
      type,
      quality,
    );
  });
}

function releaseCanvas(canvas) {
  // Setting the size to 0 frees the pixel memory right away.
  canvas.width = 0;
  canvas.height = 0;
}

// ----------------------------------------------------------- open files

// pdf-lib: for building and changing PDFs.
async function openWithPdfLib(file, signal) {
  const lib = await getPdfLib();
  throwIfAborted(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    // updateMetadata: false keeps the file's own dates and producer.
    return await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw toFriendlyError(err, signal);
  }
}

function newPdfLibDocument(lib) {
  return lib.PDFDocument.create().then((doc) => {
    doc.setProducer('LokalConver');
    doc.setCreator('LokalConver');
    return doc;
  });
}

// pdf.js: for drawing pages and reading text.
async function openWithPdfJs(file, signal) {
  const pdfjs = await getPdfJs();
  throwIfAborted(signal);
  // pdf.js moves this buffer to its worker, so it must be our own copy.
  const data = new Uint8Array(await file.arrayBuffer());
  const root = libUrls.pdfjsRoot;
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${root}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${root}standard_fonts/`,
    wasmUrl: `${root}wasm/`,
    iccUrl: `${root}iccs/`,
  });
  const onAbort = () => {
    task.destroy();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const doc = await task.promise;
    return {
      doc,
      close() {
        signal?.removeEventListener('abort', onAbort);
        return task.destroy();
      },
    };
  } catch (err) {
    signal?.removeEventListener('abort', onAbort);
    task.destroy();
    throw toFriendlyError(err, signal);
  }
}

// Draw one page on `canvas`. Returns { reduced } so callers can say when a
// page was drawn smaller than asked (very large pages).
async function renderPage(page, dpi, canvas, signal) {
  const base = page.getViewport({ scale: 1 });
  const { scale, reduced } = safeRenderScale(
    base.width,
    base.height,
    dpiToScale(dpi),
    MAX_CANVAS_PIXELS,
  );
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const task = page.render({ canvas, viewport, background: '#ffffff' });
  const onAbort = () => task.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    page.cleanup(); // let pdf.js drop what it kept for this page
  }
  return { reduced };
}

// A ZIP built piece by piece. PNG, JPG and PDF are already compressed, so
// files are stored (no extra deflate): faster and lighter on a phone.
function createZip(fflate) {
  const chunks = [];
  let finish;
  let fail;
  const finished = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const zip = new fflate.Zip((err, chunk, final) => {
    if (err) {
      fail(err);
      return;
    }
    // A Blob lives outside the JavaScript heap (the browser may even keep it
    // on disk), so a long PDF does not fill the page's memory.
    chunks.push(new Blob([chunk]));
    if (final) finish();
  });
  return {
    add(name, bytes) {
      const entry = new fflate.ZipPassThrough(name);
      zip.add(entry);
      entry.push(bytes, true);
    },
    async done() {
      zip.end();
      await finished;
      return new Blob(chunks, { type: 'application/zip' });
    },
  };
}

// ------------------------------------------------------------ option lists
// The UI reads these to build its form, and run() reads them to check what
// it was given. Labels are English for now; i18n.js can wrap them later.

const DPI_CHOICES = [
  { value: 72, label: '72 DPI (small, for screens)' },
  { value: 150, label: '150 DPI (good for reading)' },
  { value: 300, label: '300 DPI (sharp, for printing)' },
];

const OPTIONS_IMAGES_TO_PDF = [
  {
    key: 'pageSize',
    label: 'Page size',
    type: 'choice',
    default: 'a4',
    choices: [
      { value: 'a4', label: 'A4' },
      { value: 'letter', label: 'Letter' },
      { value: 'fit', label: 'Fit to image' },
    ],
  },
  {
    key: 'orientation',
    label: 'Page direction',
    type: 'choice',
    default: 'auto',
    choices: [
      { value: 'auto', label: 'Automatic' },
      { value: 'portrait', label: 'Portrait' },
      { value: 'landscape', label: 'Landscape' },
    ],
    // Fit to image has no fixed direction.
    onlyWhen: { pageSize: ['a4', 'letter'] },
  },
  {
    key: 'marginMm',
    label: 'Margin',
    type: 'choice',
    default: 10,
    choices: [
      { value: 0, label: 'None' },
      { value: 5, label: 'Small (5 mm)' },
      { value: 10, label: 'Medium (10 mm)' },
      { value: 20, label: 'Large (20 mm)' },
    ],
  },
  { key: 'quality', label: 'Image quality', type: 'number', default: 0.85, min: 0.4, max: 1, step: 0.05 },
  {
    key: 'maxSide',
    label: 'Longest side in pixels (0 = keep full size)',
    type: 'number',
    default: 3508, // an A4 page at 300 dpi
    min: 0,
    max: 16000,
    step: 100,
  },
  { key: 'background', label: 'Background for transparent images', type: 'color', default: '#ffffff' },
];

const OPTIONS_TO_IMAGES = [
  { key: 'dpi', label: 'Resolution', type: 'choice', default: 150, choices: DPI_CHOICES },
  { key: 'quality', label: 'JPG quality', type: 'number', default: 0.9, min: 0.4, max: 1, step: 0.05, onlyWhen: { toExt: ['jpg'] } },
];

const OPTIONS_MERGE = [];

const OPTIONS_SPLIT = [
  { key: 'ranges', label: 'Pages to keep (for example 1-3,5,8-)', type: 'text', default: '' },
  {
    key: 'mode',
    label: 'Result',
    type: 'choice',
    default: 'one',
    choices: [
      { value: 'one', label: 'One PDF with these pages' },
      { value: 'each', label: 'One PDF for each part, in a ZIP' },
    ],
  },
];

const OPTIONS_ROTATE = [
  {
    key: 'angle',
    label: 'Turn clockwise',
    type: 'choice',
    default: 90,
    choices: [
      { value: 90, label: '90°' },
      { value: 180, label: '180°' },
      { value: 270, label: '270° (90° anticlockwise)' },
    ],
  },
  { key: 'pages', label: 'Pages (empty = all pages)', type: 'text', default: '' },
];

const OPTIONS_TEXT = [];

const OPTIONS_COMPRESS = [
  { key: 'dpi', label: 'Resolution', type: 'choice', default: 150, choices: DPI_CHOICES },
  { key: 'quality', label: 'JPEG quality', type: 'number', default: 0.6, min: 0.2, max: 0.92, step: 0.05 },
  // 0 means "no target". With a target, DPI and quality are chosen for you.
  { key: 'targetKB', label: 'Target size in KB (0 = off)', type: 'number', default: 0, min: 0, max: 200000, step: 10 },
];

// ------------------------------------------------------ 1. images to PDF

// Every image goes through a canvas on purpose:
//  - the browser applies the camera rotation (EXIF), which PDF viewers
//    would ignore if we embedded the raw JPEG,
//  - location and camera data in the photo are dropped (strip metadata),
//  - transparent images get a solid background.
// The cost: PNG and WebP become JPEG, so very sharp line art is a little
// softer. One image is decoded at a time to keep memory small.
async function imageToJpeg(file, { maxSide, quality, background }) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    throw new PdfError('BAD_IMAGE', `Could not read "${file.name}" as an image.`, { cause });
  }
  const canvas = document.createElement('canvas');
  try {
    const { width, height } = limitLongestSide(bitmap.width, bitmap.height, maxSide);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close?.();
    releaseCanvas(canvas);
  }
}

async function runImagesToPdf(job, onProgress, signal) {
  const files = jobFiles(job);
  const opts = readOptions(OPTIONS_IMAGES_TO_PDF, job.options);
  const lib = await getPdfLib();
  const doc = await newPdfLibDocument(lib);

  for (let i = 0; i < files.length; i += 1) {
    throwIfAborted(signal);
    onProgress(i / files.length, `Image ${i + 1} of ${files.length}`);
    const image = await imageToJpeg(files[i], opts);
    const embedded = await doc.embedJpg(image.bytes);
    const size = getPageSize({
      size: opts.pageSize,
      orientation: opts.orientation,
      imgW: image.width,
      imgH: image.height,
      marginMm: opts.marginMm,
    });
    const page = doc.addPage([size.width, size.height]);
    page.drawImage(embedded, placeImage(image.width, image.height, size.width, size.height, size.margin));
    await yieldToBrowser();
  }
  onProgress(0.97, 'Saving the PDF');
  return pdfBlob(await doc.save());
}

// ------------------------------------------------------ 2. PDF to images

async function runPdfToImages(job, onProgress, signal) {
  const opts = readOptions(OPTIONS_TO_IMAGES, job.options);
  const isJpg = job.toExt === 'jpg' || job.toExt === 'jpeg';
  const ext = isJpg ? 'jpg' : 'png';
  const mime = isJpg ? 'image/jpeg' : 'image/png';
  const base = safeBaseName(job.file?.name);

  const { doc, close } = await openWithPdfJs(job.file, signal);
  const canvas = document.createElement('canvas');
  try {
    const fflate = await getFflate();
    const zip = createZip(fflate);
    const total = doc.numPages;
    let reducedPages = 0;

    // One page at a time: draw, save to the ZIP, free the canvas pixels.
    for (let n = 1; n <= total; n += 1) {
      throwIfAborted(signal);
      onProgress((n - 1) / total, `Page ${n} of ${total}`);
      const page = await doc.getPage(n);
      const { reduced } = await renderPage(page, opts.dpi, canvas, signal);
      if (reduced) reducedPages += 1;
      const blob = await canvasToBlob(canvas, mime, isJpg ? opts.quality : undefined);
      zip.add(`${base}-page-${padPageNumber(n, total)}.${ext}`, new Uint8Array(await blob.arrayBuffer()));
      releaseCanvas(canvas);
      await yieldToBrowser();
    }
    if (reducedPages > 0) setInfo(job, { reducedPages });
    onProgress(0.98, 'Making the ZIP');
    return await zip.done();
  } finally {
    releaseCanvas(canvas);
    await close();
  }
}

// ----------------------------------------------- 3. merge, split, rotate

async function runMerge(job, onProgress, signal) {
  const files = jobFiles(job);
  if (files.length < 2) {
    throw new PdfError('NEED_MORE', 'Pick at least two PDFs to merge.');
  }
  const lib = await getPdfLib();
  const out = await newPdfLibDocument(lib);
  for (let i = 0; i < files.length; i += 1) {
    throwIfAborted(signal);
    onProgress(i / files.length, `PDF ${i + 1} of ${files.length}`);
    const src = await openWithPdfLib(files[i], signal); // one source at a time
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
    await yieldToBrowser();
  }
  onProgress(0.97, 'Saving the PDF');
  return pdfBlob(await out.save());
}

async function copyPagesToNewPdf(lib, src, pageNumbers) {
  const out = await newPdfLibDocument(lib);
  const pages = await out.copyPages(
    src,
    pageNumbers.map((p) => p - 1),
  );
  for (const page of pages) out.addPage(page);
  return out.save();
}

async function runSplit(job, onProgress, signal) {
  const opts = readOptions(OPTIONS_SPLIT, job.options);
  const lib = await getPdfLib();
  const src = await openWithPdfLib(job.file, signal);
  const total = src.getPageCount();
  const groups = parseRangeGroups(opts.ranges, total); // throws a friendly error

  if (opts.mode !== 'each' || groups.length === 1) {
    onProgress(0.2, 'Copying pages');
    const pages = parseRanges(opts.ranges, total);
    return pdfBlob(await copyPagesToNewPdf(lib, src, pages));
  }

  // One PDF per comma part, all in one ZIP.
  const fflate = await getFflate();
  const zip = createZip(fflate);
  const base = safeBaseName(job.file?.name);
  for (let i = 0; i < groups.length; i += 1) {
    throwIfAborted(signal);
    onProgress(i / groups.length, `Part ${i + 1} of ${groups.length}`);
    const bytes = await copyPagesToNewPdf(lib, src, groups[i]);
    zip.add(`${base}-part-${i + 1}-pages-${describePages(groups[i]).replace(/,/g, '_')}.pdf`, bytes);
    await yieldToBrowser();
  }
  return zip.done();
}

async function runRotate(job, onProgress, signal) {
  const opts = readOptions(OPTIONS_ROTATE, job.options);
  const lib = await getPdfLib();
  const doc = await openWithPdfLib(job.file, signal);
  const total = doc.getPageCount();
  const everyPage = opts.pages === '' || opts.pages.toLowerCase() === 'all';
  const targets = everyPage ? Array.from({ length: total }, (_, i) => i + 1) : parseRanges(opts.pages, total);

  onProgress(0.3, 'Turning pages');
  const pages = doc.getPages();
  for (const n of targets) {
    const page = pages[n - 1];
    const current = page.getRotation().angle;
    page.setRotation(lib.degrees(addRotation(current, opts.angle)));
  }
  onProgress(0.9, 'Saving the PDF');
  return pdfBlob(await doc.save());
}

// ----------------------------------------------------------- 4. to text

// Only text that is really in the PDF is read. Scanned pages are pictures:
// they give no text, and we say so instead of returning an empty file.
async function runPdfToText(job, onProgress, signal) {
  const { doc, close } = await openWithPdfJs(job.file, signal);
  try {
    const total = doc.numPages;
    const parts = [];
    let letters = 0;
    for (let n = 1; n <= total; n += 1) {
      throwIfAborted(signal);
      onProgress((n - 1) / total, `Page ${n} of ${total}`);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue; // skip marked-content markers
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      page.cleanup();
      letters += text.replace(/\s/g, '').length;
      parts.push(text.trim());
      await yieldToBrowser();
    }
    if (letters === 0) throw new PdfError('NO_TEXT', MSG_NO_TEXT);
    return new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  } finally {
    await close();
  }
}

// ---------------------------------------------------------- 5. compress

// Compress = draw every page, save it as a JPEG, build a new PDF from the
// pictures. Text turns into pixels. That is why the UI says so.
const TARGET_DPI_STEPS = [150, 120, 96, 72, 60]; // tried in this order for a target size
const PROBE_QUALITIES = [0.25, 0.45, 0.65, 0.85]; // measured on a few sample pages
const QUALITY_MIN = 0.2;
const QUALITY_MAX = 0.92;
const TARGET_SAFETY = 0.92; // aim 8% under the target
const OVERHEAD_FIXED = 2000; // bytes a PDF needs besides its pictures
const OVERHEAD_PER_PAGE = 600;
const MAX_BUILDS = 3; // the first try and at most two corrections

const clampQuality = (q) => Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, q));

function samplePageNumbers(total) {
  return [...new Set([1, Math.ceil(total / 2), total])];
}

// Draw up to three pages once, encode each at several qualities, and
// average the sizes. Drawing is the slow part, encoding is cheap.
async function measureCurve(doc, dpi, canvas, signal) {
  const pageNumbers = samplePageNumbers(doc.numPages);
  const sums = PROBE_QUALITIES.map(() => 0);
  for (const n of pageNumbers) {
    throwIfAborted(signal);
    const page = await doc.getPage(n);
    await renderPage(page, dpi, canvas, signal);
    for (let i = 0; i < PROBE_QUALITIES.length; i += 1) {
      sums[i] += (await canvasToBlob(canvas, 'image/jpeg', PROBE_QUALITIES[i])).size;
    }
  }
  releaseCanvas(canvas);
  return PROBE_QUALITIES.map((quality, i) => ({ quality, bytes: sums[i] / pageNumbers.length }));
}

// Walk down the DPI steps until a quality fits the per-page budget.
async function planForTarget({ doc, targetBytes, startDpi, factor, curves, canvas, signal, onProgress }) {
  const total = doc.numPages;
  const perPage = (targetBytes - OVERHEAD_FIXED - OVERHEAD_PER_PAGE * total) / total;
  const start = Math.max(0, TARGET_DPI_STEPS.findIndex((d) => d <= startDpi));
  let plan = null;
  for (let i = start; i < TARGET_DPI_STEPS.length; i += 1) {
    const dpi = TARGET_DPI_STEPS[i];
    // Measuring means drawing sample pages, so keep each result for retries.
    if (!curves.has(dpi)) {
      onProgress(0.02, `Testing ${dpi} DPI`);
      curves.set(dpi, await measureCurve(doc, dpi, canvas, signal));
    }
    const curve = curves.get(dpi);
    const budget = perPage > 0 ? (perPage * TARGET_SAFETY) / factor : 0;
    const pick = pickQualityForTarget(curve, budget);
    plan = { dpi, quality: clampQuality(pick.quality), curve, fits: pick.fits && perPage > 0 };
    if (plan.fits) break;
  }
  return plan;
}

async function buildCompressed({ doc, lib, plan, canvas, signal, report }) {
  const out = await newPdfLibDocument(lib);
  const total = doc.numPages;
  for (let n = 1; n <= total; n += 1) {
    throwIfAborted(signal);
    report((n - 1) / total, `Page ${n} of ${total}`);
    const page = await doc.getPage(n);
    const size = page.getViewport({ scale: 1 }); // page size in points, rotation included
    await renderPage(page, plan.dpi, canvas, signal);
    const blob = await canvasToBlob(canvas, 'image/jpeg', plan.quality);
    const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const outPage = out.addPage([size.width, size.height]);
    outPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    releaseCanvas(canvas);
    await yieldToBrowser();
  }
  return out.save();
}

async function runCompress(job, onProgress, signal) {
  const opts = readOptions(OPTIONS_COMPRESS, job.options);
  const targetBytes = opts.targetKB > 0 ? Math.round(opts.targetKB * 1024) : 0;
  if (targetBytes > 0 && job.file.size <= targetBytes) {
    throw new PdfError('ALREADY_SMALL', 'This PDF is already under that size. Nothing to do.');
  }

  const lib = await getPdfLib();
  const { doc, close } = await openWithPdfJs(job.file, signal);
  const canvas = document.createElement('canvas');
  try {
    const total = doc.numPages;
    let plan = { dpi: opts.dpi, quality: opts.quality, curve: null, fits: true };
    let factor = 1; // how much bigger real pages were than the samples said
    const curves = new Map(); // dpi -> measured size curve
    if (targetBytes > 0) {
      plan = await planForTarget({ doc, targetBytes, startDpi: opts.dpi, factor, curves, canvas, signal, onProgress });
    }

    let best = null; // the smallest PDF built so far
    for (let attempt = 1; attempt <= MAX_BUILDS; attempt += 1) {
      // The first build fills 5%-80% of the bar; corrections fill the rest.
      const report =
        attempt === 1
          ? (f, msg) => onProgress(0.05 + 0.75 * f, msg)
          : (f, msg) => onProgress(0.8 + 0.18 * ((attempt - 2 + f) / (MAX_BUILDS - 1)), `Trying a smaller size. ${msg}`);
      const bytes = await buildCompressed({ doc, lib, plan, canvas, signal, report });
      if (!best || bytes.length < best.bytes.length) best = { bytes, plan };

      if (targetBytes === 0 || bytes.length <= targetBytes || attempt === MAX_BUILDS) break;
      if (!plan.curve) break;

      // Over the target: learn how wrong the samples were and plan again.
      const expectedPerPage = estimateBytesAtQuality(plan.curve, plan.quality);
      const actualPerPage = (bytes.length - OVERHEAD_FIXED - OVERHEAD_PER_PAGE * total) / total;
      factor = Math.max(1, factor * (actualPerPage / expectedPerPage));
      const next = await planForTarget({ doc, targetBytes, startDpi: plan.dpi, factor, curves, canvas, signal, onProgress });
      const same = next.dpi === plan.dpi && Math.abs(next.quality - plan.quality) < 0.01;
      if (same) break; // nothing smaller to try
      plan = next;
    }

    const targetReached = targetBytes === 0 || best.bytes.length <= targetBytes;
    setInfo(job, {
      dpiUsed: best.plan.dpi,
      qualityUsed: Math.round(best.plan.quality * 100) / 100,
      targetKB: opts.targetKB || null,
      targetReached,
    });
    if (best.bytes.length >= job.file.size) {
      throw new PdfError('NOT_SMALLER', 'This PDF is already small. Compressing would make it bigger.');
    }
    return pdfBlob(best.bytes);
  } finally {
    releaseCanvas(canvas);
    await close();
  }
}

// ------------------------------------------------------ the converters

// Wrap every run so errors become friendly and a cancel stays a cancel.
function guarded(runner) {
  return async (job, onProgress = noop, signal) => {
    throwIfAborted(signal);
    try {
      return await runner(job, onProgress, signal);
    } catch (err) {
      throw toFriendlyError(err, signal);
    }
  };
}

function makeConverter({ id, label, from, to, needs, options, run, multi = false, note = null }) {
  return {
    id,
    label,
    group: 'pdf-tools',
    from,
    to,
    engine: 'js', // Tier 1: small JS libraries
    multi, // takes several files, in job.options.files
    note, // honest one-line caveat for the UI, or null
    options,
    // KB the visitor still has to download before this can run.
    estimate: () => ({ downloadKB: downloadKB(needs) }),
    // Fetch the engines (also called by run). Safe to call many times.
    load: async () => {
      await Promise.all(needs.map((name) => LOADERS[name]()));
    },
    run: guarded(async (job, onProgress, signal) => {
      await Promise.all(needs.map((name) => LOADERS[name]()));
      return run(job, onProgress, signal);
    }),
  };
}

// What the browser can decode on its own with createImageBitmap.
// (HEIC, SVG and others are handled by other converters first.)
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];

export const pdfConverters = [
  makeConverter({
    id: 'images-to-pdf',
    label: 'Images to PDF',
    from: IMAGE_TYPES,
    to: ['pdf'],
    needs: ['pdflib'],
    options: OPTIONS_IMAGES_TO_PDF,
    run: runImagesToPdf,
    multi: true,
    note: 'Images are saved as JPEG inside the PDF. Photo location data is dropped.',
  }),
  makeConverter({
    id: 'pdf-to-images',
    label: 'PDF to PNG or JPG',
    from: ['pdf'],
    to: ['png', 'jpg'],
    needs: ['pdfjs', 'fflate'],
    options: OPTIONS_TO_IMAGES,
    run: runPdfToImages,
    note: 'One image per page. The result is a ZIP.',
  }),
  makeConverter({
    id: 'pdf-merge',
    label: 'Merge PDFs',
    from: ['pdf'],
    to: ['pdf'],
    needs: ['pdflib'],
    options: OPTIONS_MERGE,
    run: runMerge,
    multi: true,
    note: 'Bookmarks and fillable form fields are not kept.',
  }),
  makeConverter({
    id: 'pdf-split',
    label: 'Split a PDF by pages',
    from: ['pdf'],
    to: ['pdf'],
    needs: ['pdflib', 'fflate'],
    options: OPTIONS_SPLIT,
    run: runSplit,
    note: 'Bookmarks and fillable form fields are not kept.',
  }),
  makeConverter({
    id: 'pdf-rotate',
    label: 'Rotate PDF pages',
    from: ['pdf'],
    to: ['pdf'],
    needs: ['pdflib'],
    options: OPTIONS_ROTATE,
    run: runRotate,
  }),
  makeConverter({
    id: 'pdf-to-text',
    label: 'PDF to text',
    from: ['pdf'],
    to: ['txt'],
    needs: ['pdfjs'],
    options: OPTIONS_TEXT,
    run: runPdfToText,
    note: 'Only selectable text is read. Columns and tables may come out in a different order.',
  }),
  makeConverter({
    id: 'pdf-compress',
    label: 'Compress a PDF',
    from: ['pdf'],
    to: ['pdf'],
    needs: ['pdfjs', 'pdflib'],
    options: OPTIONS_COMPRESS,
    run: runCompress,
    note: 'Text becomes part of the image.',
  }),
];

// Hand every PDF converter to the app's registry. `register` is whatever
// function js/converters (or the engine router) uses to add one converter.
export function registerPdfConverters(register) {
  for (const converter of pdfConverters) register(converter);
}
