// Pure helpers for the Convert page. No DOM in this file, so `node --test`
// can run them. Keep it that way: anything that touches the page goes elsewhere.

// ---------- sizes and savings ----------

const UNITS = ['B', 'KB', 'MB', 'GB'];

// 12.4 MB, 1.1 MB, 31 KB, 640 B. One decimal for small numbers, none for big.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  if (i === 0) return `${Math.round(value)} B`;
  const wide = value >= 100 || (i === 1 && value >= 10);
  const text = wide ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${UNITS[i]}`;
}

// What happened to the size. A file that got bigger is said plainly:
// we never call that "saved".
export function describeChange(bytesIn, bytesOut) {
  if (!(bytesIn > 0) || !(bytesOut >= 0)) return { kind: 'same', percent: 0 };
  if (bytesOut < bytesIn) {
    const percent = Math.round((1 - bytesOut / bytesIn) * 100);
    return percent === 0 ? { kind: 'same', percent: 0 } : { kind: 'saved', percent };
  }
  const percent = Math.round((bytesOut / bytesIn - 1) * 100);
  return percent === 0 ? { kind: 'same', percent: 0 } : { kind: 'grew', percent };
}

export function changeLabel(kind, percent) {
  if (kind === 'saved') return `saved ${percent}%`;
  if (kind === 'grew') return `${percent}% larger`;
  return 'about the same size';
}

// '12.4 MB to 1.1 MB, saved 91%'
export function revealText(bytesIn, bytesOut) {
  const { kind, percent } = describeChange(bytesIn, bytesOut);
  return `${formatBytes(bytesIn)} to ${formatBytes(bytesOut)}, ${changeLabel(kind, percent)}`;
}

// ---------- names and paths ----------

const ALIASES = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', markdown: 'md', oga: 'ogg' };

export function extOf(name) {
  const base = String(name).split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return ''; // '.gitignore' has no extension
  const ext = base.slice(dot + 1).toLowerCase();
  return ALIASES[ext] ?? ext;
}

export function replaceExt(path, newExt) {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${dir}${stem}.${newExt}`;
}

export function dirOf(path) {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

export function isHiddenName(name) {
  const n = String(name).toLowerCase();
  return n.startsWith('.') || n === 'thumbs.db' || n === 'desktop.ini';
}

// A path that is safe to write inside a ZIP: no '..', no leading slash,
// no characters Windows dislikes.
export function safeZipPath(path) {
  const parts = String(path)
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

function withSuffix(path, n) {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash + 1 ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
}

// Two files can end up with the same output name (a.png and a.bmp -> a.jpg).
// Add " (2)", " (3)" so nothing is overwritten. Case-insensitive on purpose.
export function uniquePaths(paths) {
  const seen = new Set();
  return paths.map((p) => {
    let candidate = p;
    let n = 1;
    while (seen.has(candidate.toLowerCase())) candidate = withSuffix(p, ++n);
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

// ---------- detecting the real type from the first bytes ----------

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const SVG_START =
  /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)*<svg[\s>]/i;

// Returns an extension like 'png', or null when we cannot tell from the bytes
// (plain text types such as csv, md and txt are told apart by name only).
export function sniffType(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  const four = ascii(b, 0, 4);
  if (four === 'GIF8') return 'gif';
  if (four === '%PDF') return 'pdf';
  if (four === 'OggS') return 'ogg';
  if (four === 'fLaC') return 'flac';
  if (four === 'PK\u0003\u0004') return 'zip'; // docx, xlsx, pptx are zips: the name decides
  if (four === 'RIFF' && b.length >= 12) {
    const kind = ascii(b, 8, 12);
    if (kind === 'WEBP') return 'webp';
    if (kind === 'WAVE') return 'wav';
    return null;
  }
  if (four === '\u001aE\u00df\u00a3') return ascii(b, 4, Math.min(b.length, 64)).includes('webm') ? 'webm' : 'mkv';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && ((b[1] >> 1) & 3) === 1 && ((b[1] >> 3) & 3) !== 1) return 'mp3';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && (b[4] | (b[5] << 8)) > 0) return 'ico';
  if (b.length >= 18 && b[0] === 0x42 && b[1] === 0x4d && b[6] === 0 && b[7] === 0 && b[8] === 0 && b[9] === 0 &&
      [12, 40, 52, 56, 64, 108, 124].includes(b[14]) && b[15] === 0 && b[16] === 0 && b[17] === 0) return 'bmp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    const brands = ascii(b, 8, Math.min(b.length, 64));
    if (HEIC_BRANDS.has(brand)) return 'heic';
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heif') return brands.includes('avif') ? 'avif' : 'heif';
    if (brand === 'qt  ') return 'mov';
    if (brand === 'M4A ' || brand === 'M4B ') return 'm4a';
    return 'mp4';
  }
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 2048)));
  if (SVG_START.test(text)) return 'svg';
  return null;
}

const FAMILIES = [['heic', 'heif'], ['mp4', 'mov', 'm4a', 'm4v'], ['webm', 'mkv'], ['ogg', 'oga', 'opus']];
const sameFamily = (a, b) => a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b));

