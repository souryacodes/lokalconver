# PWA, offline mode and Share Target

Files: `manifest.webmanifest`, `service-worker.js`, `precache-manifest.js` (generated),
`js/core/pwa*.js`, `js/core/share-intake.js`, `css/pwa.css`, `assets/icons/`,
`tools/gen_precache.py`, `tools/make_icons.py`, `tools/check_offline.md`.

## Every release

1. `python tools/gen_precache.py` (rewrites `precache-manifest.js`; the version is a hash
   of the shell files). `pytest` fails if you forget.
2. Changed an icon SVG? `pip install -r tools/requirements-dev.txt`, then
   `python tools/make_icons.py`. Commit the PNG files.

## How it works

- **Shell** (`lokalconver-shell-<hash>`): HTML, CSS, JS, SVG. Filled by the worker
  install, 3 seconds after the page loads. New cache name every release; old ones are
  deleted on activate.
- **Engines** (`lokalconver-engines-v1`): everything in `js/vendor/` and any `.wasm`.
  Saved the first time a conversion asks for it, then served from cache first. The
  paths carry the version, so this cache stays across releases. To flush it on purpose,
  change the number in `service-worker.js`.
- **Pages**: network first (4 second timeout), cache when offline. The network copy
  is never written to the cache, so HTML and JS of two releases never mix there.
- **Updates**: no automatic `skipWaiting()`. The toast "New version ready." with
  **Reload** asks first.
- **Chip** (footer): "Works offline" only after the worker confirms every shell file is
  in the cache. "Offline" whenever `navigator.onLine` is false.
- **Install card**: needs 2 successful conversions (event `lokalconver:conversion-done`
  from `convert.js`) AND not the first visit. At most once per visit, never again after
  "No thanks". Only where the browser gives an install prompt (Chromium).
- **Share Target**: Android POSTs to `./share-target`. The worker checks the types again,
  keeps the files in `lokalconver-share-v1` for at most 1 hour, redirects to `./#/convert`,
  and `share-intake.js` hands them to `convertPage.addFiles()` and deletes them.

## Browsers for Share Target (a bonus)

Installed app on Chrome and Edge (Android and desktop), Samsung Internet 12+, Opera.
Not Firefox, Safari or any iPhone/iPad browser (caniuse and MDN, October 2026).
Elsewhere nothing breaks; LokalConver just is not in the Share sheet.

## Known limits

- An engine works offline only after one online use. The chip promises the app,
  not every converter.
- Files converted before the worker took control on the very first visit are not
  cached; the next use online caches them.
- A very large shared video may not fit in memory on a low-RAM phone. The app then says
  "Could not receive the shared file."
- Shared files carry no original "modified" date (multipart uploads do not).
- The PNG icons are not in the shell on purpose (about 55 KB, only used by the phone
  when installing). The first-visit shell download is about 160 KB gzipped.
- Share Target currently accepts images, PDF, audio and video (as asked). Audio and
  video have no converter yet, so they are skipped with the normal Convert page message.
