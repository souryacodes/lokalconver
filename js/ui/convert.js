// The Convert page (#/convert).
//
//   import { mountConvertPage } from './ui/convert.js';
//   const page = mountConvertPage(document.querySelector('#view'), { suggestTarget, findConverter });
//   ...later, when the router leaves this page: page.destroy();
//
// `services` is what this page needs from the rest of the app:
//   suggestTarget(fromExt, file) -> 'jpg' | ['jpg','png'] | { target, alternatives }  (sync or async)
//   findConverter(fromExt, toExt) -> Converter | null    (shape in PROJECT_BRIEF.md)
//   listTargets(fromExt)          -> ['jpg','png',...]   (optional: extra chips)
// Why injected: this file stays about the page. The engines stay in js/converters.
import { el } from './dom.js';
import { icon } from './icons.js';
import { createToaster } from './toast.js';
import { createShortcutsDialog } from './shortcuts.js';
import { attachDropTarget, attachPaste, entriesFromInput } from './drop.js';
import { createCard } from './file-card.js';
import { createSound, haptic } from './feedback.js';
import { buildZip } from './zip.js';
import { friendlyError, raceAbort } from './jobs.js';
import {
  dirOf, extOf, formatBytes, jobOptions, normalizeSuggestion, pickPrimary, replaceExt, resolveType,
  revealText, safeZipPath, sniffType, typeLabel, uniquePaths, describeEngine,
} from './format.js';

const MAX_ITEMS = 200;   // a phone should not be asked to hold a thousand cards
const CONCURRENCY = 2;   // two at a time: fast enough, gentle on memory
const SNIFF_BYTES = 2048;
const RETRYABLE = ['ready', 'error', 'cancelled'];

