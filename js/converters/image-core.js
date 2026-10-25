// image-core.js - the pure (no browser) parts of the image converter.
// WHY a separate file: nothing here touches the DOM, canvas or network, so
// Node can test all of it with `node --test` and the worker can import it.

// ---------- Formats ----------

// Formats the browser can usually read. 'avif' is hidden at runtime if the
// browser cannot decode it (see image.js). HEIC/HEIF use a separate decoder.
export const INPUT_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
export const HEIC_EXTS = ['heic', 'heif'];

// 'avif' is NOT in this list on purpose: it is added only if the browser
// can really encode it.
export const OUTPUT_EXTS = ['jpg', 'png', 'webp', 'bmp', 'ico'];

export const ICO_SIZES = [16, 32, 48, 64, 128, 256];

export const MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

// Only these formats have a quality dial. PNG, BMP and ICO are lossless.
export const LOSSY = new Set(['jpg', 'webp', 'avif']);
// "Under N KB" only makes sense for formats where quality can go down.
export const TARGET_FORMATS = ['jpg', 'webp', 'avif'];

// ---------- Limits (tweak here, not in the code below) ----------

// Browsers refuse canvases that are too big. These are the ceilings we ask
// for first. If the device says no, we step down by `shrinkFactor`.
export const LIMITS = {
  maxSide: 16384,
  maxPixels: 64_000_000, // 64 megapixels (about 256 MB of RGBA)
  shrinkFactor: 0.75,
  minSide: 64,
};

// Rules for the "under N KB" search.
export const TARGET = {
  minQuality: 0.35, // below this, JPEG/WebP start to look broken
  maxQuality: 0.95, // above this, files grow a lot for no visible gain
  maxTries: 8,
  shrinkStep: 0.9, // each step makes width and height 10 percent smaller
  minScale: 0.25, // never go below a quarter of the width/height ...
  minLongSide: 480, // ... or below 480 px on the long side
};

// A vector picture should be drawn at least this big so it stays sharp.
export const SVG_MIN_LONG_SIDE = 1024;

// ---------- Errors ----------

// An error with a message that is safe and clear to show to the visitor.
export class ImageError extends Error {
  constructor(message, code = 'user') {
    super(message);
    this.name = 'ImageError';
    this.code = code;
  }
}

export function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}

// ---------- File type helpers ----------

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/heic-sequence': 'heic',
  'image/heif-sequence': 'heic',
};

const KNOWN_INPUTS = new Set([...INPUT_EXTS, ...HEIC_EXTS, 'jpg', 'heic']);

// jpeg/jpe/jfif are all JPEG. heif is read the same way as heic.
export function normalizeExt(ext) {
  const e = String(ext ?? '').toLowerCase().replace(/^\./, '');
  if (e === 'jpeg' || e === 'jpe' || e === 'jfif') return 'jpg';
  if (e === 'heif') return 'heic';
  return e;
}

export function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName ?? ''));
  return m ? normalizeExt(m[1]) : '';
}

// Phones sometimes give files with no MIME type, so the name comes first
// and the MIME type is the backup.
export function inferInputExt(file) {
  const fromName = extOf(file?.name);
  if (KNOWN_INPUTS.has(fromName)) return fromName;
  const fromMime = MIME_TO_EXT[String(file?.type ?? '').toLowerCase()];
  return fromMime || fromName;
}

// Reads the first bytes of a file and says if it looks like HEIC/HEIF.
// Layout: bytes 4-8 are "ftyp", bytes 8-12 are the brand.
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
export function looksLikeHeif(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const text = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  return text(4, 8) === 'ftyp' && HEIF_BRANDS.has(text(8, 12));
}

// ---------- Options ----------

function parseDimension(value, label, errors) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > LIMITS.maxSide) {
    errors.push(`${label} must be a number from 1 to ${LIMITS.maxSide}.`);
    return undefined;
  }
  return Math.round(n);
}

function parseHexColour(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return `#${hex}`;
}

