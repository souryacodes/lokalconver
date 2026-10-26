// xlsx -> csv, json using SheetJS Community Edition 0.20.3 (self-hosted, see libs.js).
// Values are the text shown in Excel. Only ONE sheet is converted at a time; the others are named in a note.
import { ConvertError } from '../core/errors.js';
import { checkSize } from '../core/limits.js';
import { isZip, isOleOffice } from '../core/sniff.js';
import { toCsv, previewText } from '../core/csv.js';
import { callWorker } from '../core/lib-worker-client.js';
import { rowsToObjects } from './csv-json.js';
import { LIBS } from './libs.js';

export const xlsxConverter = {
  id: 'xlsx-data',
  from: ['xlsx'],
  to: ['csv', 'json'],
  engine: 'js',
  estimate: () => ({ downloadKB: LIBS.sheetjs.kb }),
  async load() {},
  // job.options: { sheetIndex?: number, typed?: boolean (json), bom?: boolean (csv) }
  // Sets job.sheetNames, job.preview, job.warnings.
  async run(job, onProgress = () => {}, signal) {
    const { file, toExt, options = {} } = job;
    onProgress(0);
    checkSize(file, 'xlsx');
    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
    if (isOleOffice(head)) {
      throw new ConvertError('BAD_FILE', 'This looks like an old .xls file or a password-protected workbook. Open it in Excel, remove the password or choose Save As > .xlsx, then try again.');
    }
    if (!isZip(head)) throw new ConvertError('BAD_FILE', 'This is not a real .xlsx file. Its content does not match its name.');

    const { sheets } = await callWorker('xlsx-sheets', { buffer }, { signal, transfer: [buffer] });
    job.sheetNames = sheets.map((s) => s.name);
    const index = Math.min(Math.max(options.sheetIndex ?? 0, 0), sheets.length - 1);
    const sheet = sheets[index];
    job.warnings = [];
    if (sheets.length > 1) job.warnings.push(`This workbook has ${sheets.length} sheets. Only "${sheet.name}" was converted.`);
    if (!sheet || !sheet.rows.length) throw new ConvertError('EMPTY', `The sheet "${sheet?.name ?? ''}" has no data.`);

    job.preview = previewText(sheet.rows, { maxRows: 10 });
    onProgress(1);
    if (toExt === 'csv') return new Blob([toCsv(sheet.rows, { bom: options.bom !== false })], { type: 'text/csv;charset=utf-8' });
    if (toExt === 'json') {
      const objects = rowsToObjects(sheet.rows, { typed: !!options.typed });
      return new Blob([`${JSON.stringify(objects, null, 2)}\n`], { type: 'application/json' });
    }
    throw new ConvertError('UNSUPPORTED', `Converting xlsx to ${toExt} is not available here.`);
  },
};
