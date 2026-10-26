// js/converters/pdf-utils.js
// Pure helpers for the PDF toolkit: page ranges, page-size maths, small
// string helpers. No DOM and no libraries here, so Node can test them.
// WHY a separate file: pdf.js is big and touches the browser; these
// functions must stay easy to test and easy to read.

// ---------------------------------------------------------------- errors

// An error whose message is safe and friendly to show to the visitor.
// `code` lets the UI react (for example show a "Unlock it" hint).
export class PdfError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'PdfError';
    this.code = code;
  }
}

// The two sentences you asked for, kept in one place so UI and code agree.
export const MSG_LOCKED = 'This PDF is locked. Unlock it first.';
export const MSG_NO_TEXT =
  'This PDF has no selectable text. OCR is available with the LokalConver Bridge.';

// -------------------------------------------------------------- constants

export const PT_PER_INCH = 72;
export const MM_PER_INCH = 25.4;

// Paper sizes in PDF points (1 pt = 1/72 inch), portrait.
export const PAGE_SIZES = Object.freeze({
  a4: Object.freeze([595.28, 841.89]),
  letter: Object.freeze([612, 792]),
});

// "Fit to image" turns pixels into points at this density. 150 dpi keeps a
// phone photo at a sensible paper size (a 3000 px photo becomes ~51 cm).
export const FIT_DPI = 150;

// PDF viewers stop at 14400 pt (200 inch) per side.
export const MAX_PAGE_PT = 14400;

// Biggest canvas we will ask for. 4096 x 4096 is safe on phones; bigger
// canvases fail silently on some of them.
export const MAX_CANVAS_PIXELS = 4096 * 4096;

export const MAX_MARGIN_MM = 50;

// ----------------------------------------------------------------- ranges

function pageCountOrThrow(pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PdfError('BAD_RANGE', 'This PDF has no pages to pick from.');
  }
}

function parsePageNumber(text, pageCount) {
  if (!/^\d+$/.test(text)) {
    throw new PdfError('BAD_RANGE', `"${text}" is not a page number.`);
  }
  const n = Number(text);
  if (n < 1) {
    throw new PdfError('BAD_RANGE', 'Page 0 does not exist. Pages start at 1.');
  }
  if (n > pageCount) {
    throw new PdfError(
      'BAD_RANGE',
      `Page ${n} does not exist. This PDF has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`,
    );
  }
  return n;
}

// '1-3,5,8-' -> [[1,2,3],[5],[8,9,10]] (one inner list per comma part,
// in the order typed). '8-' means "page 8 to the last page".
// Rejects: empty text, empty parts (',,'), letters, 0, '-3', '5-3',
// '1-2-3' and pages beyond the end. Never returns an empty list.
export function parseRangeGroups(text, pageCount) {
  pageCountOrThrow(pageCount);
  const clean = String(text ?? '').trim();
  if (clean === '') {
    throw new PdfError('BAD_RANGE', 'Type page numbers, like 1-3,5,8-.');
  }
  return clean.split(',').map((rawPart) => {
    const part = rawPart.replace(/\s+/g, '');
    if (part === '') {
      throw new PdfError('BAD_RANGE', 'Put page numbers between the commas, like 1-3,5.');
    }
    const pieces = part.split('-');
    if (pieces.length === 1) {
      return [parsePageNumber(pieces[0], pageCount)];
    }
    if (pieces.length > 2) {
      throw new PdfError('BAD_RANGE', `"${part}" has too many dashes. Use one, like 2-4.`);
    }
    if (pieces[0] === '') {
      throw new PdfError('BAD_RANGE', `"${part}" needs a first page. Write it as 1${part}.`);
    }
    const first = parsePageNumber(pieces[0], pageCount);
    const last = pieces[1] === '' ? pageCount : parsePageNumber(pieces[1], pageCount);
    if (last < first) {
      throw new PdfError('BAD_RANGE', `"${part}" goes backwards. Write it as ${last}-${first}.`);
    }
    const pages = [];
    for (let p = first; p <= last; p += 1) pages.push(p);
    return pages;
  });
}

