// The ONLY place that lists third-party libraries. Every one is PINNED to an exact version,
// self-hosted under js/vendor/ (so the page makes no third-party requests) and listed in docs/LICENSES.md.
// kb = size of the file on disk (raw). It is smaller over the wire with gzip. null = not downloaded yet.
export const LIBS = {
  mammoth:  { version: '1.13.0', license: 'BSD-2-Clause', global: 'mammoth',         path: 'js/vendor/mammoth/1.13.0/mammoth.browser.min.js', kb: 396 },
  turndown: { version: '7.2.4',  license: 'MIT',          global: 'TurndownService', path: 'js/vendor/turndown/7.2.4/turndown.browser.umd.js', kb: 26 },
  marked:   { version: '18.1.1', license: 'MIT',          global: 'marked',          path: 'js/vendor/marked/18.1.1/marked.umd.js',            kb: 47 },
  pdflib:   { version: '1.17.1', license: 'MIT',          global: 'PDFLib',          path: 'js/vendor/pdf-lib/1.17.1/pdf-lib.min.js',          kb: 513 },
  // pdf.js (legacy build, so it also runs on older phones). An ES module, not a classic script, so no global.
  // It starts its own Web Worker (pdf.worker.min.mjs, workerKb) and reads fonts, cmaps and decoders from the same folder.
  pdfjs:    { version: '6.4.299', license: 'Apache-2.0',  global: null,              path: 'js/vendor/pdfjs-dist/6.4.299/legacy/build/pdf.min.mjs', kb: 512, workerKb: 1290 },
  // Official SheetJS Community Edition build (the npm "xlsx" package is stale). Fetched by tools/vendor_libs.py.
  sheetjs:  { version: '0.20.3', license: 'Apache-2.0',   global: 'XLSX',            path: 'js/vendor/sheetjs/0.20.3/xlsx.mini.min.js',        kb: 273 },
};

// Absolute URL of a vendored file, computed from this file so it works under any sub-folder.
export const libUrl = (key) => new URL(`../../${LIBS[key].path}`, import.meta.url).href;
export const libUrls = () => Object.fromEntries(Object.keys(LIBS).map((k) => [k, libUrl(k)]));
