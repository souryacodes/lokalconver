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
| fflate | 0.8.3 | MIT | "Download all as ZIP" | `js/vendor/fflate-0.8.3.js` | 89 KB | only when the ZIP button is used |
| mammoth | 1.13.0 | BSD-2-Clause | Word (.docx) to HTML and text | `js/vendor/mammoth/1.13.0/mammoth.browser.min.js` | 396 KB | first .docx conversion |
| turndown | 7.2.4 | MIT | HTML to Markdown (.docx to .md) | `js/vendor/turndown/7.2.4/turndown.browser.umd.js` | 26 KB | first .docx to .md conversion |
| marked | 18.1.1 | MIT | Markdown to HTML | `js/vendor/marked/18.1.1/marked.umd.js` | 47 KB | first .md conversion |
| pdf-lib | 1.17.1 | MIT | text (.txt) to PDF | `js/vendor/pdf-lib/1.17.1/pdf-lib.min.js` | 513 KB | first .txt to PDF conversion |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | Excel (.xlsx) to CSV and JSON | `js/vendor/sheetjs/0.20.3/xlsx.mini.min.js` | 273 KB | first .xlsx conversion |

> **SheetJS is not in the repo yet.** Run `python tools/vendor_libs.py` once on a
> computer with internet. It downloads the official build, records its hash in
> `js/vendor/SHA256SUMS`, and prints the size to put in `js/converters/libs.js`.
> Then commit `js/vendor/sheetjs/` and `js/vendor/SHA256SUMS`. Until then, .xlsx
> conversion shows a "not installed" message.

### PDF toolkit libraries (not switched on yet)

`js/converters/pdf.js` is in the repo, but `js/app.js` does not load it, so
**the live site does not use these libraries today.** They are listed so the
licences are known before the toolkit is turned on.

They load from a CDN, not from `js/vendor/`:

| Library | Version | Licence | Used for | Loaded from | Size (gzip) |
|---|---|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | merge, split, rotate, build PDFs | `https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js` | about 206 KB |
| pdf.js (`pdfjs-dist`, legacy build) | 6.4.299 | Apache-2.0 | draw PDF pages, read text | `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs` and `pdf.worker.min.mjs` | about 542 KB (151 + 391) |
| fflate | 0.8.2 | MIT | ZIP results | `https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js` | about 22 KB |

pdf.js may also fetch fonts, character maps or WebAssembly decoders from the
same `pdfjs-dist@6.4.299/` folder, but only when a PDF needs them.

Before turning the toolkit on, choose one:

- **Allow the CDN.** The Content-Security-Policy in `index.html` must then allow
  it, and the site makes requests to a third party (no file content is sent, but
  it is no longer "no requests to other sites"):

      script-src  'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval';
      worker-src  'self' blob:;
      connect-src 'self' https://cdn.jsdelivr.net;
      font-src    'self' https://cdn.jsdelivr.net data: blob:;
      img-src     'self' blob: data:;

  `blob:` in `worker-src` is needed because pdf.js starts its worker through a
  small blob wrapper when the worker file comes from another site.
- **Self-host the files** in `js/vendor/` like the libraries above. The policy
  stays as strict as it is now (recommended).

If fflate is also needed there, use the same version as the table above (0.8.3)
so only one copy of fflate has to be tracked.

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

- What it does: builds PDF files (used here for text to PDF).
- Source: https://github.com/Hopding/pdf-lib
- Package: https://www.npmjs.com/package/pdf-lib
- Licence text: `js/vendor/pdf-lib/1.17.1/LICENSE.md`
- The bundle also contains tslib (Apache-2.0, notice kept at the top of the
  file) and pako (MIT and zlib).
- The same version is loaded from the CDN by the PDF toolkit (see above) once it
  is switched on.

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

<<<<<<< HEAD
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
=======
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
- **PDF toolkit.** Pick "allow the CDN" or "self-host" (see above) before
  `js/converters/pdf.js` is loaded by the site.
>>>>>>> 2afce17 (Added the Documents and Data features)
