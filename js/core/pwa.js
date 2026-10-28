// PWA wiring: service worker, offline chip, update toast, polite install
// prompt, and files shared from the Android Share sheet.
//
// Use:  initPwa({ onFiles })   once, after the first paint (app.js does this)
//
// Counting conversions: the Convert page announces each successful conversion
// with the window event 'lokalconver:conversion-done', like it does for settings.
// Nothing here talks to the network except registering ./service-worker.js.

import { chipState, createInstallPolicy, safeStorage } from './pwa-state.js';
import { readShareParams, takeSharedFiles } from './share-intake.js';
import { STRINGS, createChip, hideToast, showInstallCard, showToast } from './pwa-ui.js';

const SW_URL = './service-worker.js';
const STATUS_TIMEOUT_MS = 3000;
// The shell download starts this long after the page has loaded, so it never
// competes with the first load (budget: 200 KB).
const REGISTER_DELAY_MS = 3000;

let chip = null;
let shellReady = false;
let deferredPrompt = null; // the browser's install prompt (Chromium only)
let reloadRequested = false;
let policy = null;

// Reading window.localStorage can throw (blocked cookies). Do it inside try,
// and fall back to memory-only counters.
function browserStore(name) {
  try {
    return safeStorage(window[name]);
  } catch {
    return safeStorage({ getItem: () => null, setItem: () => {} });
  }
}

export function initPwa({ onFiles } = {}) {
  policy = createInstallPolicy(browserStore('localStorage'), browserStore('sessionStorage'));
  policy.startVisit();
  chip = createChip();
  updateChip();
  window.addEventListener('online', updateChip);
  window.addEventListener('offline', updateChip);

  window.addEventListener('lokalconver:conversion-done', onConversionDone);
  startInstallPrompt();
  if (typeof onFiles === 'function') startShareIntake(onFiles);
  else if (readShareParams(location.search)) console.warn('initPwa: pass onFiles to receive shared files.');
  startServiceWorker();
}

function onConversionDone() {
  policy.recordConversion();
  maybeOfferInstall();
}

// ------------------------------------------------------------ service worker

function startServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const start = () => setTimeout(register, REGISTER_DELAY_MS);
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

async function register() {
  try {
    // updateViaCache 'none': also fetch precache-manifest.js fresh when checking
    // for updates. The default would let the HTTP cache hide a new release.
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' });
    watchForUpdates(registration);
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SHELL_READY') checkShell(registration);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // The first visit also changes controller (the worker claims the page).
      // Only reload when the person asked for the update.
      if (reloadRequested) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
    await navigator.serviceWorker.ready; // resolves once a worker is active (= installed)
    checkShell(registration);
  } catch (error) {
    console.warn('Service worker not registered:', error);
  }
}

function watchForUpdates(registration) {
  // A new version only counts as an update when an old one already controls this page.
  if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
    });
  });
}

function offerUpdate(worker) {
  showToast({
    message: STRINGS.updateReady,
    timeoutMs: 0,
    actions: [
      {
        label: STRINGS.reload,
        onClick: () => {
          reloadRequested = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        },
      },
      { label: STRINGS.later, onClick: () => {} },
    ],
  });
}

// ---------------------------------------------------------------- offline chip

// Ask the worker if the shell is really in the cache. The chip says "Works
// offline" only on a real "yes".
async function checkShell(registration) {
  const worker = registration.active;
  if (!worker) return;
  shellReady = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), STATUS_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(Boolean(event.data && event.data.ready));
    };
    worker.postMessage({ type: 'GET_STATUS' }, [channel.port2]);
  });
  updateChip();
}

function updateChip() {
  chip.show(chipState({ online: navigator.onLine, shellReady }));
}

// -------------------------------------------------------------- install prompt

function startInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // we choose the moment, not the browser
    deferredPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    policy.markInstalled();
    deferredPrompt = null;
  });
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function maybeOfferInstall() {
  if (!policy.shouldOffer({ hasPrompt: Boolean(deferredPrompt), standalone: isStandalone() })) return;
  policy.markShown();
  showInstallCard({
    onInstall: async () => {
      const prompt = deferredPrompt;
      deferredPrompt = null; // a prompt can be used only once
      if (!prompt) return;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome !== 'accepted') policy.markDismissed();
    },
    onDismiss: () => policy.markDismissed(),
  });
}

// ---------------------------------------------------------------- share target

async function startShareIntake(onFiles) {
  const params = readShareParams(location.search);
  if (!params) return;
  // Remove the query first, so a refresh does not run this a second time.
  history.replaceState(null, '', location.pathname + location.hash);

  if (params.error) return showToast({ message: STRINGS.shareError });

  let files = [];
  try {
    files = params.batchId ? await takeSharedFiles(params.batchId) : [];
  } catch (error) {
    return showToast({ message: STRINGS.shareError });
  }
  const parts = [];
  if (files.length) {
    try {
      await onFiles(files); // may wait until the Convert page is ready
    } catch (error) {
      return showToast({ message: STRINGS.shareError });
    }
    parts.push(STRINGS.opened(files.length));
  } else {
    parts.push(STRINGS.shareNothing);
  }
  if (params.skipped && files.length) parts.push(STRINGS.skipped(params.skipped));
  hideToast();
  showToast({ message: parts.join(' ') });
}
