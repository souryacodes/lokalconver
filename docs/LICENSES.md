# Licences

LokalConver's own code is released under the **MIT licence** (see the `LICENSE`
file in the repo root).

This page lists every third-party library the project uses. The rules:

1. A library is added only when it is needed.
2. It is pinned to an **exact version** (no `^`, `~` or `latest`).
3. It is loaded **lazily**, only when a conversion needs it.
4. Its licence is listed here, and its licence file sits next to it.

`tests/libs.test.js` checks that every library in `js/converters/libs.js` is
listed on this page, and that every vendored file still matches
`js/vendor/SHA256SUMS`.

## At a glance

### Self-hosted libraries (shipped with the site)

All of these live in `js/vendor/`. The page makes no request to any other site.
Sizes are the raw file size on disk; they are smaller over the network with gzip.

| Library | Version | Licence | Used for | File | Size | Loaded |
|---|---|---|---|---|---|---|
| heic-to (contains libheif) | 1.5.2 | LGPL-3.0 (not MIT) | HEIC/HEIF photos to JPG, PNG and others | `js/vendor/heic-to-1.5.2/heic-to.js` | 2.9 MB | only when a HEIC/HEIF photo is converted and the browser cannot open it |
| fflate | 0.8.3 | MIT | ZIP files: "Download all as ZIP", PDF to images, split into parts | `js/vendor/fflate-0.8.3.js` | 89 KB | only when a ZIP is made |
| mammoth | 1.13.0 | BSD-2-Clause | Word (.docx) to HTML and text | `js/vendor/mammoth/1.13.0/mammoth.browser.min.js` | 396 KB | first .docx conversion |
| turndown | 7.2.4 | MIT | HTML to Markdown (.docx to .md) | `js/vendor/turndown/7.2.4/turndown.browser.umd.js` | 26 KB | first .docx to .md conversion |
| marked | 18.1.1 | MIT | Markdown to HTML | `js/vendor/marked/18.1.1/marked.umd.js` | 47 KB | first .md conversion |
| pdf-lib | 1.17.1 | MIT | build and change PDFs: text and images to PDF, merge, split, rotate, compress | `js/vendor/pdf-lib/1.17.1/pdf-lib.min.js` | 513 KB | first PDF job |
| pdf.js (`pdfjs-dist`, legacy build) | 6.4.299 | Apache-2.0 | draw PDF pages (PDF to PNG/JPG, compress) and read their text | `js/vendor/pdfjs-dist/6.4.299/legacy/build/pdf.min.mjs` + `pdf.worker.min.mjs` | 512 KB + 1.3 MB worker (plus fonts, character maps and decoders, loaded only when a PDF needs them) | first PDF to image, text or compress job |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | Excel (.xlsx) to CSV and JSON | `js/vendor/sheetjs/0.20.3/xlsx.mini.min.js` | 273 KB | first .xlsx conversion |

> **SheetJS is not in the repo yet.** Run `python tools/vendor_libs.py` once on a
> computer with internet. It downloads the official build, records its hash in
> `js/vendor/SHA256SUMS`, and prints the size to put in `js/converters/libs.js`.
> Then commit `js/vendor/sheetjs/` and `js/vendor/SHA256SUMS`. Until then, .xlsx
> conversion shows a "not installed" message.

## Details by library

### heic-to (LGPL-3.0)

- What it does: opens HEIC and HEIF photos (the format many phones use) so
  they can be converted to JPG, PNG and other formats.
- Source: https://github.com/hoppergee/heic-to
- Package: https://www.npmjs.com/package/heic-to
- Licence text: `js/vendor/heic-to-1.5.2/LICENSE`
- It is the only part of this site that is not MIT or another permissive
  licence. Everything else in the repo is MIT, BSD or Apache-2.0.

How we keep to the LGPL:

- The file is kept exactly as published, with no changes.
- It stays a separate file. It is not merged into our own scripts or any
  bundle, so anyone can replace it with their own copy.
- Its licence file is kept next to it.
- It is only downloaded when someone converts a HEIC/HEIF photo in a browser
  that cannot open HEIC by itself. It comes from this same site, not from a
  third party. The photo itself never leaves the device.

### fflate (MIT)

- What it does: builds the ZIP file for "Download all as ZIP".
- Source: https://github.com/101arrowz/fflate
- Package: https://www.npmjs.com/package/fflate
- Licence text: `js/vendor/fflate-0.8.3.LICENSE.txt`
- Kept exactly as published and loaded with `import()` only when the ZIP button
  is used. It runs on the main thread in short steps, so it needs no Web Worker
  and no extra Content-Security-Policy rule.

### mammoth (BSD-2-Clause)

