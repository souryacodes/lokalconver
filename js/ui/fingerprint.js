// File Fingerprint: SHA-256 of any file, a copy button, and a "paste the expected hash" check.
// Everything runs in the browser. The file is never uploaded.
import { createDropzone } from './dropzone.js';
import { sha256OfFile, compareHashes } from '../core/hash.js';
import { friendlyMessage } from '../core/errors.js';
import { formatBytes } from '../core/limits.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function mountFingerprint(root) {
  root.classList.add('lc-scope');
  const section = el('section', 'lc-section');
  const h2 = el('h2', '', 'File fingerprint (SHA-256)');
  h2.id = 'lc-fp-title';
  section.setAttribute('aria-labelledby', 'lc-fp-title');
  section.append(h2, el('p', 'lc-muted', 'Drop any file to get its SHA-256 fingerprint. It is worked out on this device. The file is not uploaded.'));

  let actual = '';
  let token = 0;

  const status = el('p', 'lc-status');
  status.setAttribute('role', 'status');
  const result = el('div', 'lc-card');
  result.hidden = true;
  const fileLine = el('div', 'lc-file-head');
  const nameEl = el('span', 'lc-name');
  const sizeEl = el('span', 'lc-size');
  fileLine.append(nameEl, sizeEl);
  const hashEl = el('code', 'lc-hash');
  hashEl.tabIndex = 0;
  hashEl.id = 'lc-fp-hash';
  const copyBtn = el('button', 'lc-btn', 'Copy fingerprint');
  copyBtn.type = 'button';
  const copyNote = el('span', 'lc-note');
  copyNote.setAttribute('role', 'status');

  const field = el('div', 'lc-field');
  const lbl = el('label', '', 'Expected SHA-256 (paste it here to compare)');
  lbl.htmlFor = 'lc-fp-expected';
  const input = el('input', 'lc-input');
  input.id = 'lc-fp-expected';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('inputmode', 'text');
  field.append(lbl, input);
  const verdict = el('p', 'lc-verdict');
  verdict.setAttribute('role', 'status');

  const actions = el('div', 'lc-actions');
  actions.append(copyBtn, copyNote);
  result.append(fileLine, hashEl, actions, field, verdict);

  function showVerdict() {
    verdict.className = 'lc-verdict';
    verdict.replaceChildren();
    if (!actual) { verdict.textContent = 'Drop a file above to compare it.'; return; }
    const { status: s } = compareHashes(actual, input.value);
    const word = (t, rest) => { const b = el('b', '', t); verdict.append(b, document.createTextNode(` ${rest}`)); };
    if (s === 'match') { verdict.classList.add('is-match'); word('✓ Match', 'This file has the same fingerprint as the one you pasted.'); }
    else if (s === 'different') { verdict.classList.add('is-different'); word('✗ Different', 'This is not the same file, or the file has changed.'); }
    else if (s === 'invalid') { verdict.classList.add('is-invalid'); word('Not a SHA-256', 'It should be 64 letters and digits (0-9 and a-f).'); }
    else verdict.textContent = 'Paste the expected fingerprint above to compare.';
  }

  async function handle(files) {
    const file = files[0];
    const mine = ++token;
    actual = '';
    result.hidden = false;
    nameEl.textContent = file.name;
    sizeEl.textContent = formatBytes(file.size);
    hashEl.textContent = 'Calculating… (large files can take a few seconds)';
    copyBtn.disabled = true;
    copyNote.textContent = '';
    status.textContent = '';
    showVerdict();
    try {
      const hex = await sha256OfFile(file);
      if (mine !== token) return; // a newer file was dropped meanwhile
      actual = hex;
      hashEl.textContent = hex;
      copyBtn.disabled = false;
      showVerdict();
    } catch (err) {
      if (mine !== token) return;
      hashEl.textContent = '';
      status.textContent = friendlyMessage(err);
      status.className = 'lc-status lc-error';
      status.setAttribute('role', 'alert');
      return;
    }
    status.className = 'lc-status';
    status.setAttribute('role', 'status');
  }

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(actual);
      copyNote.textContent = 'Copied.';
    } catch {
      // No clipboard permission: select the text so Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(hashEl);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      copyNote.textContent = 'Selected. Press Ctrl+C (or long-press) to copy.';
    }
    setTimeout(() => { copyNote.textContent = ''; }, 3000);
  });
  input.addEventListener('input', showVerdict);

  section.append(createDropzone({ title: 'Drop a file here, or choose one', hint: 'Any file type, up to 512 MB', multiple: false, onFiles: handle }), status, result);
  root.append(section);
  return { section };
}
