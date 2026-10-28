import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCsp } from '../js/ui/proof.js';
import {
  ACCENT_CHOICES,
  DEFAULT_SETTINGS,
  readSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  SOUND_STORAGE_KEY,
  resolveTheme,
} from '../js/ui/settings.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

test('CSP plain-language text explains allowed sources and browser blocking', () => {
  const lines = describeCsp("default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:");
  assert.ok(lines.some((line) => line.includes('Scripts:')));
  assert.ok(lines.some((line) => line.includes('Network connections')));
  assert.ok(lines.some((line) => line.includes('blocked by the browser')));
  assert.ok(lines.some((line) => line.includes('does not inspect request bodies')));
});

test('header-only CSP not visible to page code is not guessed', () => {
  const lines = describeCsp('');
  assert.ok(lines.some((line) => line.includes('cannot be read by page JavaScript')));
});

test('settings persist only validated theme, accent, sound and motion choices', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(readSettings(storage), { ...DEFAULT_SETTINGS });
  const result = saveSettings({ theme: 'light', accent: 'rose', sound: true, motion: 'reduce' }, storage);
  assert.equal(result.saved, true);
  assert.deepEqual(readSettings(storage), { theme: 'light', accent: 'rose', sound: true, motion: 'reduce' });
  assert.equal(storage.getItem(SETTINGS_STORAGE_KEY) !== null, true);
  assert.equal(ACCENT_CHOICES.length, 4);
});

test('invalid stored settings fall back to safe defaults', () => {
  const storage = new MemoryStorage();
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'remote', accent: 'url(javascript:bad)', sound: 'yes', motion: 'flash' }));
  assert.deepEqual(readSettings(storage), { ...DEFAULT_SETTINGS });
});

test('theme and sound reuse the keys the header button and Convert page already use', () => {
  const storage = new MemoryStorage();
  saveSettings({ theme: 'light', sound: true }, storage);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'light');
  assert.equal(storage.getItem(SOUND_STORAGE_KEY), '1');
  // "Use system" means no saved theme, so the page follows the system again.
  saveSettings({ theme: 'system' }, storage);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), null);
  assert.equal(readSettings(storage).theme, 'system');
});

test('a theme saved by the header button is shown in Settings', () => {
  const storage = new MemoryStorage();
  storage.setItem(THEME_STORAGE_KEY, 'dark');
  assert.equal(readSettings(storage).theme, 'dark');
  storage.setItem(THEME_STORAGE_KEY, 'neon');
  assert.equal(readSettings(storage).theme, 'system');
});

test('system theme resolves to dark or light, never to a name the CSS does not know', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('system', () => ({ matches: true })), 'light');
  assert.equal(resolveTheme('system', () => ({ matches: false })), 'dark');
  assert.equal(resolveTheme('system', () => { throw new Error('no matchMedia'); }), 'dark');
});
