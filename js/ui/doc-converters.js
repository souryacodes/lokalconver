// Panel for the document and data converters: docx, md, txt, csv, json, xlsx.
// One card per file, friendly errors per file. Nothing from a file is put in the page with innerHTML.
// Converted HTML is only offered as a download. It is never shown here.
import { createDropzone } from './dropzone.js';
import { converters, targetsFor, normalizeExt, acceptedExtensions } from '../converters/index.js';
import { BRIDGE_BADGE, BRIDGE_HELP } from '../converters/bridge-only.js';
import { fileExt, formatBytes } from '../core/limits.js';
import { outputName } from '../core/filename.js';
import { friendlyMessage } from '../core/errors.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
let nextId = 0;
const NAMES = { html: 'HTML', txt: 'Text', md: 'Markdown', pdf: 'PDF', csv: 'CSV', json: 'JSON' };
const LIST = ['.docx', '.md', '.txt', '.csv', '.json', '.xlsx'].join(', ');

export function mountDocConverters(root) {
  root.classList.add('lc-scope');
  const section = el('section', 'lc-section');
  const h2 = el('h2', '', 'Documents and data');
  h2.id = 'lc-doc-title';
  section.setAttribute('aria-labelledby', 'lc-doc-title');
  section.append(h2, el('p', 'lc-muted', `Convert ${LIST} files. Everything happens on this device. Nothing is uploaded.`));
  const list = el('ul', 'lc-list');
  const accept = acceptedExtensions.map((e) => `.${e}`).join(',');
  section.append(createDropzone({ title: 'Drop files here, or choose them', hint: LIST, accept, onFiles: (files) => files.forEach(addCard) }), list);
  root.append(section);

  const cards = new Set();
  const markPrimary = (link) => {
    for (const c of cards) c.querySelectorAll('.lc-btn--primary').forEach((n) => n.classList.remove('lc-btn--primary'));
    link.classList.add('lc-btn--primary'); // only one gradient button at a time
  };

  function addCard(file) {
    const li = el('li', 'lc-card');
    cards.add(li);
    const fromExt = normalizeExt(fileExt(file.name));
    const head = el('div', 'lc-file-head');
    head.append(el('span', 'lc-name', file.name), el('span', 'lc-size', formatBytes(file.size)));
    li.append(head);

    const targets = targetsFor(fromExt);
    if (!targets.length) {
      const msg = el('p', 'lc-error', `This tool cannot convert ${fromExt ? `.${fromExt}` : 'files without an extension'} here. It handles ${LIST}.`);
      msg.setAttribute('role', 'alert');
      li.append(msg, removeButton(li));
      list.prepend(li);
      return;
    }

    // options that depend on the kind of conversion
    const toData = targets.some((t) => t.toExt === 'json' && t.available);
    const toCsv = targets.some((t) => t.toExt === 'csv' && t.available);
    const typed = toData ? checkbox('Turn plain numbers and true/false into real JSON numbers. Leave this off to keep everything as text, so a roll number like 0042 stays 0042.', false) : null;
    const bom = toCsv ? checkbox('Add a marker so Excel shows non-English letters correctly (UTF-8 BOM).', true) : null;

    const label = el('p', 'lc-label', 'Convert to');
    const row = el('div', 'lc-targets');
    const out = el('div'); // status, result, preview go here
    const buttons = [];
    let currentUrl = null;
    let controller = null;
    let sheetIndex = 0;

    for (const t of targets) {
      if (!t.available) continue;
      const b = el('button', 'lc-btn', NAMES[t.toExt] ?? t.toExt.toUpperCase());
      b.type = 'button';
      b.addEventListener('click', () => run(t));
      buttons.push(b);
      row.append(b);
    }
    li.append(label, row);
    if (typed) li.append(typed.wrap);
    if (bom) li.append(bom.wrap);
    for (const t of targets.filter((x) => !x.available)) {
      const note = el('p', 'lc-bridge');
      const helpId = `lc-help-${++nextId}`;
      note.append(document.createTextNode(`${t.label ?? `${fromExt.toUpperCase()} to ${t.toExt.toUpperCase()}`} `), el('span', 'lc-badge', BRIDGE_BADGE));
      const help = el('span', 'lc-note', BRIDGE_HELP);
      help.id = helpId; help.style.display = 'block';
      note.append(help);
      li.append(note);
    }
    li.append(out, removeButton(li, () => { controller?.abort(); if (currentUrl) URL.revokeObjectURL(currentUrl); }));
    list.prepend(li);

    async function run(target) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
      out.replaceChildren();
      buttons.forEach((b) => { b.disabled = true; });

      const status = el('p', 'lc-status', `Converting to ${NAMES[target.toExt] ?? target.toExt}…`);
      status.setAttribute('role', 'status');
      const bar = el('progress', 'lc-progress'); // no value on purpose: we do not know the percentage, so we do not pretend
      bar.setAttribute('aria-label', 'Converting');
      const cancel = el('button', 'lc-btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => controller.abort());
      out.append(status, bar, cancel);

      const job = {
        id: `job-${++nextId}`, file, fromExt, toExt: target.toExt, engine: target.converter.engine,
        options: { typed: !!typed?.input.checked, bom: bom ? bom.input.checked : true, sheetIndex },
        status: 'running', progress: 0, bytesIn: file.size, bytesOut: 0, resultBlob: null, error: null,
      };
      try {
        const blob = await target.converter.run(job, (p) => { job.progress = p; }, signal);
        job.status = 'done'; job.resultBlob = blob; job.bytesOut = blob.size;
        out.replaceChildren();
        showResult(job);
      } catch (err) {
        out.replaceChildren();
        if (err?.name === 'AbortError') {
          job.status = 'cancelled';
          out.append(el('p', 'lc-status', 'Cancelled.'));
        } else {
          job.status = 'error'; job.error = friendlyMessage(err);
          const e = el('p', 'lc-error', job.error);
          e.setAttribute('role', 'alert');
          out.append(e);
        }
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
      }
    }

    function showResult(job) {
      const name = outputName(file.name, job.toExt);
      currentUrl = URL.createObjectURL(job.resultBlob);
      const done = el('p', 'lc-status');
      done.setAttribute('role', 'status');
      done.append(el('span', 'lc-done', 'Done. '), document.createTextNode(`${formatBytes(job.bytesIn)} became ${formatBytes(job.bytesOut)}${job.pages ? ` (${job.pages} page${job.pages === 1 ? '' : 's'})` : ''}.`));
      out.append(done);
      if (job.warnings?.length) {
        const ul = el('ul', 'lc-warns');
        for (const w of job.warnings) ul.append(el('li', '', w));
        out.append(ul);
      }
      if (job.toExt === 'html') out.append(el('p', 'lc-note', 'The HTML page is for download only. It is not shown here. The downloaded page cannot run scripts.'));
      if (job.preview) {
        out.append(el('p', 'lc-label', 'Preview of the first 10 rows (text)'));
        const pre = el('pre', 'lc-preview', job.preview);
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', 'Preview of the first 10 rows');
        out.append(pre);
      }
      const actions = el('div', 'lc-actions');
      const link = el('a', 'lc-btn', `Download ${name}`);
      link.href = currentUrl;
      link.download = name;
      actions.append(link);
      if (job.sheetNames && job.sheetNames.length > 1) {
        const sel = el('select', 'lc-select');
        sel.setAttribute('aria-label', 'Choose a sheet');
        job.sheetNames.forEach((n, i) => { const o = el('option', '', n); o.value = String(i); sel.append(o); });
        sel.value = String(sheetIndex);
        const again = el('button', 'lc-btn', 'Convert this sheet');
        again.type = 'button';
        again.addEventListener('click', () => { sheetIndex = Number(sel.value); run(targets.find((t) => t.toExt === job.toExt)); });
        actions.append(sel, again);
      }
      out.append(actions);
      markPrimary(link);
    }
  }

  function checkbox(text, checked) {
    const wrap = el('label', 'lc-opt');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    wrap.append(input, el('span', '', text));
    return { wrap, input };
  }

  function removeButton(li, onRemove) {
    const b = el('button', 'lc-btn', 'Remove');
    b.type = 'button';
    b.style.marginTop = '12px';
    b.addEventListener('click', () => { onRemove?.(); cards.delete(li); li.remove(); });
    return b;
  }

  return { converters };
}
