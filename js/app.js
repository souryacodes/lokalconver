// LokalConver - entry point.
// It runs the hash router, the theme toggle, the lazy pages (Presets, Proof) and the Settings dialog.

import { initThemeToggle } from './theme.js';

const DEFAULT_ROUTE = 'convert';

// The Convert page is loaded after the first paint, so the first load stays small.
// If it fails to load, the visitor sees a plain message, not a blank page.
let convertPage = null;      // the mounted Convert page, once it is ready
let pendingPreset = null;    // a preset chosen before the Convert page finished loading

// Files shared from the Android Share sheet wait for the Convert page with this.
let resolveConvertReady;
let rejectConvertReady;
const convertReady = new Promise((resolve, reject) => { resolveConvertReady = resolve; rejectConvertReady = reject; });
convertReady.catch(() => {}); // the visitor already sees the message from startConvertPage

async function startConvertPage() {
  const root = document.getElementById('convert-root');
  if (!root) return;
  try {
    const [{ mountConvertPage }, { createConvertServices }, registry] = await Promise.all([
      import('./ui/convert.js'),
      import('./ui/services.js'),
      import('./core/registry.js'),
      import('./converters/image.js'), // registers the image converters
      import('./converters/docs.js'), // registers the document and data converters
      import('./converters/pdf-register.js'), // registers images to PDF, PDF to images, PDF to text and PDF compress
    ]);
    convertPage = mountConvertPage(root, createConvertServices(registry));
    if (pendingPreset) { convertPage.applyPreset(pendingPreset); pendingPreset = null; }
    document.documentElement.setAttribute('data-ready', ''); // js/file-check.js watches for this
    resolveConvertReady(convertPage);
  } catch (err) {
    console.error('Convert page failed to start', err);
    const message = document.createElement('p');
    message.className = 'convert-loading';
    message.textContent = 'The converter could not start. Please reload the page.';
    root.replaceChildren(message);
    rejectConvertReady(err);
  }
}

// "Use preset" on the Presets page: hand the preset to the Convert page and go there.
function usePreset(preset) {
  if (convertPage) convertPage.applyPreset(preset);
  else pendingPreset = preset;
  location.hash = '#/convert';
}

// Presets and Proof are built on each visit, so they always show current data.
// Their code is loaded only when the page is first opened, to keep the first load small.
let proofPage = null;
let pdfToolsMounted = false;
async function mountLazyPage(route) {
  proofPage?.disconnect(); // stop watching requests when the visitor leaves Proof
  proofPage = null;
  try {
    if (route === 'pdf') {
      // Built once and kept, so the files you picked are still there when you come back from another page.
      if (!pdfToolsMounted) {
        pdfToolsMounted = true;
        try {
          const { mountPdfTools } = await import('./ui/pdf-tools.js');
          mountPdfTools(document.getElementById('pdf-root'));
        } catch (err) { pdfToolsMounted = false; throw err; }
      }
    } else if (route === 'presets') {
      const { mountPresetsPage } = await import('./ui/presets-page.js');
      mountPresetsPage(document.getElementById('presets-root'), { onApplyPreset: usePreset });
    } else if (route === 'proof') {
      const { mountProofPage } = await import('./ui/proof.js');
      // Our shipped engines live under js/vendor/. connect-src is 'self', so no other engine address is approved.
      proofPage = mountProofPage(document.getElementById('proof-root'), { enginePathMarkers: ['/js/vendor/'] });
    }
  } catch (err) {
    console.error('Page failed to load', err);
    const root = document.getElementById(`${route}-root`);
    const message = document.createElement('p');
    message.textContent = 'This page could not load. Please reload the page.';
    root?.replaceChildren(message);
  }
}

// route name -> its <section>. The HTML decides which pages exist
// (each section has data-page="..."). We build this map once.
const pages = new Map();
for (const section of document.querySelectorAll('.page[data-page]')) {
  pages.set(section.dataset.page, section);
}

const navButtons = document.querySelectorAll('.nav-btn[data-route]');

// "#/presets" -> "presets". An empty or unknown hash falls back to the default.
function routeFromHash(hash) {
  const name = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  return pages.has(name) ? name : DEFAULT_ROUTE;
}

function showRoute(route, moveFocus) {
  for (const [name, section] of pages) {
    section.hidden = name !== route;
  }

  for (const button of navButtons) {
    if (button.dataset.route === route) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  }

  const section = pages.get(route);
  document.title = section.dataset.title;

  // After the visitor changes page, start at the top and put keyboard and
  // screen reader focus on the new page title. Not done on first load.
  if (moveFocus) {
    window.scrollTo(0, 0);
    section.querySelector('h1')?.focus({ preventScroll: true });
  }
}

function handleRouteChange(moveFocus) {
  const route = routeFromHash(location.hash);

  // Tidy the address bar, for example "" or "#/nonsense" becomes "#/convert".
  // replaceState does not add a history entry, so Back still works.
  const wanted = `#/${route}`;
  if (location.hash !== wanted) {
    history.replaceState(null, '', wanted);
  }

  showRoute(route, moveFocus);
  mountLazyPage(route);
}

// One listener for every button that has data-route (nav buttons, Private chip).
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-route]');
  if (button) {
    location.hash = `#/${button.dataset.route}`;
  }
});

// The skip link must not touch the hash, or the router would reset the page.
document.querySelector('.skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('.page:not([hidden]) h1')?.focus();
});

// The Settings dialog is loaded the first time it is opened.
let settingsDialog = null;
document.getElementById('settings-btn')?.addEventListener('click', async () => {
  try {
    if (!settingsDialog) {
      const { mountSettingsDialog } = await import('./ui/settings.js');
      settingsDialog = mountSettingsDialog({});
    }
    settingsDialog.open();
  } catch (err) {
    console.error('Settings failed to load', err);
  }
});

window.addEventListener('hashchange', () => handleRouteChange(true));

handleRouteChange(false);
startConvertPage();
initThemeToggle(document.getElementById('theme-toggle'));

// Offline mode, the install card and the Share Target. Loaded after the first paint.
// Shared files are added to the Convert page like dropped files.
import('./core/pwa.js')
  .then(({ initPwa }) => initPwa({ onFiles: async (files) => (await convertReady).addFiles(files) }))
  .catch((err) => console.error('Offline features failed to start', err));
