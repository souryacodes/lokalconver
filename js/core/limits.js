// Size limits in MB per input type. Chosen so a mid-range phone does not run out of memory.
import { ConvertError } from './errors.js';

export const LIMITS_MB = { docx: 25, xlsx: 25, md: 5, txt: 5, csv: 10, json: 10, any: 512 };
const LABEL = { docx: 'Word', xlsx: 'Excel', md: 'Markdown', txt: 'text', csv: 'CSV', json: 'JSON', any: 'this' };

export function fileExt(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name));
  return m ? m[1].toLowerCase() : '';
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// Throws a friendly ConvertError. kind = key of LIMITS_MB.
export function checkSize(file, kind) {
  const maxMB = LIMITS_MB[kind] ?? LIMITS_MB.any;
  if (file.size === 0) throw new ConvertError('EMPTY', 'This file is empty (0 bytes).');
  if (file.size > maxMB * 1048576) {
    throw new ConvertError('TOO_BIG',
      `This file is ${formatBytes(file.size)}. The limit for ${LABEL[kind] ?? 'this'} files is ${maxMB} MB, so it stays safe on your device.`);
  }
}
