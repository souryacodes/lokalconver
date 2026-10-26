// Loads one classic (UMD) script on first use and returns its global. Used for libraries that need the DOM.
// The page's Content-Security-Policy only has to allow script-src 'self'.
const cache = new Map();

export function loadClassicScript(url, globalName) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => (globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error('missing global')));
      s.onerror = () => { cache.delete(url); reject(new Error('script failed')); };
      document.head.append(s);
    }));
  }
  return cache.get(url);
}
