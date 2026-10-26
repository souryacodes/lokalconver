# Lines to add to docs/LICENSES.md

AGENTS.md says every library must be listed there. I could not see your
LICENSES.md, so add these rows (skip fflate if it is already listed, and
check its version matches).

| Library | Pinned version | Licence | Used for | Loaded from | Size over the network (gzip) |
|---|---|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | merge, split, rotate, build PDFs | `https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js` | about 206 KB |
| pdf.js (`pdfjs-dist`, legacy build) | 6.4.299 (published 2026-10-03) | Apache-2.0 | draw PDF pages, read text | `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs` and `pdf.worker.min.mjs` | about 542 KB (151 + 391) |
| fflate | 0.8.2 | MIT | ZIP results | `https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js` | about 22 KB |

pdf.js may also fetch fonts, character maps or WebAssembly decoders from the
same `pdfjs-dist@6.4.299/` folder, but only when a PDF needs them.

Content-Security-Policy needed for these downloads (only while PDF tools exist):

    script-src  'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval';
    worker-src  'self' blob:;
    connect-src 'self' https://cdn.jsdelivr.net;
    font-src    'self' https://cdn.jsdelivr.net data: blob:;
    img-src     'self' blob: data:;

`blob:` in worker-src is needed because pdf.js starts its worker through a
small blob wrapper when the worker file comes from another site.
