// txt -> pdf with pdf-lib. Simple wrapping, A4, Helvetica 11 pt, new page when full.
// Limit: the built-in PDF font only has Western letters. Other scripts (Telugu, Hindi ...) become "?" and we say so.
import { checkSize } from '../core/limits.js';
import { decodeText } from '../core/text.js';
import { safeBaseName } from '../core/filename.js';
import { callWorker } from '../core/lib-worker-client.js';
import { LIBS } from './libs.js';

export const txtPdfConverter = {
  id: 'txt-pdf',
  from: ['txt'],
  to: ['pdf'],
  engine: 'js',
  estimate: () => ({ downloadKB: LIBS.pdflib.kb }),
  async load() {},
  async run(job, onProgress = () => {}, signal) {
    const { file } = job;
    onProgress(0);
    checkSize(file, 'txt');
    const { text, warning } = decodeText(await file.arrayBuffer());
    job.warnings = warning ? [warning] : [];
    const r = await callWorker('txt-pdf', { text, title: safeBaseName(file.name, 'Document') }, { signal });
    if (r.replaced) {
      job.warnings.push(`${r.replaced} character${r.replaced === 1 ? '' : 's'} (for example Telugu, Hindi or emoji) cannot be drawn with the built-in PDF font and became "?".`);
    }
    job.pages = r.pages;
    onProgress(1);
    return new Blob([r.bytes], { type: 'application/pdf' });
  },
};
