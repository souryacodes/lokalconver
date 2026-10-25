// Runs before the page is drawn (it is a plain blocking script in <head>),
// so the visitor never sees a flash of the wrong theme.
// Order of choice: saved choice, then the system setting, then dark.
// Keep the storage key in sync with js/theme.js.
{
  let theme = 'dark';
  let saved = null;

  try {
    saved = localStorage.getItem('lokalconver-theme');
  } catch {
    // Storage can be blocked (private mode). Fall through to the system setting.
  }

  if (saved === 'dark' || saved === 'light') {
    theme = saved;
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    theme = 'light';
  }

  document.documentElement.dataset.theme = theme;
}
