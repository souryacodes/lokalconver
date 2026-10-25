// detect.js - find out what a file REALLY is by reading its first bytes.
//
// Why: a file name is only a claim. People rename .png to .jpg, phones save
// HEIC photos as ".jpg", and some sites hand out ".docx" files that are not
// Word files. So the bytes decide. If the name disagrees we trust the bytes
// and say so in `mismatch`.
//
// Pure logic: no DOM, no network. Works in the browser and in Node tests.

export const SNIFF_BYTES = 64 * 1024; // how much of a file detectFile() reads

// Every format we can name. `kind` tells the UI which family it belongs to.
export const FORMATS = Object.freeze({
  png: { mime: 'image/png', kind: 'image' },
  jpg: { mime: 'image/jpeg', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  bmp: { mime: 'image/bmp', kind: 'image' },
  ico: { mime: 'image/x-icon', kind: 'image' },
  heic: { mime: 'image/heic', kind: 'image' },
  heif: { mime: 'image/heif', kind: 'image' },
  avif: { mime: 'image/avif', kind: 'image' },
  svg: { mime: 'image/svg+xml', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'doc',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'doc',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'data',
  },
  zip: { mime: 'application/zip', kind: 'data' },
  txt: { mime: 'text/plain', kind: 'doc' },
  md: { mime: 'text/markdown', kind: 'doc' },
  html: { mime: 'text/html', kind: 'doc' },
  csv: { mime: 'text/csv', kind: 'data' },
  tsv: { mime: 'text/tab-separated-values', kind: 'data' },
  json: { mime: 'application/json', kind: 'data' },
  mp3: { mime: 'audio/mpeg', kind: 'audio' },
  wav: { mime: 'audio/wav', kind: 'audio' },
  ogg: { mime: 'audio/ogg', kind: 'audio' },
  flac: { mime: 'audio/flac', kind: 'audio' },
  m4a: { mime: 'audio/mp4', kind: 'audio' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  mkv: { mime: 'video/x-matroska', kind: 'video' },
});

// Other spellings of the same format.
const ALIASES = Object.freeze({
  jpeg: 'jpg',
  jpe: 'jpg',
  jfif: 'jpg',
  htm: 'html',
  markdown: 'md',
  text: 'txt',
  m4v: 'mp4',
  qt: 'mov',
  wave: 'wav',
  oga: 'ogg',
  opus: 'ogg',
});

// Formats that are different names for one family. A ".heif" file that
// holds HEIC data is not a lie.
const SAME_FAMILY = [['heic', 'heif']];

const OFFICE_EXTS = new Set(['docx', 'xlsx', 'pptx']);
const TEXT_EXTS = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'html', 'svg']);

// ---------------------------------------------------------------- names

/** Lower-case, no dot, aliases folded: "JPEG" -> "jpg". */
export function normalizeExt(ext) {
  const clean = String(ext ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ALIASES[clean] ?? clean;
}

/** The extension of a file name, normalised. "" when there is none. */
export function extOf(fileName) {
  const base = String(fileName ?? '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  // A leading dot (".png") is a hidden file name, not an extension.
  if (dot <= 0) return '';
  return normalizeExt(base.slice(dot + 1));
}

function sameFormat(a, b) {
  if (a === b) return true;
  return SAME_FAMILY.some((group) => group.includes(a) && group.includes(b));
}

// ---------------------------------------------------------------- bytes

/** Accept Uint8Array, Buffer, other typed arrays, ArrayBuffer, number[]. */
export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) return Uint8Array.from(input);
  return new Uint8Array(0);
}

