// Theme toggle (dark / light).
// js/theme-init.js already picked the first theme before the page was drawn.
// This file runs the button, remembers the choice and keeps the labels right.

const STORAGE_KEY = 'lokalconver-theme'; // keep in sync with js/theme-init.js

function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode). The choice then lasts one visit.
  }
}

function applyTheme(theme, button) {
  document.documentElement.dataset.theme = theme;

  // The label says what the button WILL do, which is what a screen reader needs.
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
  button.setAttribute('aria-label', label);
  button.title = label;

  // Make the phone's browser bar match the page. The colour is read from
  // tokens.css so it is written down in only one place.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function initThemeToggle(button) {
  // Sync labels with the theme that was already chosen. We do NOT save here,
  // so a visitor who never clicks keeps following their system setting.
  applyTheme(currentTheme(), button);

  // Settings (or "Clear all local data") can change the theme without this button.
  window.addEventListener('lokalconver:settings-changed', () => applyTheme(currentTheme(), button));

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next, button);
    saveTheme(next);
  });
}
