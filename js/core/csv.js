// A small CSV reader and writer. Handles quoted commas, "" for a quote, and new lines inside quotes.
import { ConvertError } from './errors.js';

const BOM = '\uFEFF';

// Pick the separator from the first line (outside quotes). Default is a comma.
export function detectDelimiter(text) {
  let counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (let i = 0; i < text.length && i < 20000; i++) {
    const c = text[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && (c === '\n' || c === '\r')) { if (Object.values(counts).some((n) => n > 0)) break; }
    else if (!inQ && c in counts) counts[c]++;
  }
  let best = ',', max = 0;
  for (const [d, n] of Object.entries(counts)) if (n > max) { best = d; max = n; }
  return best;
}

// Generator: yields one row (array of strings) at a time, so callers can pause between rows.
// Blank lines are skipped. A quote inside an unquoted field is kept as it is (lenient).
export function* csvRowIter(input, delimiter = ',') {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const n = text.length;
  let i = 0, line = 1;
  let row = [], field = '';
  let inQuotes = false, quoteLine = 0, fieldWasQuoted = false;

  let rowHadQuote = false; // a row like "" is a real empty value, not a blank line
  const endField = () => { row.push(field); field = ''; rowHadQuote = rowHadQuote || fieldWasQuoted; fieldWasQuoted = false; };
  const isBlank = (r) => r.length === 1 && r[0] === '' && !rowHadQuote;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      if (c === '\n') line++;
      field += c; i++; continue;
    }
    if (c === '"' && field === '' && !fieldWasQuoted) { inQuotes = true; fieldWasQuoted = true; quoteLine = line; i++; continue; }
    if (c === delimiter) { endField(); i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; line++;
      endField();
      if (!isBlank(row)) yield row;
      row = []; rowHadQuote = false;
      continue;
    }
    field += c; i++;
  }
  if (inQuotes) {
    throw new ConvertError('BAD_CSV',
      `A quoted value starting on line ${quoteLine} never ends. Look for a missing closing quote (").`);
  }
  if (field !== '' || row.length > 0 || fieldWasQuoted) { endField(); if (!isBlank(row)) yield row; }
}

export function parseCsvSync(text, delimiter = detectDelimiter(text)) {
  return Array.from(csvRowIter(text, delimiter));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Same result, but gives the browser a breath every few thousand rows so the page never freezes.
export async function parseCsv(text, { delimiter, signal, sliceRows = 5000 } = {}) {
  const d = delimiter ?? detectDelimiter(text);
  const rows = [];
  for (const row of csvRowIter(text, d)) {
    rows.push(row);
    if (rows.length % sliceRows === 0) {
      await tick();
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    }
  }
  return { rows, delimiter: d };
}

function quoteField(v, delimiter) {
  const s = v === null || v === undefined ? '' : String(v);
  const needs = s.includes('"') || s.includes(delimiter) || /[\r\n]/.test(s) || /^\s|\s$/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

// Excel on Windows needs the BOM to show non-English letters properly, so it is on by default.
export function toCsv(rows, { delimiter = ',', eol = '\r\n', bom = true } = {}) {
  const body = rows.map((r) => r.map((v) => quoteField(v, delimiter)).join(delimiter)).join(eol);
  return (bom ? BOM : '') + body + (rows.length ? eol : '');
}

// Plain-text preview of the first rows. The result goes into textContent, never innerHTML.
export function previewText(rows, { maxRows = 10, maxCellChars = 24, maxCols = 8 } = {}) {
  if (!rows.length) return '(no rows)';
  const shown = rows.slice(0, maxRows);
  const cols = Math.min(maxCols, Math.max(...shown.map((r) => r.length)));
  const clip = (v) => {
    const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ');
    return s.length > maxCellChars ? `${s.slice(0, maxCellChars - 1)}…` : s;
  };
  const cells = shown.map((r) => Array.from({ length: cols }, (_, c) => clip(r[c])));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...cells.map((r) => [...r[c]].length)));
  const lines = cells.map((r) => r.map((s, c) => s + ' '.repeat(widths[c] - [...s].length)).join(' | ').trimEnd());
  const extraCols = Math.max(...shown.map((r) => r.length)) - cols;
  const notes = [];
  if (rows.length > maxRows) notes.push(`… ${rows.length - maxRows} more row${rows.length - maxRows === 1 ? '' : 's'}`);
  if (extraCols > 0) notes.push(`… ${extraCols} more column${extraCols === 1 ? '' : 's'} not shown`);
  return [...lines, ...notes].join('\n');
}