// Checks what the UI sent and fills in defaults. Never throws: the caller
// shows `errors` to the visitor.
// Metadata (EXIF, GPS, camera name) is ALWAYS stripped. The canvas export
// drops it, so we ignore any attempt to turn it off.
export function validateOptions(raw = {}, toExt = 'jpg') {
  const errors = [];
  const options = {
    quality: 85,
    resize: { mode: 'none' },
    background: '#ffffff',
    stripMetadata: true,
    icoSizes: [...ICO_SIZES],
    maxKB: null,
  };

  if (raw.quality !== undefined && raw.quality !== null) {
    const q = Number(raw.quality);
    if (!Number.isFinite(q) || q < 1 || q > 100) errors.push('Quality must be a number from 1 to 100.');
    else options.quality = Math.round(q);
  }

  // Presets use flat maxWidth/maxHeight; the UI may send a resize object.
  const r = raw.resize ?? (raw.maxWidth || raw.maxHeight
    ? { mode: 'max', maxWidth: raw.maxWidth, maxHeight: raw.maxHeight }
    : { mode: 'none' });
  const mode = r.mode ?? 'none';
  if (mode === 'max') {
    const maxWidth = parseDimension(r.maxWidth, 'Max width', errors);
    const maxHeight = parseDimension(r.maxHeight, 'Max height', errors);
    if (maxWidth === undefined && maxHeight === undefined) {
      if (!errors.length) errors.push('Give a max width or a max height.');
    } else {
      options.resize = { mode: 'max', maxWidth, maxHeight };
    }
  } else if (mode === 'percent') {
    const p = Number(r.percent);
    if (!Number.isFinite(p) || p < 1 || p > 400) errors.push('Resize percent must be from 1 to 400.');
    else options.resize = { mode: 'percent', percent: p };
  } else if (mode !== 'none') {
    errors.push('Resize mode must be none, max or percent.');
  }

  if (raw.background !== undefined && raw.background !== null) {
    const colour = parseHexColour(raw.background);
    if (!colour) errors.push('Background colour must look like #ffffff.');
    else options.background = colour;
  }

  const kb = raw.maxKB ?? raw.targetKB;
  if (kb !== undefined && kb !== null && kb !== '') {
    const n = Number(kb);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
      errors.push('Target size must be a number of KB, 1 or more.');
    } else if (!TARGET_FORMATS.includes(toExt)) {
      errors.push('Target size works with jpg, webp or avif output.');
    } else {
      options.maxKB = n;
    }
  }

  if (raw.icoSizes !== undefined && raw.icoSizes !== null) {
    const list = Array.isArray(raw.icoSizes) ? raw.icoSizes.map(Number) : [];
    if (!list.length || !list.every((s) => ICO_SIZES.includes(s))) {
      errors.push(`Icon sizes must be some of ${ICO_SIZES.join(', ')}.`);
    } else {
      options.icoSizes = [...new Set(list)].sort((a, b) => a - b);
    }
  }

  return { ok: errors.length === 0, options, errors };
}

// ---------- Size maths ----------