function matches(b, signature, offset = 0) {
  if (b.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (b[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(b, start, end) {
  let out = '';
  const stop = Math.min(end, b.length);
  for (let i = start; i < stop; i += 1) out += String.fromCharCode(b[i]);
  return out;
}

function u16le(b, i) {
  return i + 2 <= b.length ? b[i] | (b[i + 1] << 8) : -1;
}

function u32le(b, i) {
  if (i < 0 || i + 4 > b.length) return -1;
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function u32be(b, i) {
  if (i + 4 > b.length) return 0;
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

// ---------------------------------------------------------------- sniffers

function isBmp(b) {
  // "BM" alone is too weak (plain text can start with it), so we also check
  // that the next header has one of the sizes real BMP files use.
  if (ascii(b, 0, 2) !== 'BM' || b.length < 18) return false;
  return [12, 40, 52, 56, 64, 108, 124].includes(u32le(b, 14));
}

function isIco(b) {
  if (!matches(b, [0, 0, 1, 0]) || b.length < 22) return false;
  const count = u16le(b, 4);
  return count >= 1 && count <= 256 && b[9] === 0;
}

function isPdf(b) {
  // The PDF spec lets a few junk bytes come before "%PDF-".
  const head = ascii(b, 0, 1024);
  return head.includes('%PDF-');
}

function isMp3Frame(b) {
  // Bare MP3 frame header: 11 sync bits, MPEG version, layer III, and
  // bitrate / sample-rate values that are allowed.
  if (b.length < 4 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return false;
  const version = (b[1] >> 3) & 3;
  const layer = (b[1] >> 1) & 3;
  const bitrate = b[2] >> 4;
  const sampleRate = (b[2] >> 2) & 3;
  return version !== 1 && layer === 1 && bitrate !== 15 && sampleRate !== 3;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_GENERIC = new Set(['mif1', 'msf1', 'heif']);

function sniffFtyp(b) {
  // ISO base media: [size][ftyp][major brand][minor version][compatible...]
  const major = ascii(b, 8, 12);
  const boxEnd = Math.min(u32be(b, 0) || b.length, b.length);
  const brands = [major];
  for (let i = 16; i + 4 <= boxEnd; i += 4) brands.push(ascii(b, i, i + 4));

  if (AVIF_BRANDS.has(major)) return 'avif';
  if (HEIC_BRANDS.has(major)) return 'heic';
  if (HEIF_GENERIC.has(major)) {
    if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
    if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
    return 'heif';
  }
  if (major === 'qt  ') return 'mov';
  if (major === 'M4A ' || major === 'M4B ') return 'm4a';
  return 'mp4';
}

function sniffEbml(b, claimed) {
  // EBML header holds a DocType: "webm" or "matroska".
  const limit = Math.min(b.length - 3, 128);
  for (let i = 4; i < limit; i += 1) {
    if (b[i] === 0x42 && b[i + 1] === 0x82) {
      const len = b[i + 2] & 0x7f;
      const docType = ascii(b, i + 3, i + 3 + len);
      if (docType === 'webm') return 'webm';
      if (docType === 'matroska') return 'mkv';
    }
  }
  // Header cut short: trust the name when it is one of the two, else mkv.
  return claimed === 'webm' ? 'webm' : 'mkv';
}

// --- zip family (zip, docx, xlsx, pptx) ---

function findEndRecord(b) {
  const lowest = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= lowest; i -= 1) {
    if (u32le(b, i) === 0x06054b50) return i;
  }
  return -1;
}

function decodeName(b, start, end) {
  return new TextDecoder('utf-8').decode(b.subarray(start, end));
}

/**
 * List the file names stored inside a zip, as far as the bytes allow.
 * `complete` is true when we read the full central directory.
 */
function readZipNames(b) {
  const names = [];

  const endAt = findEndRecord(b);
  if (endAt >= 0) {
    const cdSize = u32le(b, endAt + 12);
    const cdOffset = u32le(b, endAt + 16);
    if (cdOffset >= 0 && cdOffset + cdSize <= b.length && u32le(b, cdOffset) === 0x02014b50) {
      let pos = cdOffset;
      const end = cdOffset + cdSize;
      while (pos + 46 <= end && u32le(b, pos) === 0x02014b50) {
        const nameLen = u16le(b, pos + 28);
        const extraLen = u16le(b, pos + 30);
        const commentLen = u16le(b, pos + 32);
        if (pos + 46 + nameLen > b.length) break;
        names.push(decodeName(b, pos + 46, pos + 46 + nameLen));
        pos += 46 + nameLen + extraLen + commentLen;
      }
      if (names.length > 0) return { names, complete: true };
    }
  }

  // We only have the start of the file: walk the local headers one by one.
  let pos = 0;
  while (pos + 30 <= b.length && u32le(b, pos) === 0x04034b50) {
    const flags = u16le(b, pos + 6);
    const packedSize = u32le(b, pos + 18);
    const nameLen = u16le(b, pos + 26);
    const extraLen = u16le(b, pos + 28);
    if (pos + 30 + nameLen > b.length) break;
    names.push(decodeName(b, pos + 30, pos + 30 + nameLen));
    // Bit 3 means the size is written after the data, so we cannot hop.
    if ((flags & 8) !== 0 && packedSize === 0) break;
    pos += 30 + nameLen + extraLen + packedSize;
  }
  return { names, complete: false };
}

function sniffZip(b, claimed) {
  const { names, complete } = readZipNames(b);
  const has = (prefix) => names.some((n) => n.startsWith(prefix));
  if (has('word/')) return { ext: 'docx' };
  if (has('xl/')) return { ext: 'xlsx' };
  if (has('ppt/')) return { ext: 'pptx' };

  // We saw the start only and it looks like an Office file, but the part
  // that names the type is further in. The name is our best hint here.
  const looksOffice = names.includes('[Content_Types].xml');
  if (!complete && OFFICE_EXTS.has(claimed) && (looksOffice || names.length === 0)) {
    return { ext: claimed, note: 'We could not look inside this file, so we went by its name.' };
  }
  return { ext: 'zip' };
}

// --- plain text family (txt, md, csv, tsv, json, html, svg) ---

function hasUtf16Bom(b) {
  return b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
}

function looksLikeText(b) {
  if (hasUtf16Bom(b)) return true;
  const n = Math.min(b.length, 4096);
  let odd = 0;
  for (let i = 0; i < n; i += 1) {
    const c = b[i];
    if (c === 0) return false;
    const control = c < 0x20 && c !== 9 && c !== 10 && c !== 13 && c !== 12;
    if (control || c === 0x7f) odd += 1;
  }
  return odd / n < 0.02;
}

function peekText(b) {
  let start = 0;
  let label = 'utf-8';
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) start = 3;
  else if (b[0] === 0xff && b[1] === 0xfe) [start, label] = [2, 'utf-16le'];
  else if (b[0] === 0xfe && b[1] === 0xff) [start, label] = [2, 'utf-16be'];
  try {
    return new TextDecoder(label).decode(b.subarray(start, Math.min(b.length, start + 4096)));
  } catch {
    return '';
  }
}

function sniffText(b, claimed) {
  const text = peekText(b).trimStart();
  const head = text.slice(0, 2048).toLowerCase();
  const isSvg = head.includes('<svg') && !head.includes('<html');
  const isHtml = head.startsWith('<!doctype html') || head.startsWith('<html');

  // Where the bytes can check the name, they do.
  if (claimed === 'svg') return isSvg ? 'svg' : 'txt';
  if (claimed === 'json') return /^[[{"\-0-9tfn]/.test(text) ? 'json' : 'txt';
  // csv, txt, md and html cannot be proved from bytes; the name is all we have.
  if (TEXT_EXTS.has(claimed)) return claimed;

  if (isSvg) return 'svg';
  if (isHtml) return 'html';
  if (/^[[{]/.test(text)) return 'json';
  return 'txt';
}

// ---------------------------------------------------------------- main

function sniff(b, claimed) {
  if (b.length === 0) return { ext: '', note: 'This file is empty.' };

  if (matches(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png' };
  if (matches(b, [0xff, 0xd8, 0xff])) return { ext: 'jpg' };
  const gif = ascii(b, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return { ext: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const form = ascii(b, 8, 12);
    if (form === 'WEBP') return { ext: 'webp' };
    if (form === 'WAVE') return { ext: 'wav' };
  }
  if (isBmp(b)) return { ext: 'bmp' };
  if (isIco(b)) return { ext: 'ico' };
  if (isPdf(b)) return { ext: 'pdf' };
  if (matches(b, [0x50, 0x4b, 3, 4]) || matches(b, [0x50, 0x4b, 5, 6]) || matches(b, [0x50, 0x4b, 7, 8])) {
    return sniffZip(b, claimed);
  }
  if (ascii(b, 0, 4) === 'OggS') return { ext: 'ogg' };
  if (ascii(b, 0, 4) === 'fLaC') return { ext: 'flac' };
  if (ascii(b, 0, 3) === 'ID3' && b.length > 3 && b[3] !== 0xff) return { ext: 'mp3' };
  if (ascii(b, 4, 8) === 'ftyp') return { ext: sniffFtyp(b) };
  if (matches(b, [0x1a, 0x45, 0xdf, 0xa3])) return { ext: sniffEbml(b, claimed) };
  if (isMp3Frame(b)) return { ext: 'mp3' };
  if (looksLikeText(b)) return { ext: sniffText(b, claimed) };
  return { ext: '' };
}

function mismatchFor(claimed, ext) {
  if (!claimed || sameFormat(claimed, ext)) return null;
  // An unknown name on unknown bytes is just an unsupported file, not a lie.
  if (!ext && !(claimed in FORMATS)) return null;
  const message = ext
    ? `The name says .${claimed}, but this file is really ${ext.toUpperCase()}. We will use ${ext.toUpperCase()}.`
    : `The name says .${claimed}, but we cannot recognise what is inside. The file may be damaged.`;
  return { claimed, found: ext || 'unknown', message };
}

/**
 * Work out what a file is from its first bytes.
 *
 * @param bytes     Uint8Array (or ArrayBuffer). Give it at least the first
 *                  4 KB; up to SNIFF_BYTES helps Office files.
 * @param fileName  Used only as a hint and to report a mismatch.
 * @returns {{ ext, mime, kind, mismatch, claimedExt, note }}
 *   ext         what the bytes say ("" when we do not know)
 *   kind        image | pdf | doc | audio | video | data | unknown
 *   mismatch    null, or { claimed, found, message } when the name lied
 *   claimedExt  what the file name says
 *   note        null, or a short plain sentence worth showing
 */
export function detectType(bytes, fileName = '') {
  const b = toBytes(bytes);
  const claimedExt = extOf(fileName);
  const found = sniff(b, claimedExt);
  const info = FORMATS[found.ext];
  return {
    ext: found.ext,
    mime: info ? info.mime : 'application/octet-stream',
    kind: info ? info.kind : 'unknown',
    mismatch: b.length === 0 ? null : mismatchFor(claimedExt, found.ext),
    claimedExt,
    note: found.note ?? null,
  };
}

/** Browser helper: read the start of a File/Blob and detect it. */
export async function detectFile(file) {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  return detectType(head, file.name ?? '');
}
