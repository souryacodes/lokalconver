// md -> html. The result is a complete standalone HTML file for DOWNLOAD ONLY.
// It is never shown inside the app (no innerHTML, no iframe). The file also carries its own no-scripts policy.
import { checkSize } from '../core/limits.js';
import { decodeText } from '../core/text.js';
import { safeBaseName } from '../core/filename.js';
import { wrapHtmlDocument } from '../core/html-doc.js';
import { callWorker } from '../core/lib-worker-client.js';
import { LIBS } from './libs.js';

export const mdConverter = {
  id: 'md-html',
  from: ['md', 'markdown'],
  to: ['html'],
  engine: 'js',
  estimate: () => ({ downloadKB: LIBS.marked.kb }),
  async load() {},
  async run(job, onProgress = () => {}, signal) {
    const { file } = job;
    onProgress(0);
    checkSize(file, 'md');
    const { text, warning } = decodeText(await file.arrayBuffer());
    job.warnings = warning ? [warning] : [];
    const { html } = await callWorker('md-html', { text }, { signal });
    if (/<script|<iframe|<object|<embed/i.test(text)) job.warnings.push('Raw HTML tags in your Markdown were kept as plain text, not run.');
    onProgress(1);
    return new Blob([wrapHtmlDocument({ title: safeBaseName(file.name, 'Document'), bodyHtml: html })], { type: 'text/html;charset=utf-8' });
  },
};