export function scaleSize(width, height, scale) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Like scaleSize but rounds DOWN, so a limit is never passed by rounding.
function floorSize(width, height, scale) {
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

// Final size after the visitor's resize choice. Photos are never enlarged
// by "max" (it would only add blur); vectors may be (allowUpscale).
export function computeOutputSize(width, height, resize = { mode: 'none' }, allowUpscale = false) {
  let scale = 1;
  if (resize.mode === 'percent') {
    scale = resize.percent / 100;
  } else if (resize.mode === 'max') {
    const byWidth = resize.maxWidth ? resize.maxWidth / width : Infinity;
    const byHeight = resize.maxHeight ? resize.maxHeight / height : Infinity;
    scale = Math.min(byWidth, byHeight);
    if (!Number.isFinite(scale)) scale = 1;
    if (!allowUpscale) scale = Math.min(1, scale);
  }
  return scaleSize(width, height, scale);
}

// Biggest size that fits inside the canvas limits (same shape).
export function clampToLimits(width, height, limits = LIMITS) {
  let scale = 1;
  if (width > limits.maxSide) scale = Math.min(scale, limits.maxSide / width);
  if (height > limits.maxSide) scale = Math.min(scale, limits.maxSide / height);
  if (width * height > limits.maxPixels) scale = Math.min(scale, Math.sqrt(limits.maxPixels / (width * height)));
  return scale >= 1 ? { width, height } : floorSize(width, height, scale);
}

// Sizes to try, biggest first: the clamped size, then 75 percent steps.
// The caller picks the first one the device can really make.
export function canvasSizeCandidates(width, height, limits = LIMITS) {
  let current = clampToLimits(width, height, limits);
  const list = [current];
  while (Math.max(current.width, current.height) * limits.shrinkFactor >= limits.minSide) {
    current = floorSize(current.width, current.height, limits.shrinkFactor);
    list.push(current);
  }
  return list;
}

// Drawing a huge picture into a tiny canvas in ONE step looks jagged.
// Halving step by step looks much better. Returns the sizes to draw, in order.
export function halvingPlan(srcW, srcH, dstW, dstH, maxPixels = LIMITS.maxPixels) {
  const plan = [];
  let w = srcW;
  let h = srcH;
  for (;;) {
    const canHalve = w >= 2 * dstW && h >= 2 * dstH;
    // Also halve when the source is too big to be a canvas at all.
    const tooBig = w * h > maxPixels && (w > dstW || h > dstH);
    if (!canHalve && !tooBig) break;
    const nextW = Math.max(dstW, Math.ceil(w / 2));
    const nextH = Math.max(dstH, Math.ceil(h / 2));
    if (nextW === w && nextH === h) break;
    w = nextW;
    h = nextH;
    plan.push({ width: w, height: h });
  }
  const last = plan[plan.length - 1];
  if (!last || last.width !== dstW || last.height !== dstH) plan.push({ width: dstW, height: dstH });
  return plan;
}

// Picture size that fits inside a square box (used for icons).
export function containSize(width, height, box) {
  return scaleSize(width, height, Math.min(box / width, box / height));
}

// "50 KB" means 50 000 bytes here, not 51 200. A file under 50 000 bytes
// passes both counting styles, and upload forms differ on which they use.
export function kbToBytes(kb) {
  return Math.floor(kb * 1000);
}

// Scales to try for "under N KB": 1, 0.9, 0.81, ... until the picture
// would get too small to read. Small pictures only get [1].
export function shrinkScales(width, height, t = TARGET) {
  const scales = [1];
  const longSide = Math.max(width, height);
  let s = 1;
  for (;;) {
    s *= t.shrinkStep;
    if (s < t.minScale - 1e-9) break;
    if (longSide * s < t.minLongSide) break;
    scales.push(Math.round(s * 10000) / 10000);
  }
  return scales;
}

// ---------- Target size search ----------

// Finds the best quality that makes the file fit in maxBytes.
// encodeFn(quality 0..1) -> Promise of something with a numeric `size`
// (a Blob works; so does a fake in tests).
// Order: try the top quality (often enough), then the bottom quality (to give
// up early when it is impossible), then bisect with the tries that are left.
export async function bestQualityForTarget(encodeFn, maxBytes, opts = {}) {
  const {
    minQuality = TARGET.minQuality,
    maxQuality = TARGET.maxQuality,
    maxTries = TARGET.maxTries,
    signal,
  } = opts;
  if (typeof encodeFn !== 'function') throw new TypeError('encodeFn must be a function.');
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be more than 0.');
  if (!(minQuality > 0 && minQuality < maxQuality && maxQuality <= 1)) throw new RangeError('Bad quality range.');
  if (!Number.isInteger(maxTries) || maxTries < 1) throw new RangeError('maxTries must be 1 or more.');

  const history = [];
  let tries = 0;
  const attempt = async (quality) => {
    if (signal?.aborted) throw abortError();
    const result = await encodeFn(quality);
    tries += 1;
    if (!result || !Number.isFinite(result.size)) throw new Error('The encoder gave no result.');
    history.push({ quality, bytes: result.size });
    return result;
  };
  const answer = (result, quality, fits) => ({ result, quality, bytes: result.size, fits, tries, history });

  const top = await attempt(maxQuality);
  if (top.size <= maxBytes) return answer(top, maxQuality, true);
  if (tries >= maxTries) return answer(top, maxQuality, false);

  const bottom = await attempt(minQuality);
  // Even the lowest quality is too big: report the smallest we made.
  if (bottom.size > maxBytes) return answer(bottom, minQuality, false);

  let low = minQuality;
  let high = maxQuality;
  let best = { result: bottom, quality: minQuality };
  while (tries < maxTries) {
    const mid = Math.round(((low + high) / 2) * 100) / 100;
    if (mid <= low || mid >= high) break; // no new quality left to try
    const result = await attempt(mid);
    if (result.size <= maxBytes) {
      best = { result, quality: mid };
      low = mid;
    } else {
      high = mid;
    }
  }
  return answer(best.result, best.quality, true);
}

// ---------- Messages shown to the visitor ----------

export function targetMessage({ fits, maxKB, bytes, width, height, fromWidth, fromHeight }) {
  // Round UP so we never say "20 KB" about a file that is 20.4 KB.
  const got = Math.ceil(bytes / 1000);
  if (!fits) return `Could not reach ${maxKB} KB without making it unreadable: got ${got} KB`;
  let text = `Reached ${got} KB (limit ${maxKB} KB)`;
  if (width !== fromWidth || height !== fromHeight) {
    text += `. Picture made smaller: ${fromWidth}×${fromHeight} to ${width}×${height}`;
  }
  return text;
}

export function reductionNote(wanted, got) {
  return `This picture is very big (${wanted.width}×${wanted.height}). This device cannot draw one that large, so the result is ${got.width}×${got.height}.`;
}

// ---------- SVG size reading ----------

const CSS_UNITS_IN_PX = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

// "12", "12px", "3cm" -> pixels. Percent and other things -> null.
export function parseLength(value) {
  if (value === null || value === undefined) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(String(value));
  if (!m) return null;
  const px = parseFloat(m[1]) * CSS_UNITS_IN_PX[(m[2] || 'px').toLowerCase()];
  return px > 0 ? px : null;
}

// The size the SVG says it has: width/height first, viewBox as the backup.
export function parseSvgSize({ width, height, viewBox }) {
  const w = parseLength(width);
  const h = parseLength(height);
  let box = null;
  if (viewBox) {
    const p = String(viewBox).trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) box = { w: p[2], h: p[3] };
  }
  if (w && h) return { width: w, height: h };
  if (box) {
    if (w) return { width: w, height: (w * box.h) / box.w };
    if (h) return { width: (h * box.w) / box.h, height: h };
    return { width: box.w, height: box.h };
  }
  return null;
}

