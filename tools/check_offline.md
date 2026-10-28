# Check offline mode, install and Share (LokalConver)

Do this after any change to `service-worker.js`, `manifest.webmanifest` or a shell file.
Use Chrome or Edge. DevTools opens with F12.

## 0. Before you start

- [ ] Run `python tools/gen_precache.py` (it rewrites `precache-manifest.js`).
- [ ] Start the site: `python tools/serve.py`. It runs on `http://localhost`, and
      service workers are allowed there (on other plain `http` addresses they are not).
- [ ] Start clean: DevTools > Application > Storage > **Clear site data**
      (tick "Unregister service workers").

## 1. First visit fills the cache (Application tab)

- [ ] Open the site. Wait about 5 seconds. The worker starts 3 seconds after the page loads.
- [ ] **Application > Service workers**: `service-worker.js` shows
      "activated and is running".
- [ ] **Application > Cache storage**: `lokalconver-shell-<version>` exists. Open it:
      the HTML, CSS and JS files from `precache-manifest.js` are listed.
      `js/vendor/` files are NOT in it. That is on purpose.
- [ ] The chip **Works offline** appears in the footer. It must not appear before that.
- [ ] Convert a PNG to WEBP (built into the browser, Tier 0).
- [ ] Convert `samples/sample.docx` (this loads the mammoth engine).
      Now `lokalconver-engines-v1` exists and holds the mammoth file from `js/vendor/`.

## 2. Offline (Service Workers panel)

- [ ] **Application > Service workers**: tick **Offline**. The chip changes to **Offline**.
- [ ] Reload the page. It still opens.
- [ ] Convert the PNG again. It works.
- [ ] Convert the DOCX again. It works, because its engine is cached.
- [ ] Try something that needs an engine you have not used yet (for example PDF
      compress). It cannot work offline. It must show a plain message, not a blank screen.
- [ ] Untick **Offline**. The chip goes back to **Works offline**.

## 3. Updates

- [ ] Change a word in any shell file (for example `css/pwa.css`).
- [ ] Run `python tools/gen_precache.py`. The version changes.
- [ ] Reload once. After a moment the toast **New version ready.** with **Reload**
      and **Later** appears. Service workers shows a second worker "waiting".
- [ ] Press **Reload**. The page reloads once and runs the new version.
- [ ] Cache storage: the old `lokalconver-shell-<old version>` is gone.
      `lokalconver-engines-v1` is still there.
- [ ] Do NOT tick "Update on reload" for this test. It skips the waiting step.

## 4. Manifest and install (Application > Manifest)

- [ ] No errors. Name, short name, start URL `./`, display `standalone`.
- [ ] Icons: the "any" and the "maskable" ones are listed.
- [ ] Tick **Show only the minimum safe area for maskable icons**. The drop and lock
      must stay fully inside the circle.

## 5. Install card

Use a fresh profile or clear site data (this also resets the counters).

- [ ] Visit 1: convert two files. No card.
- [ ] Close the tab. Open the site again (visit 2). Convert a file. The card
      **Install LokalConver** appears.
- [ ] **No thanks**. It never comes back, in any later visit.
- [ ] (Fresh profile) **Install** installs the app. Afterwards no card.
- [ ] Safari and Firefox never show the card. They give no install prompt. That is expected.

## 6. Share Target without a phone

Share Target needs the app to be installed to appear in the OS Share sheet, but the
worker URL works in any tab once the worker runs. Paste this in the DevTools Console
on the site:

```js
const f = new FormData();
f.append('files', new File([new Uint8Array(40)], 'test.png', { type: 'image/png' }));
f.append('files', new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }));
const r = await fetch('./share-target', { method: 'POST', body: f });
location.href = r.url + '#/convert';
```

- [ ] The Convert page opens with `test.png` added, and a message says 1 file was opened
      and 1 skipped.
- [ ] Reload: the file is not added again. Cache storage > `lokalconver-share-v1` is empty.

## 7. Real phone (Android, Chrome)

Needs `https`. Use your GitHub Pages address.

- [ ] Open the site once with a good connection. Wait for **Works offline**.
- [ ] Switch on airplane mode. Open LokalConver. Convert a photo. It works.
- [ ] Chrome menu > **Install app**. (Or wait for the install card on a later visit.)
- [ ] Open Gallery, pick a photo (also try 2 photos), **Share** > **LokalConver**.
      The app opens on the Convert page with the photo(s) added.
- [ ] If LokalConver is missing from the Share sheet: uninstall the app and install it
      again. Android reads the share target when the app is installed or updated.

## Reset

DevTools > Application > Storage > **Clear site data**, or Application > Service
workers > **Unregister**.
