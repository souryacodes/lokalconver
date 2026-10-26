// docx -> html, txt, md.   mammoth does the reading (in the worker); turndown turns HTML into Markdown.
import { ConvertError } from '../core/errors.js';
import { checkSize } from '../core/limits.js';
import { safeBaseName } from '../core/filename.js';
import { isZip, isOleOffice } from '../core/sniff.js';
import { wrapHtmlDocument } from '../core/html-doc.js';
import { loadClassicScript } from '../core/lazy.js';
import { callWorker } from '../core/lib-worker-client.js';
import { LIBS, libUrl } from './libs.js';
import { addDocxRules } from './md-rules.js';

async function readDocx(file) {
  checkSize(file, 'docx');
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  if (isOleOffice(head)) {
    throw new ConvertError('BAD_FILE', 'This looks like an old .doc file or a password-protected file. Open it in Word, remove the password or choose Save As > .docx, then try again.');
  }
  if (!isZip(head)) throw new ConvertError('BAD_FILE', 'This is not a real .docx file. Its content does not match its name.');
  return buffer;
}

export function htmlToMarkdown(TurndownService, html, notes = {}) {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  addDocxRules(td, notes);
  return `${td.turndown(html).trim()}\n`;
}

export const docxConverter = {
  id: 'docx-doc',
  from: ['docx'],
  to: ['html', 'txt', 'md'],
  engine: 'js',
  estimate: (_file, toExt) => ({ downloadKB: LIBS.mammoth.kb + (toExt === 'md' ? LIBS.turndown.kb : 0) }),
  async load() {}, // the worker loads Word support on first use
  async run(job, onProgress = () => {}, signal) {
    const { file, toExt } = job;
    job.warnings = [];
    onProgress(0);
    const buffer = await readDocx(file);
    let blob;
    if (toExt === 'txt') {
      const { text } = await callWorker('docx-text', { buffer }, { signal, transfer: [buffer] });
      blob = new Blob([`${text.replace(/\r\n?/g, '\n').trim()}\n`], { type: 'text/plain;charset=utf-8' });
    } else if (toExt === 'html') {
      const r = await callWorker('docx-html', { buffer, skipImages: false }, { signal, transfer: [buffer] });
      if (r.simplified) job.warnings.push(`${r.simplified} formatting detail${r.simplified === 1 ? ' was' : 's were'} simplified.`);
      const page = wrapHtmlDocument({ title: safeBaseName(file.name, 'Document'), bodyHtml: r.html });
      blob = new Blob([page], { type: 'text/html;charset=utf-8' });
    } else if (toExt === 'md') {
      const r = await callWorker('docx-html', { buffer, skipImages: true }, { signal, transfer: [buffer] });
      // Turndown needs a DOM, which workers do not have. Images are already dropped, so this input is small.
      const Turndown = await loadClassicScript(libUrl('turndown'), LIBS.turndown.global).catch(() => {
        throw new ConvertError('LIB_MISSING', 'The Markdown engine could not be loaded.');
      });
      const notes = {};
      const md = htmlToMarkdown(Turndown, r.html, notes);
      if (r.images) job.warnings.push(`${r.images} image${r.images === 1 ? ' was' : 's were'} left out. Markdown cannot hold them cleanly.`);
      blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    } else {
      throw new ConvertError('UNSUPPORTED', `Converting docx to ${toExt} is not available here.`);
    }
    onProgress(1);
    return blob;
  },
};