- What it does: reads Word (.docx) files and turns them into HTML or plain text.
- Source: https://github.com/mwilliamson/mammoth.js
- Package: https://www.npmjs.com/package/mammoth
- Licence text: `js/vendor/mammoth/1.13.0/LICENSE`
- Runs inside a Web Worker (`js/engines/lib-worker.js`), so the page stays smooth.
- The browser file is a bundle. It also contains code from mammoth's own
  dependencies (for example JSZip, underscore, xmldom, pako). Those are
  permissive licences, but their notices are **not** in the bundle's licence
  file. See "Open items" below.

### turndown (MIT)

- What it does: turns the HTML made from a Word file into Markdown.
- Source: https://github.com/mixmark-io/turndown
- Package: https://www.npmjs.com/package/turndown
- Licence text: `js/vendor/turndown/7.2.4/LICENSE`
- It needs a page (a DOM), which workers do not have, so it is loaded as a
  normal script from our own site. Images are dropped before it runs.
- The same version is also a dev dependency in `package.json`, for tests only.

### marked (MIT)

- What it does: turns Markdown into HTML.
- Source: https://github.com/markedjs/marked
- Package: https://www.npmjs.com/package/marked
- Licence text: `js/vendor/marked/18.1.1/LICENSE`
- Raw HTML in the Markdown is shown as text, never run.

### pdf-lib (MIT)

- What it does: builds and changes PDF files (text and images to PDF, merge, split, rotate, compress).
- Source: https://github.com/Hopding/pdf-lib
- Package: https://www.npmjs.com/package/pdf-lib
- Licence text: `js/vendor/pdf-lib/1.17.1/LICENSE.md`
- The bundle also contains tslib (Apache-2.0, notice kept at the top of the
  file) and pako (MIT and zlib).
- Loaded as a classic script on the page (PDF tools) or inside the library worker (text to PDF).

### pdf.js (Apache-2.0)

- What it does: opens PDF files, draws their pages on a canvas (PDF to PNG/JPG and
  compress) and reads their text (PDF to text).
- Source: https://github.com/mozilla/pdf.js
- Package: https://www.npmjs.com/package/pdfjs-dist (the `legacy` build, so it also
  runs on older phones)
- Licence text: `js/vendor/pdfjs-dist/6.4.299/LICENSE`. The decoders carry their own
  notices in `wasm/` (`LICENSE_OPENJPEG`, `LICENSE_JBIG2`, `LICENSE_QCMS` and the
  pdf.js wrappers), and the fonts in `standard_fonts/` have `LICENSE_FOXIT` and
  `LICENSE_LIBERATION`.
- Self-hosted in `js/vendor/pdfjs-dist/6.4.299/`, copied unchanged from the npm package
  (version published 2026-10-03). Kept: `legacy/build/pdf.min.mjs`,
  `legacy/build/pdf.worker.min.mjs`, `cmaps/`, `standard_fonts/`, `iccs/` and the
  JPEG 2000, JBIG2 and colour decoders in `wasm/`. Left out: the PDF scripting
  sandbox (`quickjs-eval`), because LokalConver never runs scripts inside a PDF.
- It starts its own Web Worker from our own file, so the Content-Security-Policy
  (`script-src 'self'`, `worker-src 'self' blob:`) did not have to change. No request goes
  to another site.

### SheetJS Community Edition (Apache-2.0)

- What it does: reads Excel (.xlsx) files and gives us the table inside.
- Documentation: https://docs.sheetjs.com/
- Official download: https://cdn.sheetjs.com/ (used only by `tools/vendor_libs.py`)
- The `xlsx` package on npm is no longer updated (stuck at 0.18.5), so it is not
  used. Visitors never download from cdn.sheetjs.com; we download once and
  serve the file ourselves.
- Licence text: `js/vendor/sheetjs/0.20.3/LICENSE` (saved by `tools/vendor_libs.py`).

## Development tools (not shipped)

These help build and test the project. Visitors never download them.

| Tool | Licence | Used for |
|---|---|---|
| turndown (npm, 7.2.4) | MIT | tests for .docx to .md (`npm install`) |
| python-docx | MIT | `tools/make_samples.py` writes `samples/sample.docx` |
| openpyxl | MIT | `tools/make_samples.py` writes `samples/sample.xlsx` |
| Pillow | HPND (MIT-style) | `tools/make_samples.py` makes the small test picture |

## How to add a library

1. Check its name and licence on https://www.npmjs.com (or its official site).
   Do not add anything whose licence you cannot read.
2. Pin an exact version that is more than two weeks old.
3. Save the file unchanged under `js/vendor/<name>/<version>/`, with its
   licence file next to it.
4. Add it to `js/converters/libs.js`, add its hash to `js/vendor/SHA256SUMS`,
   and add a row and a short section on this page.
5. Run `npm test`. `tests/libs.test.js` fails if any step was forgotten.

## Open items

- **mammoth bundle notices.** Add the licence notices of the libraries inside
  the mammoth bundle (from mammoth's npm package) next to `LICENSE`, then
  remove this item. Do this before the next public release.
- **SheetJS file.** Download it with `python tools/vendor_libs.py`, then commit it.