// Same thing as one flat list. A page typed twice is kept once (first
// position wins), so '1-3,2' gives [1,2,3]. The typed order is kept, so
// '3,1' gives [3,1]: the output pages come out in that order.
export function parseRanges(text, pageCount) {
  const seen = new Set();
  const result = [];
  for (const group of parseRangeGroups(text, pageCount)) {
    for (const p of group) {
      if (!seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
  }
  return result;
}

// [1,2,3] -> '1-3', [5] -> '5', [1,2,4] -> '1-2,4'. Used in file names.
export function describePages(pages) {
  const parts = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  return parts.join(',');
}

// ------------------------------------------------------- page-size maths

export function mmToPt(mm) {
  return (mm * PT_PER_INCH) / MM_PER_INCH;
}

export function dpiToScale(dpi) {
  return dpi / PT_PER_INCH;
}

function checkMarginMm(marginMm) {
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > MAX_MARGIN_MM) {
    throw new PdfError('BAD_MARGIN', `Margin must be between 0 and ${MAX_MARGIN_MM} mm.`);
  }
}

// Decide the page for one image.
//   size: 'a4' | 'letter' | 'fit'
//   orientation: 'auto' | 'portrait' | 'landscape'  (ignored for 'fit')
//   imgW, imgH: image size in pixels
// Returns { width, height, margin } in points.
export function getPageSize({ size, orientation = 'auto', imgW, imgH, marginMm = 0 }) {
  if (!(imgW > 0) || !(imgH > 0)) {
    throw new PdfError('BAD_IMAGE', 'This image has no size.');
  }
  checkMarginMm(marginMm);
  const margin = mmToPt(marginMm);

  let width;
  let height;
  if (size === 'fit') {
    const k = PT_PER_INCH / FIT_DPI;
    width = imgW * k + 2 * margin;
    height = imgH * k + 2 * margin;
    const longest = Math.max(width, height);
    if (longest > MAX_PAGE_PT) {
      // Shrink the whole page so viewers can still open it.
      width *= MAX_PAGE_PT / longest;
      height *= MAX_PAGE_PT / longest;
    }
  } else {
    const base = PAGE_SIZES[size];
    if (!base) throw new PdfError('BAD_PAGE_SIZE', 'Pick A4, Letter or Fit to image.');
    const landscape =
      orientation === 'landscape' || (orientation === 'auto' && imgW > imgH);
    [width, height] = landscape ? [base[1], base[0]] : [base[0], base[1]];
  }

  // Leave room for the picture. Without this a big margin would give a
  // zero or negative drawing area.
  if (2 * margin > Math.min(width, height) * 0.8) {
    throw new PdfError('BAD_MARGIN', 'The margin is too big for this page size.');
  }
  return { width, height, margin };
}

// Where to draw the image: as large as possible inside the margins, never
// stretched, centred. PDF's origin is the bottom-left corner.
export function placeImage(imgW, imgH, pageW, pageH, margin) {
  const boxW = pageW - 2 * margin;
  const boxH = pageH - 2 * margin;
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: margin + (boxW - width) / 2,
    y: margin + (boxH - height) / 2,
    width,
    height,
  };
}

// Shrink (never enlarge) so the longest side is at most maxSide pixels.
// maxSide 0 or less means "no limit".
export function limitLongestSide(w, h, maxSide) {
  if (!(maxSide > 0)) return { width: w, height: h };
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { width: w, height: h };
  const k = maxSide / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

// Render scale for a PDF page. `wanted` is dpi/72. If the canvas would be
// bigger than maxPixels we lower the scale and say so (reduced: true), so
// the UI can be honest about it instead of failing.
export function safeRenderScale(pageW, pageH, wanted, maxPixels = MAX_CANVAS_PIXELS) {
  const pixels = pageW * wanted * (pageH * wanted);
  if (pixels <= maxPixels) return { scale: wanted, reduced: false };
  const scale = Math.sqrt(maxPixels / (pageW * pageH));
  return { scale, reduced: true };
}

// ------------------------------------------------------ target-size maths

// `curve` is a list of { quality, bytes } measured on sample pages (bytes
// grow with quality). Given a target size we pick the highest quality
// that should still fit, by straight-line interpolation.
// fits: false means even the lowest quality is too big.
export function pickQualityForTarget(curve, targetBytes) {
  if (!Array.isArray(curve) || curve.length === 0) {
    throw new PdfError('BAD_CURVE', 'No size samples to work with.');
  }
  const pts = [...curve].sort((a, b) => a.quality - b.quality);
  if (targetBytes < pts[0].bytes) return { quality: pts[0].quality, fits: false };
  const last = pts[pts.length - 1];
  if (targetBytes >= last.bytes) return { quality: last.quality, fits: true };
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (targetBytes >= a.bytes && targetBytes <= b.bytes) {
      const span = b.bytes - a.bytes;
      const t = span === 0 ? 0 : (targetBytes - a.bytes) / span;
      return { quality: a.quality + t * (b.quality - a.quality), fits: true };
    }
  }
  return { quality: last.quality, fits: true };
}

// The opposite question: how many bytes does the curve predict at this
// quality? Used to compare a guess with what we really got, so the second
// attempt at a target size can correct itself.
export function estimateBytesAtQuality(curve, quality) {
  if (!Array.isArray(curve) || curve.length === 0) {
    throw new PdfError('BAD_CURVE', 'No size samples to work with.');
  }
  const pts = [...curve].sort((a, b) => a.quality - b.quality);
  if (quality <= pts[0].quality) return pts[0].bytes;
  const last = pts[pts.length - 1];
  if (quality >= last.quality) return last.bytes;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (quality >= a.quality && quality <= b.quality) {
      const t = (quality - a.quality) / (b.quality - a.quality);
      return a.bytes + t * (b.bytes - a.bytes);
    }
  }
  return last.bytes;
}

// ----------------------------------------------------------- small helpers

// Move one item in a list and return a NEW list (the old one is not changed).
export function moveItem(list, from, to) {
  if (from < 0 || from >= list.length) return [...list];
  const target = Math.max(0, Math.min(list.length - 1, to));
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(target, 0, item);
  return copy;
}

// 'My Marksheet (final).pdf' -> 'My_Marksheet_final'. Used for names inside
// ZIP files, so no slashes or odd characters can sneak in.
export function safeBaseName(fileName, fallback = 'document') {
  // Folder drops can give 'photos/a.pdf'; keep only the last part.
  const lastPart = String(fileName ?? '').split(/[\\/]/).pop();
  const noExt = lastPart.replace(/\.[^.]*$/, '');
  const cleaned = noExt
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

// 1 of 12 -> '001'. At least 3 digits so names sort well in a ZIP.
export function padPageNumber(n, total) {
  const width = Math.max(3, String(total).length);
  return String(n).padStart(width, '0');
}

// Next rotation, always 0, 90, 180 or 270. Works with negative numbers too.
export function addRotation(current, add) {
  return (((current + add) % 360) + 360) % 360;
}