// Combine "what the bytes say" with "what the name says".
// When they disagree, trust the bytes and flag it, so the user is not surprised.
export function resolveType(sniffed, ext) {
  if (!sniffed) return { ext, mismatch: false };
  if (sniffed === 'zip') return { ext: ext || 'zip', mismatch: false };
  if (!ext || sameFamily(sniffed, ext)) return { ext: ext || sniffed, mismatch: false };
  return { ext: sniffed, mismatch: true };
}

// ---------- what kind of file is it ----------

const CATEGORY = {
  image: ['png', 'jpg', 'webp', 'gif', 'bmp', 'svg', 'heic', 'heif', 'avif', 'ico'],
  pdf: ['pdf'],
  document: ['docx', 'doc', 'pptx', 'odt', 'md', 'html', 'txt'],
  data: ['csv', 'json', 'xlsx'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
  video: ['mp4', 'mov', 'webm', 'mkv'],
};
const SPECIAL_LABEL = { docx: 'Word document', pptx: 'PowerPoint deck', xlsx: 'Excel spreadsheet', md: 'Markdown text', txt: 'Text file', html: 'HTML page' };
const NOUN = { image: 'image', audio: 'audio', video: 'video', pdf: 'document', data: 'data', document: 'document', file: 'file' };

export function categoryOf(ext) {
  for (const [name, list] of Object.entries(CATEGORY)) if (list.includes(ext)) return name;
  return 'file';
}
export const isImageExt = (ext) => CATEGORY.image.includes(ext);

export function typeLabel(ext) {
  if (!ext) return 'Unknown type';
  return SPECIAL_LABEL[ext] ?? `${ext.toUpperCase()} ${NOUN[categoryOf(ext)]}`;
}

// Which option fields make sense for this conversion.
export function optionFields(fromExt, toExt) {
  const fromImage = isImageExt(fromExt);
  return {
    quality: fromImage && ['jpg', 'webp', 'avif'].includes(toExt),
    resize: fromImage,
    size: fromImage && ['jpg', 'webp'].includes(toExt),
  };
}

// ---------- what the engine will cost, said before converting ----------

export function describeEngine(engine, downloadKB) {
  const kb = Number(downloadKB) || 0;
  switch (engine) {
    case 'native': return { tier: 0, text: 'Built into your browser. Nothing to download.' };
    case 'js': return { tier: 1, text: kb > 0 ? `Uses a ${formatBytes(kb * 1024)} library` : 'Uses a small library' };
    case 'wasm': return { tier: 2, text: kb > 0 ? `Downloads an engine, ${formatBytes(kb * 1024)}, once` : 'Downloads an engine, once' };
    case 'bridge': return { tier: 3, text: 'Needs the Bridge app on this computer' };
    default: return null;
  }
}

export const TIER_HINT = [
  'Tier 0: native browser features',
  'Tier 1: a small JavaScript library',
  'Tier 2: a WebAssembly engine',
  'Tier 3: the local Bridge app',
];

// suggestTarget() may answer with a string, an array or an object.
// Turn every shape into { primary, others } so the rest of the code stays simple.
export function normalizeSuggestion(raw) {
  if (!raw) return null;
  let list;
  if (typeof raw === 'string') list = [raw];
  else if (Array.isArray(raw)) list = raw;
  else {
    const first = raw.target ?? raw.primary ?? raw.to ?? raw.best;
    const rest = raw.alternatives ?? raw.others ?? raw.rest ?? raw.chips ?? [];
    list = [first, ...rest];
  }
  const clean = [...new Set(list.filter((x) => typeof x === 'string' && x).map((x) => x.toLowerCase().replace(/^\./, '')))];
  return clean.length ? { primary: clean[0], others: clean.slice(1) } : null;
}

// Which gradient button owns the screen right now. Exactly one at a time.
export function pickPrimary({ count, pending, busy, done }) {
  if (count === 0) return 'choose';
  if (busy > 0 || pending > 0) return 'convert-all';
  if (done > 0) return 'zip';
  return 'none';
}

// The card keeps quality as 0..1 (easy for a slider). The converters want a
// whole number from 1 to 100, and no empty fields. This turns one into the other.
export function jobOptions(options) {
  const out = { stripMetadata: options.stripMetadata !== false };
  const q = Number(options.quality);
  if (Number.isFinite(q)) out.quality = Math.min(100, Math.max(1, Math.round(q <= 1 ? q * 100 : q)));
  if (options.maxWidth) out.maxWidth = options.maxWidth;
  if (options.maxKB) out.maxKB = options.maxKB;
  return out;
}

// A result that grew is not a bug, but it should not be a surprise either.
// Returns one short, true sentence, or '' when there is nothing to explain.
export function growNote(fromExt, toExt, bytesIn, bytesOut) {
  if (!(bytesOut > bytesIn)) return '';
  if (fromExt === 'svg') return 'A vector picture becomes pixels, so the file can be larger.';
  if (['png', 'bmp', 'ico'].includes(toExt)) return `${toExt.toUpperCase()} keeps every pixel exact, so it is often larger. JPG or WEBP are smaller.`;
  // The quality advice only makes sense for pictures. A Markdown file that becomes
  // an HTML page, or text that becomes a PDF, is simply bigger and needs no tip.
  if (isImageExt(fromExt) && isImageExt(toExt)) return 'This file is larger than the original. Try a lower quality next time.';
  return '';
}
