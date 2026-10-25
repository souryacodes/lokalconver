# HEIC decoder (heic-to 1.5.2)

This folder must contain ONE file: `heic-to.js`. It is not in git yet.
It is only downloaded by a visitor's browser when they convert a HEIC/HEIF
photo (and not at all in Safari, which opens HEIC by itself).

## Put the file here (once, on your computer)

```
npm pack heic-to@1.5.2
tar -xzf heic-to-1.5.2.tgz package/dist/csp/heic-to.js package/LICENSE
cp package/dist/csp/heic-to.js js/vendor/heic-to-1.5.2/heic-to.js
cp package/LICENSE js/vendor/heic-to-1.5.2/LICENSE
```

- Use the **csp** build: it works without `unsafe-eval` in our strict
  Content-Security-Policy.
- Check the package name and version on https://www.npmjs.com/package/heic-to
  before you run this. 1.5.2 was picked because it is more than 14 days old.
  Newer versions exist; to move up, change `HEIC_ENGINE_VERSION` in
  `js/converters/image.js` and rename this folder.
- Do not edit the file. The licence lets people swap in their own copy
  only if it is unchanged.

## CSP lines this needs

heic-to starts its own Web Worker from a `blob:` URL, so the policy needs
`worker-src 'self' blob:`. Nothing else is needed for HEIC. No third-party host.

## Add this to docs/LICENSES.md

| Library | Version | Licence | Where | Loaded |
|---|---|---|---|---|
| heic-to (contains libheif) | 1.5.2 | LGPL-3.0 | js/vendor/heic-to-1.5.2/heic-to.js | lazily, only for HEIC/HEIF, never edited |