export function mountConvertPage(root, services) {
  const reduceQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(reduceQuery?.matches);

  const items = [];          // every card on the page, in the order added
  const queue = [];          // items waiting for a free slot
  let active = 0;            // conversions running right now
  let batch = { total: 0, finished: 0 };
  let zipping = false;
  let seq = 0;

  // ---------- page skeleton (built with createElement, never innerHTML) ----------

  root.classList.add('cv');

  const fileInput = el('input', { type: 'file', multiple: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  const canPickFolder = 'webkitdirectory' in HTMLInputElement.prototype;
  const folderInput = canPickFolder
    ? el('input', { type: 'file', webkitdirectory: true, hidden: true, tabindex: '-1', 'aria-hidden': 'true' })
    : null;

  const chooseBtn = el('button', { class: 'cv-btn', type: 'button', onclick: () => fileInput.click() }, icon('upload', 20), 'Choose files');
  const folderBtn = canPickFolder
    ? el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', onclick: () => folderInput.click() }, icon('folder', 20), 'Choose a folder')
    : null;

  const empty = el('section', { class: 'cv-empty', 'aria-labelledby': 'cv-empty-title' },
    el('span', { class: 'cv-empty__icon', 'aria-hidden': 'true' }, icon('upload', 32)),
    el('h2', { id: 'cv-empty-title', class: 'cv-empty__title', text: 'Drop files anywhere' }),
    el('p', { class: 'cv-empty__text', text: 'Drag them onto this page, paste an image with Ctrl+V, or pick them yourself.' }),
    el('div', { class: 'cv-empty__actions' }, chooseBtn, folderBtn));

  const summary = el('p', { class: 'cv-summary' });
  const addBtn = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Add files', onclick: () => fileInput.click() });
  const addFolderBtn = canPickFolder
    ? el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Add folder', onclick: () => folderInput.click() })
    : null;
  const cancelAllBtn = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Cancel all', onclick: () => cancelAll() });
  const clearBtn = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Clear', onclick: () => clearAll() });
  const zipBtn = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', onclick: () => downloadZip() });
  const convertBtn = el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', onclick: () => convertAll() });
  const toolbar = el('div', { class: 'cv-toolbar', hidden: true }, summary,
    el('div', { class: 'cv-toolbar__actions' }, addBtn, addFolderBtn, cancelAllBtn, clearBtn, zipBtn, convertBtn));

  const queueList = el('ul', { class: 'cv-list' });
  const queueSection = el('section', { class: 'cv-queue', 'aria-labelledby': 'cv-queue-title', hidden: true },
    el('h2', { id: 'cv-queue-title', class: 'cv-sr', text: 'Files to convert' }), queueList);

  const doneList = el('ul', { class: 'cv-list' });
  const shelfSummary = el('p', { class: 'cv-shelf__summary' });
  const shelf = el('section', { class: 'cv-shelf', 'aria-labelledby': 'cv-shelf-title', hidden: true },
    el('div', { class: 'cv-shelf__head' }, el('h2', { id: 'cv-shelf-title', class: 'cv-shelf__title', text: 'Done' }), shelfSummary),
    doneList);

  const sound = createSound();
  const soundBtn = el('button', { class: 'cv-linkbtn', type: 'button', role: 'switch', onclick: () => { sound.set(!sound.enabled); paintSound(); } });
  const helpBtn = el('button', { class: 'cv-linkbtn', type: 'button', text: 'Keyboard shortcuts (?)', onclick: () => shortcuts.open() });
  const foot = el('div', { class: 'cv-foot' }, soundBtn, helpBtn);

  const overlay = el('div', { class: 'cv-drop', 'aria-hidden': 'true' },
    el('div', { class: 'cv-drop__ring' }),
    el('p', { class: 'cv-drop__label', text: 'Drop to add' }),
    el('p', { class: 'cv-drop__hint', text: 'Files and folders stay on your device.' }));

  const toastHost = el('div', { class: 'cv-toasts' });
  const live = el('div', { class: 'cv-sr', role: 'status', 'aria-live': 'polite' });
  const toaster = createToaster(toastHost);
  const shortcuts = createShortcutsDialog();

  root.replaceChildren(
    el('h1', { class: 'cv-title', tabindex: '-1', text: 'Convert anything. Upload nothing.' }),
    el('p', { class: 'cv-lead', text: 'Drop your files anywhere on this page. They are converted on your device.' }),
    empty, toolbar, queueSection, shelf, foot,
    overlay, toastHost, live, shortcuts.element, fileInput, folderInput);

  const announce = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  function paintSound() {
    soundBtn.setAttribute('aria-checked', String(sound.enabled));
    soundBtn.textContent = sound.enabled ? 'Sound when done: on' : 'Sound when done: off';
  }
  paintSound();

  // ---------- adding files ----------

  const handlers = {
    onConvert: (item) => enqueue([item]),
    onCancel: (item) => cancelItem(item),
    onRemove: (item) => removeItem(item),
    onTarget(item, ext) {
      item.target = ext;
      refreshEngine(item);
      item.card.render({ focus: 'suggest' });
    },
    onOptions: (item, patch) => Object.assign(item.options, patch),
    onDownload: (item) => saveBlob(item.job.resultBlob, item.outName),
    reducedMotion: reduced,
  };

  function makeItem({ file, path }) {
    const item = {
      id: `f${++seq}`, file, name: file.name, path, folder: dirOf(path),
      state: 'loading', fromExt: '', typeLabel: '', mismatch: '',
      targets: [], target: '', suggested: '', engine: null,
      options: { quality: 0.85, maxWidth: null, maxKB: null, stripMetadata: true },
      optionsOpen: false, job: null, controller: null, converter: null,
      progress: 0, phase: '', error: '', outName: '', revealed: false,
    };
    item.card = createCard(item, handlers);
    item.card.render();
    return item;
  }

  function refreshEngine(item) {
    const converter = services.findConverter(item.fromExt, item.target);
    let downloadKB = 0;
    try { downloadKB = converter?.estimate?.(item.file)?.downloadKB ?? 0; } catch { /* no estimate: show what we know */ }
    item.engine = converter ? describeEngine(converter.engine, downloadKB) : null;
  }

  // Look at the first bytes, decide the real type, ask for the suggestion.
  async function inspect(item) {
    const head = new Uint8Array(await item.file.slice(0, SNIFF_BYTES).arrayBuffer());
    const named = extOf(item.name);
    const resolved = resolveType(sniffType(head), named);
    item.fromExt = resolved.ext;
    item.typeLabel = typeLabel(item.fromExt);
    item.mismatch = resolved.mismatch ? `Named .${named}, but it looks like ${resolved.ext.toUpperCase()}.` : '';
    if (!item.fromExt) return false;

    const suggestion = normalizeSuggestion(await services.suggestTarget(item.fromExt, item.file));
    if (!suggestion) return false;
    const more = normalizeSuggestion(await services.listTargets?.(item.fromExt));
    const extra = more ? [more.primary, ...more.others] : [];
    const wanted = [...new Set([suggestion.primary, ...suggestion.others, ...extra])];
    const targets = wanted.filter((t) => services.findConverter(item.fromExt, t)); // only formats we can really make
    if (!targets.length) return false;

    item.targets = targets;
    item.suggested = targets.includes(suggestion.primary) ? suggestion.primary : targets[0];
    item.target = item.suggested;
    refreshEngine(item);
    item.state = 'ready';
    item.card.render();
    return true;
  }

  async function addResult({ entries, truncated = false, unreadable = 0 }) {
    if (!entries.length) {
      if (unreadable) toaster.show('Some files could not be read, so they were skipped.', { kind: 'warning' });
      return;
    }
    const room = Math.max(0, MAX_ITEMS - items.length);
    const accepted = entries.slice(0, room);
    if (truncated || accepted.length < entries.length) {
      toaster.show(`The list holds up to ${MAX_ITEMS} files. Some were not added.`, { kind: 'warning' });
    }
    if (!accepted.length) return;

    const fresh = accepted.map(makeItem);   // skeleton cards appear straight away
    for (const item of fresh) { items.push(item); queueList.append(item.card.el); }
    refresh();

    const skipped = [];
    await Promise.all(fresh.map(async (item) => {
      try {
        if (!(await inspect(item))) skipped.push(item);
      } catch (err) {
        console.error('Could not inspect a file', err); // never crash on a strange file
        skipped.push(item);
      }
    }));

    for (const item of skipped) discard(item);
    if (skipped.length) toaster.show(skippedMessage(skipped), { kind: 'warning' });
    if (unreadable) toaster.show('Some files could not be read, so they were skipped.', { kind: 'warning' });
    refresh();
  }

  function skippedMessage(skipped) {
    if (skipped.length === 1) {
      const [only] = skipped;
      return only.fromExt
        ? `Skipped ${only.name}. We cannot convert .${only.fromExt} files yet.`
        : `Skipped ${only.name}. We could not tell what type of file it is.`;
    }
    const kinds = [...new Set(skipped.map((s) => (s.fromExt ? `.${s.fromExt}` : 'no extension')))].slice(0, 4);
    return `Skipped ${skipped.length} files we cannot convert yet (${kinds.join(', ')}).`;
  }

  fileInput.addEventListener('change', () => { addResult(entriesFromInput(fileInput)); fileInput.value = ''; });
  folderInput?.addEventListener('change', () => { addResult(entriesFromInput(folderInput)); folderInput.value = ''; });

  const dropError = (err) => { console.error(err); toaster.show('That drop did not work. Try "Choose files" instead.', { kind: 'error' }); };
  const detachers = [
    attachDropTarget(overlay, addResult, dropError),
    attachPaste(addResult),
  ];

  // ---------- converting ----------

  function place(item) {
    if (!items.includes(item)) return; // cleared or removed: leave its DOM alone
    const target = item.state === 'done' ? doneList : queueList;
    if (item.card.el.parentElement !== target) {
      if (target === doneList) doneList.prepend(item.card.el); else queueList.append(item.card.el);
    }
  }

  function setState(item, state) {
    item.state = state;
    if (item.job) item.job.status = state;
    item.card.render();
    place(item);
  }

  function fail(item, message) {
    item.error = message;
    if (item.job) item.job.error = message;
    setState(item, 'error');
  }

  function enqueue(list) {
    const todo = list.filter((item) => RETRYABLE.includes(item.state));
    if (!todo.length) return;
    if (active === 0 && queue.length === 0) batch = { total: 0, finished: 0 };
    for (const item of todo) {
      const converter = services.findConverter(item.fromExt, item.target);
      if (!converter) { fail(item, `There is no converter for ${item.fromExt.toUpperCase()} to ${item.target.toUpperCase()} yet.`); continue; }
      item.converter = converter;
      item.controller = new AbortController();
      item.progress = 0;
      item.phase = '';
      item.error = '';
      item.notes = [];
      item.revealed = false;
      item.job = {
        id: `j${++seq}`, file: item.file, fromExt: item.fromExt, toExt: item.target,
        options: jobOptions(item.options), engine: converter.engine, status: 'queued',
        progress: 0, bytesIn: item.file.size, bytesOut: 0, resultBlob: null, error: null,
      };
      queue.push(item);
      batch.total++;
      setState(item, 'queued');
    }
    pump();
    refresh();
  }

  function convertAll() {
    enqueue(items.filter((item) => RETRYABLE.includes(item.state)));
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const item = queue.shift();
      if (item.state !== 'queued') continue;
      active++;
      execute(item)
        .catch((err) => console.error(err))
        .finally(() => { active--; batch.finished++; pump(); refresh(); });
    }
  }

  // One file. Every failure is caught here, so one bad file never stops the others.
  async function execute(item) {
    const { job, controller, converter } = item;
    setState(item, 'running');
    try {
      if (typeof converter.load === 'function') {
        if (converter.engine !== 'native') { item.phase = 'loading'; item.card.repaintProgress(); }
        await raceAbort(Promise.resolve(converter.load()), controller.signal);
      }
      item.phase = 'converting';
      item.card.repaintProgress();
      // Real progress only: whatever the converter reports, nothing invented.
      const onProgress = (p) => {
        if (controller.signal.aborted) return;
        const value = Math.max(0, Math.min(1, Number(p) || 0));
        job.progress = item.progress = value;
        item.card.repaintProgress();
      };
      const blob = await raceAbort(Promise.resolve(converter.run(job, onProgress, controller.signal)), controller.signal);
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('The converter returned an empty file.');
      job.resultBlob = blob;
      job.bytesOut = blob.size;
      job.progress = item.progress = 1;
      // Plain facts the converter wants the visitor to know (for example "3 images were left out").
      item.notes = Array.isArray(job.warnings) ? job.warnings.filter((w) => typeof w === 'string' && w) : [];
      item.outName = replaceExt(item.name, item.target);
      setState(item, 'done');
      finishedFeeling(item);
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        setState(item, 'cancelled');
      } else {
        console.error('Conversion failed', err);
        fail(item, friendlyError(err));
      }
    }
  }

  // The Reveal, plus a 30 ms buzz on phones that support it, plus the optional chime.
  function finishedFeeling(item) {
    item.card.playReveal();
    haptic(30);
    sound.play();
    announce(`${item.outName} is ready. ${revealText(item.job.bytesIn, item.job.bytesOut)}.`);
  }

  function cancelItem(item) {
    if (item.state === 'queued') {
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
      item.controller?.abort();
      batch.finished++;
      setState(item, 'cancelled');
      refresh();
    } else if (item.state === 'running') {
      item.controller?.abort(); // execute() turns this into "cancelled"
    }
  }

  function cancelAll() {
    for (const item of [...items]) cancelItem(item);
  }

  // ---------- removing and clearing ----------

  function discard(item) {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    item.card.destroy();
  }

  function removeItem(item) {
    cancelItem(item);
    discard(item);
    refresh();
  }

  function clearAll() {
    if (!items.length) return;
    cancelAll();
    const removed = items.splice(0);
    queue.length = 0;
    for (const item of removed) item.card.el.remove(); // hidden, not destroyed: Undo can bring them back
    refresh();
    const n = removed.length;
    toaster.show(`Cleared ${n} ${n === 1 ? 'file' : 'files'}.`, {
      timeout: 8000,
      action: {
        label: 'Undo',
        onClick: () => { for (const item of removed) { items.push(item); queueList.append(item.card.el); place(item); } refresh(); },
      },
      onDismiss: (reason) => { if (reason !== 'action') removed.forEach((item) => item.card.destroy()); },
    });
  }

  // ---------- downloads ----------

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  async function downloadZip() {
    const done = items.filter((item) => item.state === 'done');
    if (!done.length || zipping) return;
    zipping = true;
    refresh();
    try {
      // keep folders, fix odd characters, and never let two files share a name
      const paths = uniquePaths(done.map((item) => safeZipPath(replaceExt(item.path, item.target))));
      const entries = done.map((item, i) => ({ path: paths[i], blob: item.job.resultBlob }));
      const blob = await buildZip(entries, { onProgress: (p) => { zipBtn.textContent = `Making ZIP\u2026 ${Math.round(p * 100)}%`; } });
      saveBlob(blob, `lokalconver-${stamp()}.zip`);
      toaster.show(`ZIP ready: ${done.length} ${done.length === 1 ? 'file' : 'files'}, ${formatBytes(blob.size)}.`, { kind: 'success' });
    } catch (err) {
      console.error('ZIP failed', err);
      toaster.show('Could not make the ZIP file. Please try again.', { kind: 'error' });
    } finally {
      zipping = false;
      refresh();
    }
  }

  // ---------- toolbar and counts ----------

  function refresh() {
    const count = items.length;
    const busy = items.filter((i) => i.state === 'queued' || i.state === 'running').length;
    const done = items.filter((i) => i.state === 'done');
    const pending = items.filter((i) => RETRYABLE.includes(i.state)).length;

    empty.hidden = count > 0;
    toolbar.hidden = count === 0;
    queueSection.hidden = queueList.children.length === 0;
    shelf.hidden = done.length === 0;

    summary.textContent = busy
      ? `Converting\u2026 ${batch.finished} of ${batch.total} finished`
      : `${count} ${count === 1 ? 'file' : 'files'}${done.length ? `, ${done.length} done` : ''}`;

    cancelAllBtn.hidden = busy === 0;
    clearBtn.hidden = count === 0;
    zipBtn.hidden = done.length === 0;
    zipBtn.disabled = zipping;
    if (!zipping) zipBtn.textContent = 'Download all as ZIP';
    convertBtn.hidden = pending === 0 && busy === 0;
    convertBtn.disabled = busy > 0;
    convertBtn.textContent = busy ? `Converting\u2026 ${batch.finished}/${batch.total}` : `Convert all (${pending})`;

    // Exactly one gradient button on the screen, whatever the state.
    const primary = pickPrimary({ count, pending, busy, done: done.length });
    chooseBtn.classList.toggle('cv-btn--primary', primary === 'choose');
    convertBtn.classList.toggle('cv-btn--primary', primary === 'convert-all');
    zipBtn.classList.toggle('cv-btn--primary', primary === 'zip');

    const sumIn = done.reduce((n, i) => n + i.job.bytesIn, 0);
    const sumOut = done.reduce((n, i) => n + i.job.bytesOut, 0);
    shelfSummary.textContent = done.length
      ? `${done.length} ${done.length === 1 ? 'file' : 'files'}: ${revealText(sumIn, sumOut)}`
      : '';
  }

  // ---------- keyboard ----------

  const isEditable = (t) => Boolean(t?.closest?.('input, textarea, select, [contenteditable="true"]'));
  const isInteractive = (t) => Boolean(t?.closest?.('button, a[href], input, select, textarea, summary, [role="slider"], [role="switch"], dialog'));

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || shortcuts.isOpen) return; // the open dialog handles its own keys
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === '?' && plain && !isEditable(e.target)) {
      e.preventDefault();
      shortcuts.open();
    } else if (e.key === 'Escape') {
      if (isEditable(e.target)) { e.target.blur(); return; }
      if (items.length) { e.preventDefault(); clearAll(); }
    } else if (e.key === 'Enter' && plain && !e.shiftKey && !isInteractive(e.target)) {
      if (items.some((i) => RETRYABLE.includes(i.state))) { e.preventDefault(); convertAll(); }
    }
  }
  document.addEventListener('keydown', onKeydown);

  refresh();

  return {
    addFiles: (files) => addResult({ entries: Array.from(files, (file) => ({ file, path: file.name })) }),
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      detachers.forEach((off) => off());
      cancelAll();
      items.splice(0).forEach((item) => item.card.destroy());
      root.classList.remove('cv');
      root.replaceChildren();
    },
  };
}
