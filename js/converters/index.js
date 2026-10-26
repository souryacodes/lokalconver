// Registry for the document and data converters.
import { docxConverter } from './docx.js';
import { mdConverter } from './md.js';
import { txtPdfConverter } from './txt-pdf.js';
import { csvJsonConverter } from './csv-json.js';
import { xlsxConverter } from './xlsx.js';
import { bridgeConverters } from './bridge-only.js';

export const converters = [docxConverter, mdConverter, txtPdfConverter, csvJsonConverter, xlsxConverter, ...bridgeConverters];

const ALIAS = { markdown: 'md' };
export const normalizeExt = (ext) => ALIAS[ext] ?? ext;

// Every output a given input extension can go to. Bridge-only ones come back with available:false.
export function targetsFor(fromExt) {
  const from = String(fromExt).toLowerCase();
  const out = [];
  for (const c of converters) {
    if (!c.from.includes(from)) continue;
    const tos = c.pairs ? c.pairs.filter(([f]) => f === from).map(([, t]) => t) : c.to;
    for (const toExt of tos) out.push({ toExt, converter: c, available: c.available !== false, label: c.label ?? null });
  }
  return out;
}

export function findConverter(fromExt, toExt) {
  return targetsFor(fromExt).find((t) => t.toExt === toExt && t.available)?.converter ?? null;
}

export const acceptedExtensions = [...new Set(converters.flatMap((c) => c.from))];
