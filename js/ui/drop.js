// Getting files into the page: window-wide drop, folder drops, paste, and the
// file pickers. Everything returns plain { file, path } entries.
import { isHiddenName } from './format.js';

export const MAX_FILES_PER_ADD = 200;
const MAX_DEPTH = 12;

const readEntries = (reader) => new Promise((resolve, reject) => reader.readEntries(resolve, reject));
const readFile = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

async function walk(entry, prefix, out, state, depth) {
  if (state.count >= MAX_FILES_PER_ADD) { state.truncated = true; return; }
  try {
    if (entry.isFile) {
      if (isHiddenName(entry.name)) { state.hidden++; return; }
      out.push({ file: await readFile(entry), path: `${prefix}${entry.name}` });
      state.count++;
    } else if (entry.isDirectory && depth < MAX_DEPTH) {
      const reader = entry.createReader();
      // readEntries returns at most ~100 items per call: keep asking until it is empty
      for (;;) {
        const batch = await readEntries(reader);
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out, state, depth + 1);
        if (state.count >= MAX_FILES_PER_ADD) { state.truncated = true; break; }
      }
    }
  } catch {
    state.unreadable++; // one unreadable file or folder must not stop the rest
  }
}

// IMPORTANT: call this straight from the drop handler. The browser empties
// dataTransfer.items after the first `await`, so we read it before any await.
export async function filesFromDataTransfer(dt) {
  const state = { count: 0, truncated: false, hidden: 0, unreadable: 0 };
  const entries = [];
  const plain = Array.from(dt.files ?? []);
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const out = [];
  if (!entries.length) {
    for (const file of plain) {
      if (isHiddenName(file.name)) state.hidden++;
      else if (out.length < MAX_FILES_PER_ADD) out.push({ file, path: file.name });
      else state.truncated = true;
    }
    return { entries: out, ...state };
  }
  for (const entry of entries) await walk(entry, '', out, state, 0);
  return { entries: out, ...state };
}

export function entriesFromInput(input) {
  const out = [];
  let hidden = 0;
  for (const file of Array.from(input.files ?? [])) {
    if (isHiddenName(file.name)) { hidden++; continue; }
    out.push({ file, path: file.webkitRelativePath || file.name });
  }
  const truncated = out.length > MAX_FILES_PER_ADD;
  return { entries: out.slice(0, MAX_FILES_PER_ADD), truncated, hidden, unreadable: 0 };
}

// The whole window is the drop target. `overlay` shows the dim + glowing ring.
export function attachDropTarget(overlay, onResult, onError) {
  let depth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const show = (on) => overlay.classList.toggle('is-active', on);

  const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(true); };
  const over = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const leave = (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  };
  const reset = () => { depth = 0; show(false); };
  const drop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // otherwise the browser opens the file and leaves our page
    reset();
    filesFromDataTransfer(e.dataTransfer).then(onResult, onError);
  };

  window.addEventListener('dragenter', enter);
  window.addEventListener('dragover', over);
  window.addEventListener('dragleave', leave);
  window.addEventListener('drop', drop);
  window.addEventListener('dragend', reset);
  window.addEventListener('blur', reset);
  return () => {
    window.removeEventListener('dragenter', enter);
    window.removeEventListener('dragover', over);
    window.removeEventListener('dragleave', leave);
    window.removeEventListener('drop', drop);
    window.removeEventListener('dragend', reset);
    window.removeEventListener('blur', reset);
  };
}

const PASTE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' };

// Ctrl+V (or Cmd+V, or the paste menu on a phone). Text pastes are left alone.
export function attachPaste(onResult) {
  let n = 0;
  const handler = (e) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    const entries = files.map((file) => {
      // Screenshots arrive as "image.png". Give each one its own name.
      if (file.name && !/^image\.[a-z0-9]+$/i.test(file.name)) return { file, path: file.name };
      const ext = PASTE_EXT[file.type] ?? 'png';
      const named = new File([file], `pasted-image-${++n}.${ext}`, { type: file.type, lastModified: file.lastModified });
      return { file: named, path: named.name };
    });
    onResult({ entries, truncated: false, hidden: 0, unreadable: 0 });
  };
  document.addEventListener('paste', handler);
  return () => document.removeEventListener('paste', handler);
}
