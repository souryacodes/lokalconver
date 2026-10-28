// Plain logic for the PWA parts. No DOM here, so Node tests can run it.

// Keys end up in localStorage. They stay on this device and are never sent anywhere.
export const KEYS = {
  visits: 'lokalconver.pwa.visits',
  conversions: 'lokalconver.pwa.conversions',
  dismissed: 'lokalconver.pwa.install-dismissed',
  installed: 'lokalconver.pwa.installed',
  session: 'lokalconver.pwa.session', // sessionStorage: "this visit is already counted"
};

// Which chip to show. "Offline" wins: it is a fact about right now.
// "Works offline" only when the service worker really has the shell cached.
export function chipState({ online, shellReady }) {
  if (!online) return 'offline';
  return shellReady ? 'works-offline' : 'none';
}

// Storage can throw (private mode, blocked by the browser). Then we fall back
// to memory, so the app never breaks because of a counter.
export function safeStorage(storage) {
  const memory = new Map();
  return {
    get(key) {
      try {
        const value = storage.getItem(key);
        return value === null ? (memory.get(key) ?? null) : value;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, String(value));
      try {
        storage.setItem(key, String(value));
      } catch {
        // memory copy is enough for this visit
      }
    },
  };
}

// The polite install prompt. Rules:
//  - needs 2 successful conversions in total;
//  - never during the very first visit;
//  - never again once the person said no thanks, or has installed;
//  - at most once per visit;
//  - only if the browser gave us an install prompt (Chromium browsers) and the
//    app is not already running installed.
export function createInstallPolicy(local, session) {
  const num = (key) => Number(local.get(key)) || 0;
  let shownThisVisit = false;

  return {
    // Call once when the app starts. Returns the visit number (1 = first visit).
    startVisit() {
      if (session.get(KEYS.session) !== '1') {
        session.set(KEYS.session, '1');
        local.set(KEYS.visits, num(KEYS.visits) + 1);
      }
      return num(KEYS.visits);
    },
    // Call after each successful conversion. Returns the new total.
    recordConversion() {
      const total = num(KEYS.conversions) + 1;
      local.set(KEYS.conversions, total);
      return total;
    },
    shouldOffer({ hasPrompt, standalone }) {
      return (
        hasPrompt &&
        !standalone &&
        !shownThisVisit &&
        num(KEYS.conversions) >= 2 &&
        num(KEYS.visits) >= 2 &&
        local.get(KEYS.dismissed) !== '1' &&
        local.get(KEYS.installed) !== '1'
      );
    },
    markShown() {
      shownThisVisit = true;
    },
    markDismissed() {
      local.set(KEYS.dismissed, '1');
    },
    markInstalled() {
      local.set(KEYS.installed, '1');
    },
  };
}
