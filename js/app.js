// LokalConver - entry point.
// For now it does two small jobs: a hash router and the theme toggle.

import { initThemeToggle } from './theme.js';

const DEFAULT_ROUTE = 'convert';

// The Convert page is loaded after the first paint, so the first load stays small.
// If it fails to load, the visitor sees a plain message, not a blank page.
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
    ]);
    mountConvertPage(root, createConvertServices(registry));
    document.documentElement.setAttribute('data-ready', ''); // js/file-check.js watches for this
  } catch (err) {
    console.error('Convert page failed to start', err);
    const message = document.createElement('p');
    message.className = 'convert-loading';
    message.textContent = 'The converter could not start. Please reload the page.';
    root.replaceChildren(message);
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

window.addEventListener('hashchange', () => handleRouteChange(true));

handleRouteChange(false);
startConvertPage();
initThemeToggle(document.getElementById('theme-toggle'));
