# Licences

LokalConver's own code is released under the MIT licence (see the `LICENSE`
file in the repo root).

This page lists every third-party library the site can load. A library is
added here only when it is needed, loaded lazily, and pinned to an exact
version.

| Library | Version | Licence | Where | Loaded |
|---|---|---|---|---|
| heic-to (contains libheif) | 1.5.2 | LGPL-3.0 (not MIT) | `js/vendor/heic-to-1.5.2/heic-to.js` | lazily, only for HEIC/HEIF, never edited |
| fflate | 0.8.3 | MIT | `js/vendor/fflate-0.8.3.js` | lazily, only when someone downloads a ZIP |

## heic-to

- What it does: opens HEIC and HEIF photos (the format many phones use) so
  they can be converted to JPG, PNG and other formats.
- Source: https://github.com/hoppergee/heic-to (version 1.5.2)
- Package: https://www.npmjs.com/package/heic-to
- Licence text: `js/vendor/heic-to-1.5.2/LICENSE`
- It is the only part of this site that is not MIT. Everything else in the
  repo is MIT.

How we keep to the LGPL:

- The file is kept exactly as published, with no changes.
- It stays a separate file. It is not merged into our own scripts or any
  bundle, so anyone can replace it with their own copy.
- Its licence file is kept next to it.
- It is only downloaded when someone converts a HEIC/HEIF photo in a browser
  that cannot open HEIC by itself. It comes from this same site, not from a
  third party. The photo itself never leaves the device.

## fflate

- What it does: builds the ZIP file for "Download all as ZIP".
- Source: https://github.com/101arrowz/fflate
- Package: https://www.npmjs.com/package/fflate
- Licence text: `js/vendor/fflate-0.8.3.LICENSE.txt` (MIT)
- It is kept exactly as published and loaded with `import()` only when the
  ZIP button is used. It runs on the main thread in short steps, so it
  needs no Web Worker and no extra Content-Security-Policy rule.

## How to add a library

Before adding anything, check its name and licence on https://www.npmjs.com,
pin an exact version, and add a row to the table above.

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
