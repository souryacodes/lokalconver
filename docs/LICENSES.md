# Licences

LokalConver's own code is released under the MIT licence (see the `LICENSE`
file in the repo root).

This page lists every third-party library the site can load. A library is
added here only when it is needed, loaded lazily, and pinned to an exact
version.

| Library | Version | Licence | Where | Loaded |
|---|---|---|---|---|
| heic-to (contains libheif) | 1.5.2 | LGPL-3.0 (not MIT) | `js/vendor/heic-to-1.5.2/heic-to.js` | lazily, only for HEIC/HEIF, never edited |

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

## How to add a library

Before adding anything, check its name and licence on https://www.npmjs.com,
pin an exact version, and add a row to the table above.
