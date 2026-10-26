# lokalconver
Local File Converter. Convert Anything. Upload Nothing

## Live Demo

[Open LokalConver](https://souryacodes.github.io/lokalconver/)

## Run it on your computer

Do not double-click `index.html`. Browsers block JavaScript modules on `file://`
addresses, so the page would stay on "Getting the converter ready...".

- Windows: double-click `start.bat`
- Mac or Linux: run `./start.sh`
- Any system: `python tools/serve.py` (or `npm start`)

It opens http://localhost:8000. The server only listens on this computer and
nothing is uploaded.

## What it converts

- Images: PNG, JPG, GIF, WEBP, BMP, SVG, AVIF, HEIC/HEIF in; JPG, PNG, WEBP, BMP, ICO, AVIF out.
- Documents: Word (.docx) to TXT, HTML or Markdown; Markdown to HTML; text to PDF.
- Data: CSV to JSON, JSON to CSV, Excel (.xlsx) to CSV or JSON.

## One-time setup for developers

- `python tools/vendor_libs.py` downloads the Excel engine (SheetJS) into `js/vendor/`
  and checks every vendored file against `js/vendor/SHA256SUMS`. Commit the result.
- `npm install` adds the dev-only test dependency, then `npm test` runs the tests.
- Third-party libraries and their licences are listed in `docs/LICENSES.md`.

