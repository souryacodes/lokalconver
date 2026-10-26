// Classic Web Worker. Runs the heavy libraries off the page so the page never freezes.
// Why classic and not a module worker: the libraries are UMD files that need importScripts().
// Nothing here uses the network except loading same-origin files from vendor/. File content stays in memory.
'use strict';

let LIBS = {};
const loaded = {};

const LABEL = { mammoth: 'Word', marked: 'Markdown', pdflib: 'PDF', sheetjs: 'spreadsheet' };
const GLOBAL = { mammoth: 'mammoth', marked: 'marked', pdflib: 'PDFLib', sheetjs: 'XLSX' };

function fail(code, message) { const e = new Error(message); e.lcCode = code; return e; }

function need(key) {
  if (loaded[key]) return self[GLOBAL[key]];
  const url = LIBS[key];
  if (!url || new URL(url).origin !== self.location.origin) throw fail('LIB_MISSING', 'This engine is not set up.');
  try { importScripts(url); } catch (e) {
    throw fail('LIB_MISSING', `The ${LABEL[key]} engine is not installed in this copy of the site. Run tools/vendor_libs.py, then reload.`);
  }
  loaded[key] = true;
  return self[GLOBAL[key]];
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- docx ----
async function docxToHtml({ buffer, skipImages }) {
  const mammoth = need('mammoth');
  let images = 0;
  const options = skipImages
    ? { convertImage: mammoth.images.imgElement(() => { images++; return Promise.resolve({ src: '' }); }) }
    : {};
  let r;
  try { r = await mammoth.convertToHtml({ arrayBuffer: buffer }, options); }
  catch { throw fail('BAD_FILE', 'This Word file could not be read. It may be damaged, password-protected, or not a real .docx.'); }
  if (!skipImages) images = (r.value.match(/<img\b/g) || []).length;
  return {
    html: r.value,
    images,
    tables: (r.value.match(/<table\b/g) || []).length,
    simplified: r.messages.filter((m) => m.type === 'warning').length,
  };
}

async function docxToText({ buffer }) {
  const mammoth = need('mammoth');
  try { return { text: (await mammoth.extractRawText({ arrayBuffer: buffer })).value }; }
  catch { throw fail('BAD_FILE', 'This Word file could not be read. It may be damaged, password-protected, or not a real .docx.'); }
}

// ---- markdown ----
// Raw HTML inside the Markdown is shown as text, links keep only safe schemes, remote images become links.
function safeUrl(href) {
  const h = String(href).replace(/[\u0000-\u0020]/g, '');
  return /^[a-z][a-z0-9+.\-]*:/i.test(h) ? /^(https?|mailto):/i.test(h) : true;
}
function mdToHtml({ text }) {
  const { Marked } = need('marked');
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      html({ text: raw }) { return esc(raw); },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!safeUrl(href)) return inner;
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}>${inner}</a>`;
      },
      image({ href, title, text: alt }) {
        if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(href)) {
          return `<img src="${href}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''}>`;
        }
        return safeUrl(href) ? `<a href="${esc(href)}">${esc(alt || 'image')} (image link)</a>` : esc(alt || '');
      },
    },
  });
  return { html: m.parse(text, { async: false }) };
}

// ---- txt -> pdf ----
const PAGE = { w: 595.28, h: 841.89, margin: 56, size: 11, lead: 15 };
const MAX_PAGES = 2000;

async function txtToPdf({ text, title }) {
  const { PDFDocument, StandardFonts, rgb } = need('pdflib');
  const doc = await PDFDocument.create();
  doc.setTitle(title || 'Document'); doc.setProducer('LokalConver'); doc.setCreator('LokalConver');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const known = new Set(font.getCharacterSet());

  let replaced = 0;
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/[\s\S]/gu, (ch) => {
      if (ch === '\n' || known.has(ch.codePointAt(0))) return ch;
      replaced++; return '?';
    });
  if (!clean.trim()) throw fail('EMPTY', 'This text file has no text in it.');

  const maxW = PAGE.w - PAGE.margin * 2;
  const width = (s) => font.widthOfTextAtSize(s, PAGE.size);
  const lines = [];
  for (const para of clean.split('\n')) {
    if (para === '') { lines.push(''); continue; }
    let cur = '';
    for (const word of para.split(' ')) {
      const tryLine = cur === '' ? word : `${cur} ${word}`;
      if (width(tryLine) <= maxW) { cur = tryLine; continue; }
      if (cur !== '') { lines.push(cur); cur = ''; }
      let w = word;
      while (width(w) > maxW) {            // a single word wider than the page: break it by letters
        let k = w.length;
        while (k > 1 && width(w.slice(0, k)) > maxW) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    }
    lines.push(cur);
  }

  const perPage = Math.floor((PAGE.h - PAGE.margin * 2) / PAGE.lead);
  const pages = Math.ceil(lines.length / perPage);
  if (pages > MAX_PAGES) throw fail('TOO_BIG', `This text would make ${pages} pages. The limit is ${MAX_PAGES}. Split the file first.`);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    lines.slice(p * perPage, (p + 1) * perPage).forEach((ln, i) => {
      if (ln) page.drawText(ln, { x: PAGE.margin, y: PAGE.h - PAGE.margin - PAGE.size - i * PAGE.lead, size: PAGE.size, font, color: rgb(0.06, 0.07, 0.15) });
    });
  }
  const bytes = await doc.save();
  return { bytes, pages, replaced };
}

// ---- xlsx ----
const MAX_CELLS = 2000000;

async function xlsxSheets({ buffer }) {
  const X = need('sheetjs');
  let wb;
  try { wb = X.read(new Uint8Array(buffer), { type: 'array' }); }
  catch { throw fail('BAD_FILE', 'This Excel file could not be read. It may be damaged or password-protected.'); }
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (ws['!ref']) {
      const r = X.utils.decode_range(ws['!ref']);
      if ((r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1) > MAX_CELLS) {
        throw fail('TOO_BIG', `The sheet "${name}" covers more than ${MAX_CELLS.toLocaleString('en')} cells. Remove empty rows and columns in Excel first.`);
      }
    }
    // Text as shown in Excel; dates as yyyy-mm-dd so the order is never confused.
    const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'yyyy-mm-dd' });
    return { name, rows };
  });
  return { sheets };
}

// ---- plumbing ----
const OPS = { 'docx-html': docxToHtml, 'docx-text': docxToText, 'md-html': mdToHtml, 'txt-pdf': txtToPdf, 'xlsx-sheets': xlsxSheets };

self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  if (op === 'init') { LIBS = payload.libs; return; }
  try {
    const fn = OPS[op];
    if (!fn) throw fail('UNSUPPORTED', 'Unknown job.');
    const result = await fn(payload);
    const transfer = result && result.bytes ? [result.bytes.buffer] : [];
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    // Only our own coded messages go back. Raw library errors could quote file content, so they never do.
    const known = err && err.lcCode;
    if (!known && self.__LC_DEBUG) console.error(err);
    self.postMessage({
      id, ok: false,
      error: { code: known || 'WORKER_FAILED', message: known ? err.message : 'Something went wrong while converting this file.' },
    });
  }
};
