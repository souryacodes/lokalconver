# Notes: magic numbers, and why a file extension cannot be trusted

## What is a magic number?

Every file is just a list of bytes. Many file types start with a few
special bytes that say "I am this kind of file". These first bytes are
called a **magic number** (or "file signature").

Examples:

| File type | First bytes                    | In text   |
| --------- | ------------------------------ | --------- |
| PNG       | `89 50 4E 47 0D 0A 1A 0A`      | `.PNG...` |
| JPG       | `FF D8 FF`                     | (none)    |
| GIF       | `47 49 46 38 39 61`            | `GIF89a`  |
| PDF       | `25 50 44 46 2D`               | `%PDF-`   |
| ZIP, DOCX | `50 4B 03 04`                  | `PK..`    |

A program that opens a PNG file looks at these bytes first. If they are
there, it is a PNG, whatever the name says.

## Why the extension cannot be trusted

The extension is the part of the name after the last dot, like `.jpg`.
It is only **text that anyone can change**. Renaming a file does not
change what is inside it.

- Someone renames `photo.png` to `photo.jpg`. The bytes are still PNG.
- A phone saves a HEIC photo with the name `IMG_1.jpg`.
- A file called `report.docx` is really a plain zip, or is damaged.
- A bad file is named `invoice.pdf` to trick the person who opens it.

If LokalConver went by the name, it could pick the wrong converter and
fail, or give a broken result.

## What LokalConver does

`detectType(bytes, fileName)` in `js/core/detect.js`:

1. Reads the first bytes of the file and finds its real type.
2. Compares it with the extension in the name.
3. If they disagree, it **trusts the bytes** and says so in `mismatch`,
   for example: "The name says .jpg, but this file is really PNG. We will
   use PNG."

Some files cannot be proved from bytes (plain text such as `.csv` or
`.txt`). There the name is the only hint we have, and we use it.

## Limits to remember

- Magic numbers show the **container**, not that the whole file is
  healthy. A file can start like a PNG and still be damaged later.
- DOCX, XLSX and PPTX are all zip files. We look at the file names
  inside the zip to tell them apart. If we cannot see inside, we use the
  name and tell the user.

# Privacy Proof, Presets, Receipt and Settings

- **Proof (`#/proof`, `js/ui/proof.js`)**: lists the requests the browser reports through the Resource Timing API.
  Files under `js/vendor/` are shown as engine downloads. Everything else from our own address is "Our own files".
  The line "Requests that carried your files: 0" is shown only while no request to an unapproved address is reported.
  Resource Timing cannot see request bodies or methods, so it is a helper, not a proof. The Network tab, airplane mode
  and `python tools/verify_no_upload.py` are the other checks (`--include-vendor` also scans third-party files).
- **Presets (`#/presets`, `js/presets.js`)**: plain objects. "My presets" live in localStorage. "Use preset" sets the target,
  the longest side and the size limit on files that can use it. Other files are left as they were, and the bar says so.
  A JPG or WEBP can be shrunk in its own format only through a preset (`findShrinker` in `js/ui/services.js`).
  PDF presets ("PDF under 500 KB") use the PDF compress route (`pdf-compress`, found through `findShrinker` in `js/ui/services.js`).
  It draws every page again as a picture, so the text can no longer be selected. The card says so, and says honestly when the size goal could not be reached.
  "Email-friendly: total under 10 MB" shares the total across the batch by file size.
- **Receipt**: drawn on a canvas from the real sizes of the finished jobs. "0 bytes uploaded" is the product promise printed
  on the card, not a measured number.
- **Settings**: theme and sound reuse the existing keys (`lokalconver-theme`, `lokalconver.sound`). Accent and motion are in
  `lokalconver.settings.v1`. `js/theme-init.js` applies accent and motion before the first paint.
