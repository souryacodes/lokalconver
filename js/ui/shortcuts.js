// The "?" help box. A native <dialog>: the browser handles focus trapping
// and Esc for us.
import { el } from './dom.js';

const ROWS = [
  [['Enter'], 'Convert all files'],
  [['Esc'], 'Clear the list (you can undo). Closes this box first.'],
  [['Ctrl', 'V'], 'Paste an image from the clipboard'],
  [['?'], 'Show or hide this box'],
];

export function createShortcutsDialog() {
  const dialog = el('dialog', { class: 'cv-dialog', 'aria-labelledby': 'cv-shortcuts-title' });
  const list = el('dl', { class: 'cv-keys' });
  for (const [keys, text] of ROWS) {
    const combo = el('dt', {}, keys.flatMap((k, i) => (i ? ['+', el('kbd', { text: k })] : [el('kbd', { text: k })])));
    list.append(combo, el('dd', { text: text }));
  }
  const close = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Close', onclick: () => api.close() });
  dialog.append(
    el('h2', { id: 'cv-shortcuts-title', class: 'cv-dialog__title', text: 'Keyboard shortcuts' }),
    list,
    el('p', { class: 'cv-dialog__note', text: 'On a Mac, use Cmd instead of Ctrl.' }),
    el('div', { class: 'cv-dialog__actions' }, close),
  );
  // a click on the dark backdrop closes it
  dialog.addEventListener('click', (e) => { if (e.target === dialog) api.close(); });

  const api = {
    element: dialog,
    get isOpen() { return dialog.open; },
    open() {
      if (dialog.open) return;
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    },
    close() {
      if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    },
  };
  return api;
}