// Size to draw an SVG at. Vectors do not blur when enlarged, so we start
// from at least SVG_MIN_LONG_SIDE and let "max" enlarge too.
export function svgRasterSize(intrinsic, resize = { mode: 'none' }) {
  const longSide = Math.max(intrinsic.width, intrinsic.height);
  const lift = longSide < SVG_MIN_LONG_SIDE ? SVG_MIN_LONG_SIDE / longSide : 1;
  const base = scaleSize(intrinsic.width, intrinsic.height, lift);
  return computeOutputSize(base.width, base.height, resize, true);
}

// ---------- ICO and BMP writers ----------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// entries: [{ size: 16, data: Uint8Array of a PNG file }, ...]
// An ICO file is: 6 byte header, 16 bytes per picture, then the pictures.
// Modern Windows, macOS and browsers accept PNG data inside an ICO.
export function buildIco(entries) {
  if (!entries?.length) throw new Error('An icon needs at least one picture.');
  for (const e of entries) {
    if (!Number.isInteger(e.size) || e.size < 1 || e.size > 256) throw new Error('Icon sizes go from 1 to 256.');
    if (!PNG_SIGNATURE.every((b, i) => e.data[i] === b)) throw new Error('Icon pictures must be PNG data.');
  }
  const headerSize = 6 + 16 * entries.length;
  const total = entries.reduce((sum, e) => sum + e.data.length, headerSize);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon (2 would be cursor)
  view.setUint16(4, entries.length, true);
  let offset = headerSize;
  entries.forEach((e, i) => {
    const at = 6 + 16 * i;
    const dim = e.size === 256 ? 0 : e.size; // the format stores 256 as 0
    out[at] = dim; // width
    out[at + 1] = dim; // height
    out[at + 2] = 0; // palette colours (none)
    out[at + 3] = 0; // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, e.data.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(e.data, offset);
    offset += e.data.length;
  });
  return out;
}

export function bmpFileSize(width, height) {
  return 54 + Math.ceil((width * 3) / 4) * 4 * height;
}

// Writes a plain 24-bit BMP (works everywhere, no transparency).
// readRows(firstRow, rowCount) must give RGBA bytes for those rows.
// Reading in strips keeps memory low for big pictures.
export function encodeBmp24(width, height, readRows, rowsPerStrip = 128) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Bad BMP size.');
  }
  const rowSize = Math.ceil((width * 3) / 4) * 4; // rows are padded to 4 bytes
  const size = bmpFileSize(width, height);
  if (size > 0x7fffffff) throw new Error('This picture is too big for a BMP file.');
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true); // where the pixels start
  view.setUint32(14, 40, true); // size of the info header
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = rows are stored bottom to top
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true); // 72 dpi
  view.setInt32(42, 2835, true);
  for (let y0 = 0; y0 < height; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y0);
    const rgba = readRows(y0, rows);
    for (let r = 0; r < rows; r += 1) {
      const rowStart = 54 + (height - 1 - (y0 + r)) * rowSize;
      for (let x = 0; x < width; x += 1) {
        const from = (r * width + x) * 4;
        const to = rowStart + x * 3;
        out[to] = rgba[from + 2]; // BMP stores blue, green, red
        out[to + 1] = rgba[from + 1];
        out[to + 2] = rgba[from];
      }
    }
  }
  return out;
}
