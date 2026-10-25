// safe.js - small safety helpers: file names, sizes, memory, object URLs.
//
// Pure logic where possible, so Node tests can run it. Only downloadBlob()
// touches the page, and it takes the document as a parameter.

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const WARN_BYTES = 500 * MIB; // above this we warn
export const DEFAULT_HARD_LIMIT_BYTES = 2 * GIB; // above this we refuse (configurable)

// ---------------------------------------------------------------- sizes

/** 1536 -> "1.5 KB". Uses 1024 per step, the way most phones and forms count. */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

// ---------------------------------------------------------------- file names

// Windows will not accept these as file names, even with an extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Control characters, and invisible characters used to fake file names
// (for example the right-to-left override that makes "gpj.exe" look like ".jpg").
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const FORBIDDEN = /[<>:"|?*]+/g;

const MAX_STEM_CHARS = 80;
const MAX_STEM_BYTES = 150; // keeps the whole name under the 255-byte limit of most disks

function cleanExt(ext) {
  return String(ext ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
}

function shorten(stem) {
  let chars = Array.from(stem).slice(0, MAX_STEM_CHARS); // by code point: never splits an emoji
  const encoder = new TextEncoder();
  while (chars.length > 1 && encoder.encode(chars.join('')).length > MAX_STEM_BYTES) {
    chars = chars.slice(0, -1);
  }
  return chars.join('').trim();
}

/**
 * Make a name that is safe to offer as a download.
 *   safeFileName('../../x.png', 'jpg') -> 'x.jpg'
 * Keeps letters of every language (Telugu, Hindi ...). Removes folders,
 * control characters and characters Windows rejects, and keeps it short.
 * Without newExt the old extension is kept (cleaned).
 */
export function safeFileName(name, newExt) {
  // 1. Only the last part of any path: "../../x.png" -> "x.png"
  const base = String(name ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? '';

  // 2. Split stem and extension.
  const dot = base.lastIndexOf('.');
  const hasExt = dot > 0;
  let stem = hasExt ? base.slice(0, dot) : base;
  const oldExt = hasExt ? base.slice(dot + 1) : '';

  // 3. Clean the stem.
  stem = stem
    .replace(FORBIDDEN, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // no hidden files, no "..", no leading spaces
    .replace(/[.\s]+$/, ''); // Windows drops trailing dots and spaces
  stem = shorten(stem);
  if (RESERVED.test(stem)) stem = `_${stem}`;
  if (stem === '') stem = 'file';

  const ext = cleanExt(newExt === undefined ? oldExt : newExt);
  return ext ? `${stem}.${ext}` : stem;
}

// ---------------------------------------------------------------- memory

export class MemoryLimitError extends Error {
  constructor(bytes, limitBytes) {
    super(`File of ${formatBytes(bytes)} is over the limit of ${formatBytes(limitBytes)}.`);
    this.name = 'MemoryLimitError';
    this.code = 'too-large';
    this.bytes = bytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Decides if a file is OK, big (warn) or too big (block).
 * The hard limit is a setting, because a phone and a laptop differ a lot.
 */
export function createMemoryGuard({ warnBytes = WARN_BYTES, hardLimitBytes = DEFAULT_HARD_LIMIT_BYTES } = {}) {
  let hard = hardLimitBytes;

  function check(bytes) {
    const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    if (size > hard) {
      return {
        level: 'block',
        bytes: size,
        limitBytes: hard,
        message: `This file is ${formatBytes(size)}. The limit on this device is ${formatBytes(hard)}.`,
      };
    }
    if (size > warnBytes) {
      return {
        level: 'warn',
        bytes: size,
        limitBytes: hard,
        message: `This is a big file (${formatBytes(size)}). It may be slow, and your browser may run out of memory.`,
      };
    }
    return { level: 'ok', bytes: size, limitBytes: hard, message: '' };
  }

  /** Like check(), but throws MemoryLimitError when the file is over the hard limit. */
  function assertOk(bytes) {
    const result = check(bytes);
    if (result.level === 'block') throw new MemoryLimitError(result.bytes, result.limitBytes);
    return result;
  }

  function setHardLimit(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new RangeError('Hard limit must be a positive number of bytes.');
    hard = bytes;
  }

  return {
    check,
    assertOk,
    setHardLimit,
    get hardLimitBytes() {
      return hard;
    },
    warnBytes,
  };
}

// ---------------------------------------------------------------- object URLs

/**
 * Object URLs keep the whole file in memory until they are revoked.
 * This keeps track of the ones we made, so none is forgotten.
 */
export function createObjectUrlManager({ api = globalThis.URL, setTimer = setTimeout } = {}) {
  const live = new Set();

  function revoke(url) {
    if (live.delete(url)) api.revokeObjectURL(url);
  }

  function create(blob) {
    const url = api.createObjectURL(blob);
    live.add(url);
    return url;
  }

  /** Make a URL, run fn(url), and always revoke it afterwards. */
  async function use(blob, fn) {
    const url = create(blob);
    try {
      return await fn(url);
    } finally {
      revoke(url);
    }
  }

  /** For downloads: the browser needs a moment to start, so revoke later. */
  function revokeAfter(url, ms = 30_000) {
    const timer = setTimer(() => revoke(url), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function revokeAll() {
    for (const url of [...live]) revoke(url);
  }

  return {
    create,
    use,
    revoke,
    revokeAfter,
    revokeAll,
    get size() {
      return live.size;
    },
  };
}

export const objectUrls = createObjectUrlManager();

/** Offer a Blob as a download. The name is cleaned; the URL is revoked later. */
export function downloadBlob(blob, fileName, { doc = globalThis.document, urls = objectUrls } = {}) {
  const url = urls.create(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = safeFileName(fileName); // property, never innerHTML
  link.rel = 'noopener';
  doc.body.append(link);
  link.click();
  link.remove();
  urls.revokeAfter(url);
}
