// The PDF tools page (#/pdf).
//
//   import { mountPdfTools } from './ui/pdf-tools.js';
//   mountPdfTools(document.getElementById('pdf-root'));
//
// The Convert page turns one file into one other format. These tools need more: several files in a chosen
// order (merge, images to PDF), a page list (split), a direction (rotate), a size goal (compress). They use the
// same converter objects as the Convert page (js/converters/pdf.js), and the same option lists draw the forms.
//
// Nothing is uploaded. File names are untrusted text and only ever go in with textContent.
import { el } from './dom.js';
import { icon } from './icons.js';
import { createReorderList } from './reorder-list.js';
import { mountOptionFields } from './option-form.js';
import { filesFromDataTransfer, entriesFromInput } from './drop.js';
import { extOf, formatBytes, resolveType, sniffType, describeEngine, revealText } from './format.js';
import { raceAbort, friendlyError } from './jobs.js';
import { pdfConverters } from '../converters/pdf.js';
import { safeBaseName } from '../converters/pdf-utils.js';

const IMAGE_EXTS = ['jpg', 'png', 'webp', 'gif', 'bmp', 'avif'];
const SNIFF_BYTES = 2048;
const MAX_FILES = 100;

// One entry per tool. `many` tools take an ordered list; the others take one file.
const TOOLS = [
  { id: 'pdf-merge', label: 'Merge PDFs', accepts: 'pdf', many: true, min: 2, run: 'Merge', pick: 'Choose PDFs', stem: () => 'merged' },
  { id: 'images-to-pdf', label: 'Images to PDF', accepts: 'image', many: true, min: 1, run: 'Make the PDF', pick: 'Choose images', stem: (files) => (files.length === 1 ? safeBaseName(files[0].name, 'images') : 'images') },
  { id: 'pdf-split', label: 'Split a PDF', accepts: 'pdf', run: 'Split', pick: 'Choose a PDF', stem: (files) => `${safeBaseName(files[0].name)}-pages` },
  { id: 'pdf-rotate', label: 'Rotate pages', accepts: 'pdf', run: 'Rotate', pick: 'Choose a PDF', stem: (files) => `${safeBaseName(files[0].name)}-rotated` },
  { id: 'pdf-compress', label: 'Compress a PDF', accepts: 'pdf', run: 'Compress', pick: 'Choose a PDF', stem: (files) => `${safeBaseName(files[0].name)}-compressed` },
  { id: 'pdf-to-images', label: 'PDF to images', accepts: 'pdf', run: 'Make images', pick: 'Choose a PDF', stem: (files) => safeBaseName(files[0].name) },
  { id: 'pdf-to-text', label: 'PDF to text', accepts: 'pdf', run: 'Get the text', pick: 'Choose a PDF', stem: (files) => safeBaseName(files[0].name) },
];

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function mountPdfTools(root) {
  root.classList.add('cv', 'pt');
  const converterFor = (tool) => pdfConverters.find((c) => c.id === tool.id);
  const states = new Map(TOOLS.map((t) => [t.id, {
    files: [], extra: {}, toExt: converterFor(t).to[0],
    status: 'idle', progress: 0, message: '', error: '', result: null, controller: null, notice: '',
  }]));
  let current = TOOLS[0];
  let seq = 0;

  const live = el('p', { class: 'cv-sr', role: 'status', 'aria-live': 'polite' });
  const announce = (text) => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  const picker = el('div', { class: 'pt-tools', role: 'group', 'aria-label': 'PDF tools' });
  const panel = el('section', { class: 'pt-panel', 'aria-labelledby': 'pt-panel-title' });
  root.append(
    el('p', { class: 'cv-lead', text: 'Merge, split, rotate and shrink PDFs, or turn pages into pictures or text. Your files are worked on in this browser tab and never leave this device.' }),
    picker, panel, live,
  );

  // ---------------------------------------------------------------- tool picker

  function paintPicker() {
    picker.replaceChildren(...TOOLS.map((tool) => el('button', {
      class: 'cv-chip pt-tool', type: 'button', text: tool.label,
      'aria-pressed': String(tool === current),
      onclick: () => { current = tool; paintPicker(); renderPanel(); },
    })));
  }

  // ---------------------------------------------------------------- adding files

  async function kindOf(file) {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    return resolveType(sniffType(head), extOf(file.name)).ext;
  }

  async function addFiles(tool, entries) {
    const st = states.get(tool.id);
    if (st.status === 'running') return;
    const good = [];
    const rejected = [];
    for (const { file } of entries) {
      const kind = await kindOf(file);
      const ok = tool.accepts === 'pdf' ? kind === 'pdf' : IMAGE_EXTS.includes(kind);
      if (ok) good.push(file); else rejected.push({ file, kind });
    }
    const notes = [];
    if (rejected.length) {
      const names = rejected.slice(0, 2).map((r) => r.file.name).join(', ');
      const more = rejected.length > 2 ? ` and ${rejected.length - 2} more` : '';
      const wanted = tool.accepts === 'pdf' ? 'PDFs' : 'JPG, PNG, WEBP, GIF, BMP or AVIF pictures';
      const hint = rejected.some((r) => ['heic', 'heif', 'svg'].includes(r.kind)) ? ' Turn HEIC or SVG pictures into JPG on the Convert page first.' : '';
      notes.push(`Skipped ${names}${more}. This tool takes ${wanted}.${hint}`);
    }
    if (tool.many) {
      const room = Math.max(0, MAX_FILES - st.files.length);
      if (good.length > room) notes.push(`The list holds up to ${MAX_FILES} files. Some were not added.`);
      for (const file of good.slice(0, room)) st.files.push({ id: `f${++seq}`, file });
    } else if (good.length) {
      st.files = [{ id: `f${++seq}`, file: good[0] }];
      if (good.length > 1) notes.push(`This tool works on one PDF at a time. Using ${good[0].name}.`);
    }
    st.notice = notes.join(' ');
    if (good.length) { st.status = 'idle'; st.result = null; st.error = ''; }
    if (tool === current) renderPanel();
  }

  // ---------------------------------------------------------------- running

  const nameFor = (tool, files, ext) => `${tool.stem(files)}.${ext}`;

  async function run(tool) {
    const st = states.get(tool.id);
    const converter = converterFor(tool);
    const files = st.files.map((f) => f.file);
    if (st.status === 'running' || files.length < (tool.min ?? 1)) return;
    st.status = 'running'; st.progress = 0; st.message = 'Getting the engine ready'; st.error = ''; st.result = null;
    st.controller = new AbortController();
    const { signal } = st.controller;
    renderPanel();
    const job = {
      id: `pdf-job-${++seq}`, file: files[0], fromExt: tool.accepts === 'pdf' ? 'pdf' : 'jpg',
      toExt: tool.id === 'pdf-to-images' ? st.toExt : converter.to[0],
      options: { files, extra: { ...st.extra } }, warnings: [],
    };
    const onProgress = (fraction, message) => {
      if (signal.aborted) return;
      st.progress = Math.max(0, Math.min(1, Number(fraction) || 0));
      if (message) st.message = message;
      if (current === tool) paintProgress(tool);
    };
    try {
      await raceAbort(Promise.resolve(converter.load()), signal);
      st.message = 'Working';
      const blob = await raceAbort(Promise.resolve(converter.run(job, onProgress, signal)), signal);
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('The tool returned an empty file.');
      st.result = {
        blob, name: nameFor(tool, files, job.outExt || job.toExt),
        bytesIn: files.reduce((sum, f) => sum + f.size, 0), notes: (job.warnings ?? []).filter((w) => typeof w === 'string' && w),
      };
      st.status = 'done'; st.progress = 1;
      announce(`${st.result.name} is ready. ${revealText(st.result.bytesIn, blob.size)}.`);
    } catch (err) {
      if (signal.aborted || err?.name === 'AbortError') { st.status = 'cancelled'; announce('Cancelled.'); }
      else { console.error('PDF tool failed', err); st.status = 'error'; st.error = friendlyError(err); }
    } finally {
      st.controller = null;
    }
    if (current === tool) renderPanel();
  }

  // ---------------------------------------------------------------- the panel

  let progressRefs = null;
  function paintProgress(tool) {
    if (!progressRefs || current !== tool) return;
    const st = states.get(tool.id);
    const { bar, track, status } = progressRefs;
    const known = st.progress > 0;
    track.classList.toggle('is-indeterminate', !known);
    bar.style.transform = `scaleX(${known ? st.progress : 0})`;
    if (known) track.setAttribute('aria-valuenow', String(Math.round(st.progress * 100)));
    else track.removeAttribute('aria-valuenow');
    status.textContent = known ? `${st.message} (${Math.round(st.progress * 100)}%)` : st.message;
  }

  function fileList(tool, st) {
    const busy = st.status === 'running';
    if (!st.files.length) return null;
    if (tool.many) {
      const list = createReorderList({
        items: st.files.map((f) => ({ id: f.id, name: f.file.name, detail: formatBytes(f.file.size) })),
        label: tool.accepts === 'pdf' ? 'PDFs, in the order they will be joined' : 'Pictures, in page order',
        onChange: (items) => {
          const byId = new Map(st.files.map((f) => [f.id, f]));
          const before = st.files.length;
          const hadResult = st.status === 'done' || st.status === 'error';
          st.files = items.map((i) => byId.get(i.id)).filter(Boolean);
          st.result = null; st.error = '';
          if (hadResult) st.status = 'idle';
          // Only draw the panel again when something besides the order changed. Drawing it again would
          // take the keyboard focus away from the row the visitor just moved.
          if (hadResult || st.files.length !== before) renderPanel();
        },
      });
      if (busy) list.element.setAttribute('inert', '');
      return list.element;
    }
    const [only] = st.files;
    return el('div', { class: 'pt-file' },
      icon('pdf', 24),
      el('div', { class: 'pt-file__text' }, el('span', { class: 'pt-file__name', text: only.file.name }), el('span', { class: 'cv-note', text: formatBytes(only.file.size) })),
      el('button', {
        class: 'cv-icon-btn', type: 'button', disabled: busy, 'aria-label': `Remove ${only.file.name}`,
        onclick: () => { st.files = []; st.result = null; st.status = 'idle'; renderPanel(); },
      }, icon('x', 20)));
  }

  function renderPanel() {
    const tool = current;
    const st = states.get(tool.id);
    const converter = converterFor(tool);
    const busy = st.status === 'running';
    progressRefs = null;

    // choose / drop
    const input = el('input', { type: 'file', hidden: true, tabindex: '-1', 'aria-hidden': 'true', multiple: tool.many ? true : null, accept: tool.accepts === 'pdf' ? '.pdf,application/pdf' : IMAGE_EXTS.map((e) => `.${e}`).join(',') });
    input.addEventListener('change', () => { addFiles(tool, entriesFromInput(input).entries); input.value = ''; });
    const choose = el('button', { class: 'cv-btn', type: 'button', disabled: busy, onclick: () => input.click() },
      icon('upload', 20), st.files.length && tool.many ? 'Add more' : tool.pick);
    const dropArea = el('div', { class: 'pt-drop' }, choose, el('span', { class: 'cv-note', text: tool.many ? 'or drop them here' : 'or drop it here' }), input);

    let downloadKB = 0;
    try { downloadKB = converter.estimate()?.downloadKB ?? 0; } catch { /* unknown: say what we know */ }
    const engine = describeEngine(converter.engine, downloadKB);

    const parts = [
      el('h2', { id: 'pt-panel-title', class: 'pt-title', text: tool.label }),
      converter.note ? el('p', { class: 'cv-note', text: converter.note }) : null,
      engine ? el('p', { class: 'cv-engine' }, el('span', { class: 'cv-tier', text: `Tier ${engine.tier}` }), el('span', { text: engine.text })) : null,
      dropArea,
      st.notice ? el('p', { class: 'cv-msg cv-msg--muted', role: 'status', text: st.notice }) : null,
      fileList(tool, st),
    ];
    if (tool.many && st.files.length && st.files.length < (tool.min ?? 1)) parts.push(el('p', { class: 'cv-note', text: 'Add at least one more PDF to merge.' }));

    // settings
    const hasFormat = converter.to.length > 1;
    if ((converter.options.length || hasFormat) && st.files.length) {
      const grid = el('div', { class: 'cv-options__grid' });
      if (busy) grid.setAttribute('inert', '');
      let fields = null;
      if (hasFormat) {
        const id = 'pt-format';
        const select = el('select', { id });
        for (const ext of converter.to) {
          const option = el('option', { value: ext, text: ext === 'jpg' ? 'JPG (smaller files)' : `${ext.toUpperCase()} (sharp, larger files)` });
          if (ext === st.toExt) option.selected = true;
          select.append(option);
        }
        select.addEventListener('change', () => { st.toExt = select.value; fields?.refresh(); });
        grid.append(el('div', { class: 'cv-field' }, el('label', { for: id, text: 'Picture format' }), select));
      }
      const host = el('div', { class: 'cv-options__extra' });
      grid.append(host);
      fields = mountOptionFields({
        host, spec: converter.options, values: st.extra, idPrefix: `pt-${tool.id}`,
        context: { get toExt() { return st.toExt; } },
      });
      parts.push(el('div', { class: 'pt-settings' }, el('h3', { class: 'pt-sub', text: 'Settings' }), grid));
    }

    // run / progress / result / error
    if (busy) {
      const bar = el('div', { class: 'cv-progress__bar' });
      const track = el('div', { class: 'cv-progress', role: 'progressbar', 'aria-label': `${tool.label} progress`, 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
      const status = el('p', { class: 'cv-status' });
      progressRefs = { track, bar, status };
      parts.push(el('div', { class: 'cv-run' }, track, el('div', { class: 'cv-run__row' }, status,
        el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Cancel', onclick: () => st.controller?.abort() }))));
    } else {
      const ready = st.files.length >= (tool.min ?? 1);
      parts.push(el('div', { class: 'cv-actions' },
        el('button', { class: 'cv-btn cv-btn--primary', type: 'button', disabled: !ready, text: tool.run, onclick: () => run(tool) })));
    }
    if (st.status === 'error') parts.push(el('p', { class: 'cv-msg cv-msg--error', role: 'alert' }, icon('alert', 18), el('span', { text: st.error })));
    if (st.status === 'cancelled') parts.push(el('p', { class: 'cv-msg cv-msg--muted', text: 'Cancelled.' }));
    if (st.status === 'done' && st.result) {
      const r = st.result;
      parts.push(el('div', { class: 'cv-done pt-result' },
        el('p', { class: 'cv-reveal', text: revealText(r.bytesIn, r.blob.size) }),
        el('p', { class: 'cv-saved-as' }, 'Saved as ', el('strong', { text: r.name })),
        ...r.notes.map((text) => el('p', { class: 'cv-note', text })),
        el('div', { class: 'cv-actions' }, el('button', {
          class: 'cv-btn cv-btn--solid', type: 'button', 'aria-label': `Download ${r.name}`, onclick: () => saveBlob(r.blob, r.name),
        }, icon('download', 18), 'Download'))));
    }

    panel.replaceChildren(...parts.filter(Boolean));
    if (busy) paintProgress(tool);
  }

  // The whole panel is a drop target. Read the drop before any await (the browser empties it after).
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  panel.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; panel.classList.add('is-over'); });
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('is-over'); });
  panel.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    panel.classList.remove('is-over');
    const tool = current;
    filesFromDataTransfer(e.dataTransfer).then((r) => addFiles(tool, r.entries), (err) => console.error(err));
  });

  paintPicker();
  renderPanel();
  return { destroy() { for (const st of states.values()) st.controller?.abort(); root.replaceChildren(); } };
}
