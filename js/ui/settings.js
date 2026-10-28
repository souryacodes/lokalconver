import { readPersonalStats, resetPersonalStats } from './receipt.js';

export const SETTINGS_STORAGE_KEY = 'lokalconver.settings.v1';
// The theme and the sound choice already had keys before this dialog existed.
// We reuse them, so the header button, the Convert page and Settings never disagree.
export const THEME_STORAGE_KEY = 'lokalconver-theme';
export const SOUND_STORAGE_KEY = 'lokalconver.sound';
export const SETTINGS_CHANGED_EVENT = 'lokalconver:settings-changed';
export const ACCENT_CHOICES = [
  { id: 'violet', label: 'Violet', value: '#7C5CFF' },
  { id: 'cyan', label: 'Cyan', value: '#22D3EE' },
  { id: 'amber', label: 'Amber', value: '#F59E0B' },
  { id: 'rose', label: 'Rose', value: '#FB7185' },
];
export const DEFAULT_SETTINGS = Object.freeze({ theme: 'system', accent: 'violet', sound: false, motion: 'system' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function safeGet(target, key) {
  try { return target.getItem(key); } catch { return null; }
}

export function readSettings(storage) {
  const target = getStorage(storage);
  const result = { ...DEFAULT_SETTINGS };
  if (!target) return result;
  const theme = safeGet(target, THEME_STORAGE_KEY);
  if (theme === 'dark' || theme === 'light') result.theme = theme; // no saved choice = follow the system
  result.sound = safeGet(target, SOUND_STORAGE_KEY) === '1';
  try {
    const stored = JSON.parse(safeGet(target, SETTINGS_STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      if (ACCENT_CHOICES.some((choice) => choice.id === stored.accent)) result.accent = stored.accent;
      if (['system', 'reduce', 'allow'].includes(stored.motion)) result.motion = stored.motion;
    }
  } catch { /* broken JSON: keep the defaults */ }
  return result;
}

// The page's theme tokens only know "dark" and "light", so "system" is resolved here.
export function resolveTheme(theme, matchMediaFn = globalThis.matchMedia) {
  if (theme === 'dark' || theme === 'light') return theme;
  try { return matchMediaFn?.call(globalThis, '(prefers-color-scheme: light)')?.matches ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applySettings(settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(settings.theme);
  root.dataset.motion = settings.motion;
  const accent = ACCENT_CHOICES.find((choice) => choice.id === settings.accent) || ACCENT_CHOICES[0];
  // Dataset-driven colors avoid inline style attributes under a strict CSP.
  root.dataset.accent = accent.id;
  globalThis.dispatchEvent?.(new CustomEvent(SETTINGS_CHANGED_EVENT)); // the header button and Convert page listen
}

export function saveSettings(patch, storage) {
  const target = getStorage(storage);
  const next = { ...readSettings(target), ...patch };
  // Re-validate here so stale or edited localStorage values cannot set arbitrary CSS values.
  if (!['system', 'dark', 'light'].includes(next.theme)) next.theme = DEFAULT_SETTINGS.theme;
  if (!ACCENT_CHOICES.some((choice) => choice.id === next.accent)) next.accent = DEFAULT_SETTINGS.accent;
  if (typeof next.sound !== 'boolean') next.sound = DEFAULT_SETTINGS.sound;
  if (!['system', 'reduce', 'allow'].includes(next.motion)) next.motion = DEFAULT_SETTINGS.motion;
  applySettings(next);
  if (!target) return { saved: false, settings: next };
  try {
    if (next.theme === 'system') target.removeItem?.(THEME_STORAGE_KEY);
    else target.setItem(THEME_STORAGE_KEY, next.theme);
    target.setItem(SOUND_STORAGE_KEY, next.sound ? '1' : '0');
    target.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ accent: next.accent, motion: next.motion }));
    return { saved: true, settings: next };
  } catch {
    return { saved: false, settings: next };
  }
}

function formatSavedMB(bytes) {
  const value = bytes / (1024 * 1024);
  const sign = value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)} MB`;
}

async function deleteDatabase(name) {
  if (!globalThis.indexedDB) return;
  await new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Clear storage surfaces used by this origin; this cannot clear browser history or downloaded files. */
export async function clearAllLocalData() {
  const results = { localStorage: false, sessionStorage: false, caches: false, indexedDB: false };
  try { globalThis.localStorage?.clear(); results.localStorage = true; } catch { /* blocked by browser */ }
  try { globalThis.sessionStorage?.clear(); results.sessionStorage = true; } catch { /* blocked by browser */ }

  if (globalThis.caches?.keys && globalThis.caches?.delete) {
    try {
      const names = await globalThis.caches.keys();
      await Promise.all(names.map((name) => globalThis.caches.delete(name)));
      results.caches = true;
    } catch { /* cache storage can be unavailable in private modes */ }
  }
  if (globalThis.indexedDB?.databases) {
    try {
      const databases = await globalThis.indexedDB.databases();
      await Promise.all((databases || []).filter((db) => db.name).map((db) => deleteDatabase(db.name)));
      results.indexedDB = true;
    } catch { /* not all browsers expose database enumeration */ }
  }
  globalThis.dispatchEvent?.(new CustomEvent('lokalconver:local-data-cleared', { detail: { ...results } }));
  applySettings({ ...DEFAULT_SETTINGS });
  return results;
}

function createSelect(id, labelText, options, selected) {
  const label = el('label', 'lc-setting-row');
  label.htmlFor = id;
  label.append(el('span', 'lc-setting-label', labelText));
  const select = el('select', 'lc-setting-control');
  select.id = id;
  for (const option of options) {
    const item = el('option', '', option.label);
    item.value = option.value;
    item.selected = option.value === selected;
    select.append(item);
  }
  label.append(select);
  return { label, control: select };
}

function createCheckbox(id, labelText, checked) {
  const label = el('label', 'lc-setting-row lc-setting-checkbox');
  const text = el('span', 'lc-setting-label', labelText);
  const input = el('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  label.append(text, input);
  return { label, control: input };
}

/** Attach a Settings button to the UI and mount its accessible native dialog. */
export function mountSettingsDialog({ trigger, parent = document.body, storage } = {}) {
  const dialog = el('dialog', 'lc-settings-dialog');
  dialog.setAttribute('aria-labelledby', 'lc-settings-title');
  parent.append(dialog);
  let controls = {};
  let status = null;

  const renderDialog = () => {
    dialog.replaceChildren();
    const header = el('div', 'lc-settings-header');
    header.append(el('h2', '', 'Settings'));
    const close = el('button', 'lc-button lc-button-secondary', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    header.append(close);
    const title = header.querySelector('h2');
    title.id = 'lc-settings-title';

    const current = readSettings(storage);
    const form = el('form', 'lc-settings-form');
    form.addEventListener('submit', (event) => event.preventDefault());
    const theme = createSelect('lc-setting-theme', 'Theme', [
      { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Use system' },
    ], current.theme);
    const accent = createSelect('lc-setting-accent', 'Accent colour', ACCENT_CHOICES.map((choice) => ({ value: choice.id, label: choice.label })), current.accent);
    const sound = createCheckbox('lc-setting-sound', 'Sound', current.sound);
    const motion = createSelect('lc-setting-motion', 'Reduce motion override', [
      { value: 'system', label: 'Use system setting' }, { value: 'reduce', label: 'Reduce motion' }, { value: 'allow', label: 'Allow motion' },
    ], current.motion);
    form.append(theme.label, accent.label, sound.label, motion.label);
    controls = { theme: theme.control, accent: accent.control, sound: sound.control, motion: motion.control };

    const saveCurrent = () => {
      const result = saveSettings({
        theme: controls.theme.value,
        accent: controls.accent.value,
        sound: controls.sound.checked,
        motion: controls.motion.value,
      }, storage);
      status.textContent = result.saved ? 'Settings saved on this device.' : 'Settings applied for this session; local storage is unavailable.';
    };
    for (const control of Object.values(controls)) control.addEventListener('change', saveCurrent);

    const statsSection = el('section', 'lc-settings-stats');
    statsSection.append(el('h3', '', 'Personal stats (stored only in localStorage)'));
    const stats = readPersonalStats(storage);
    const filesStat = el('p', 'lc-setting-files-stat', `Files converted: ${stats.filesConverted}`);
    const savedStat = el('p', 'lc-setting-saved-stat', `Net MB saved: ${formatSavedMB(stats.bytesSaved)}`);
    statsSection.append(filesStat, savedStat);
    const resetStats = el('button', 'lc-button lc-button-secondary', 'Reset stats');
    resetStats.type = 'button';
    resetStats.addEventListener('click', () => {
      if (!globalThis.confirm?.('Reset personal conversion stats? This cannot be undone.')) return;
      if (resetPersonalStats(storage)) {
        filesStat.textContent = 'Files converted: 0';
        savedStat.textContent = 'Net MB saved: 0.00 MB';
        status.textContent = 'Personal stats reset.';
      } else {
        status.textContent = 'Stats could not be reset because local storage is unavailable.';
      }
    });
    statsSection.append(resetStats);

    const dataSection = el('section', 'lc-settings-data');
    dataSection.append(el('h3', '', 'Local data'));
    dataSection.append(el('p', 'lc-muted', 'Clearing local data removes this origin’s localStorage, sessionStorage, Cache Storage and discoverable IndexedDB databases. It does not remove browser history or downloaded files.'));
    const clear = el('button', 'lc-button lc-button-danger', 'Clear all local data');
    clear.type = 'button';
    clear.addEventListener('click', async () => {
      if (!globalThis.confirm?.('Clear all local data for this site? This cannot be undone.')) return;
      clear.disabled = true;
      try {
        await clearAllLocalData();
        // Do not write defaults back to storage: clearing should actually clear saved preferences too.
        for (const control of Object.values(controls)) control.removeEventListener('change', saveCurrent);
        renderDialog();
        status.textContent = 'Local data cleared. Defaults are active for this session.';
        const newStatus = dialog.querySelector('.lc-settings-status');
        if (newStatus) newStatus.textContent = status.textContent;
      } finally {
        clear.disabled = false;
      }
    });
    dataSection.append(clear);
    status = el('p', 'lc-settings-status');
    status.setAttribute('role', 'status');
    dialog.append(header, form, statsSection, dataSection, status);
    applySettings(current);
  };

  renderDialog();
  const open = () => {
    renderDialog(); // values can change while the dialog is closed (header theme button, new batch)
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  if (trigger) trigger.addEventListener('click', open);
  return { dialog, open, close: () => dialog.close(), refresh: renderDialog };
}
