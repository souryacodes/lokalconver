# lokalconver
Local File Converter. Convert Anything. Upload Nothing

## Live Demo

[Open LokalConver](https://souryacodes.github.io/lokalconver/)

## Run it on your Devices

- Windows: double-click `start.bat`
- Mac or Linux: run `./start.sh`
- Any system: `python tools/serve.py` (or `npm start`)
- Android or IOS: Open live demo link.

It opens http://localhost:8000. The server only listens on this computer and
nothing is uploaded.

## What it converts

- Images: PNG, JPG, GIF, WEBP, BMP, SVG, AVIF, HEIC/HEIF in; JPG, PNG, WEBP, BMP, ICO, AVIF out.
- Documents: Word (.docx) to TXT, HTML or Markdown; Markdown to HTML; text to PDF.

- PDF: PDF to PNG or JPG (one picture per page, a ZIP when there are several), PDF to text, pictures to PDF.

  The **PDF** page also merges PDFs, splits them by page range, rotates pages, makes a PDF smaller and puts several pictures into one PDF in the order you choose. The PDF engines are in `js/vendor/`: nothing is loaded from another site.
- Data: CSV to JSON, JSON to CSV, Excel (.xlsx) to CSV or JSON.

## One-time setup for developers

- `python tools/vendor_libs.py` downloads the Excel engine (SheetJS) into `js/vendor/`
  and checks every vendored file against `js/vendor/SHA256SUMS`. Commit the result.
- `npm install` adds the dev-only test dependency, then `npm test` runs the tests.
- Third-party libraries and their licences are listed in `docs/LICENSES.md`.

