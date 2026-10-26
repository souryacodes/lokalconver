// SHA-256 with Web Crypto, plus small helpers to compare a hash safely.
import { ConvertError } from './errors.js';
import { checkSize } from './limits.js';

const HEX64 = /^[0-9a-f]{64}$/;

// Accepts what people really paste: upper case, spaces, colons, "sha256:" or "SHA-256 =" prefixes.
export function normalizeHash(text) {
  return String(text ?? '')
    .trim()
    .replace(/^sha-?256\s*[:=]?\s*/i, '')
    .replace(/[\s:\-]/g, '')
    .toLowerCase();
}

export function isValidSha256(text) {
  return HEX64.test(normalizeHash(text));
}

// -> { status: 'empty' | 'invalid' | 'match' | 'different', expected }
export function compareHashes(actual, expectedInput) {
  const expected = normalizeHash(expectedInput);
  if (expected === '') return { status: 'empty', expected };
  if (!HEX64.test(expected)) return { status: 'invalid', expected };
  return { status: normalizeHash(actual) === expected ? 'match' : 'different', expected };
}

export function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Web Crypto cannot hash in pieces, so the whole file is read once. That is why there is a size limit.
export async function sha256OfFile(file, subtle = globalThis.crypto?.subtle) {
  if (!subtle) {
    throw new ConvertError('NO_CRYPTO',
      'This browser cannot calculate hashes here. Open the site over https:// (or localhost) and try again.');
  }
  checkSize(file, 'any');
  let data;
  try { data = await file.arrayBuffer(); }
  catch { throw new ConvertError('READ_FAILED', 'Could not read this file. It may have moved or the device ran out of memory.'); }
  return bytesToHex(await subtle.digest('SHA-256', data));
}
