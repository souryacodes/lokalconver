// csv <-> json. Own small parser, no library, nothing to download.
// All values stay TEXT unless "typed" is on, so roll numbers like 0042 are never changed.
import { ConvertError } from '../core/errors.js';
import { checkSize } from '../core/limits.js';
import { decodeText } from '../core/text.js';
import { parseCsv, toCsv, previewText } from '../core/csv.js';

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/; // no leading zeros, no "1e5", so IDs stay safe

function typedValue(s) {
  if (NUMBER.test(s) && Number.isSafeInteger(Math.trunc(Number(s)))) return Number(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// Make header names usable as keys: fill empty ones, make duplicates unique.
export function cleanHeaders(headerRow) {
  const seen = new Map();
  return headerRow.map((h, i) => {
    let name = String(h).trim() || `column_${i + 1}`;
    const base = name;
    let k = seen.get(base) ?? 0;
    while (seen.has(name)) { k++; name = `${base}_${k}`; }
    seen.set(base, k);
    seen.set(name, 0);
    return name;
  });
}

export function rowsToObjects(rows, { typed = false } = {}) {
  if (!rows.length) return [];
  const headers = cleanHeaders(rows[0]);
  const width = Math.max(...rows.map((r) => r.length));
  while (headers.length < width) headers.push(`column_${headers.length + 1}`);
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { const v = r[i] ?? ''; o[h] = typed ? typedValue(v) : v; });
    return o;
  });
}

// JSON.parse errors can quote the file. Only the LINE number is safe to show.
function parseJsonFriendly(text) {
  try { return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch (e) {
    const m = /position (\d+)/.exec(String(e?.message));
    const where = m ? ` Near line ${text.slice(0, Number(m[1])).split('\n').length}.` : '';
    throw new ConvertError('BAD_JSON', `This is not valid JSON.${where} Check for a missing comma, bracket or quote.`);
  }
}

// -> { rows, warnings }  rows[0] is the header row
export function jsonToRows(value) {
  const warnings = [];
  let list = value;
  if (!Array.isArray(list) && list && typeof list === 'object') {
    const keys = Object.keys(list);
    list = keys.length === 1 && Array.isArray(list[keys[0]]) ? list[keys[0]] : [list];
  }
  if (!Array.isArray(list)) throw new ConvertError('BAD_JSON_SHAPE', 'CSV needs a list of rows. This JSON is a single value, not a list or an object.');
  if (!list.length) throw new ConvertError('BAD_JSON_SHAPE', 'This JSON list is empty, so there is nothing to put in a CSV.');

  let nested = 0;
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') { nested++; return JSON.stringify(v); }
    return String(v);
  };

  let rows;
  if (list.every((x) => Array.isArray(x))) {
    rows = list.map((r) => r.map(cell));
  } else if (list.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const headers = [];
    const seen = new Set();
    for (const o of list) for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); headers.push(k); }
    rows = [headers, ...list.map((o) => headers.map((h) => cell(o[h])))];
  } else if (list.every((x) => x === null || typeof x !== 'object')) {
    rows = [['value'], ...list.map((x) => [cell(x)])];
  } else {
    throw new ConvertError('BAD_JSON_SHAPE', 'The items in this JSON list are a mix of objects, lists and plain values. CSV needs them all to be the same kind.');
  }
  if (nested) warnings.push(`${nested} value${nested === 1 ? '' : 's'} held a list or object. They were written into the cell as JSON text.`);
  return { rows, warnings };
}

export const csvJsonConverter = {
  id: 'csv-json',
  from: ['csv', 'json'],
  to: ['json', 'csv'],
  engine: 'js',
  // A pair only works one way: csv -> json and json -> csv.
  pairs: [['csv', 'json'], ['json', 'csv']],
  estimate: () => ({ downloadKB: 0 }),
  async load() {},
  // job.options: { typed?: boolean, bom?: boolean }. Sets job.preview (text) and job.warnings.
  async run(job, onProgress = () => {}, signal) {
    const { file, fromExt, toExt, options = {} } = job;
    checkSize(file, fromExt);
    onProgress(0);
    const { text, warning } = decodeText(await file.arrayBuffer());
    job.warnings = warning ? [warning] : [];
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    let out, previewRows;
    if (fromExt === 'csv' && toExt === 'json') {
      const { rows } = await parseCsv(text, { signal });
      if (!rows.length) throw new ConvertError('EMPTY', 'This CSV has no rows.');
      const objects = rowsToObjects(rows, { typed: !!options.typed });
      out = JSON.stringify(objects, null, 2) + '\n';
      previewRows = rows;
      if (rows.length === 1) job.warnings.push('Only a header row was found, so the JSON list is empty.');
    } else if (fromExt === 'json' && toExt === 'csv') {
      const { rows, warnings } = jsonToRows(parseJsonFriendly(text));
      job.warnings.push(...warnings);
      out = toCsv(rows, { bom: options.bom !== false });
      previewRows = rows;
    } else {
      throw new ConvertError('UNSUPPORTED', `Converting ${fromExt} to ${toExt} is not available here.`);
    }
    job.preview = previewText(previewRows, { maxRows: 10 });
    onProgress(1);
    return new Blob([out], { type: toExt === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
  },
};
