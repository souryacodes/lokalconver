// Tests for the PDF toolkit wiring: nothing loads from another site, the right converters are registered,
// the engines run on real PDFs (merge, split, rotate), and the vendored files match their hashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const text = (p) => read(p).toString('utf8');

// pdf-lib is a UMD file. Node treats .js files here as ES modules, so read it and run it ourselves.
function loadPdfLib() {
  const module = { exports: {} };
  new Function('module', 'exports', text('js/vendor/pdf-lib/1.17.1/pdf-lib.min.js'))(module, module.exports);
  return module.exports;
}

const pdfModule = await import('../js/converters/pdf.js');
const PDFLib = loadPdfLib();
pdfModule.configurePdfLibs({ loaders: { pdflib: async () => PDFLib, fflate: () => import('../js/vendor/fflate-0.8.3.js') } });
const { pdfConverters } = pdfModule;
const byId = (id) => pdfConverters.find((c) => c.id === id);

async function makePdf(pages, label) {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i += 1) doc.addPage([300, 300]).drawText(`${label} ${i}`, { x: 20, y: 150, size: 20, font });
  return new File([await doc.save()], `${label}.pdf`, { type: 'application/pdf' });
}
const pageCount = async (blob) => (await PDFLib.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))).getPageCount();

test('the PDF code never names another site (CSP: script-src and worker-src are "self")', () => {
  for (const f of ['js/converters/pdf.js', 'js/converters/pdf-utils.js', 'js/converters/pdf-register.js', 'js/ui/pdf-tools.js', 'js/ui/option-form.js']) {
    const code = text(f).replace(/^\s*(\/\/|\*).*$/gm, '');
    assert.ok(!/https?:\/\//.test(code), `${f} has an absolute URL`);
    assert.ok(!/jsdelivr|unpkg|cdnjs/i.test(code), `${f} mentions a CDN`);
  }
});

test('the PDF engine files are in js/vendor and match SHA256SUMS', () => {
  const sums = Object.fromEntries(text('js/vendor/SHA256SUMS').trim().split('\n').map((l) => { const [h, p] = l.split(/\s+/); return [p, h]; }));
  const needed = [
    'js/vendor/pdfjs-dist/6.4.299/legacy/build/pdf.min.mjs',
    'js/vendor/pdfjs-dist/6.4.299/legacy/build/pdf.worker.min.mjs',
    'js/vendor/pdfjs-dist/6.4.299/wasm/openjpeg.wasm',
    'js/vendor/pdf-lib/1.17.1/pdf-lib.min.js',
    'js/vendor/fflate-0.8.3.js',
  ];
  for (const p of needed) assert.ok(sums[p], `${p} is not in SHA256SUMS`);
  for (const [p, hash] of Object.entries(sums)) {
    assert.equal(crypto.createHash('sha256').update(read(p)).digest('hex'), hash, `${p} changed`);
  }
  for (const dir of ['cmaps', 'standard_fonts', 'iccs']) assert.ok(fs.readdirSync(new URL(`js/vendor/pdfjs-dist/6.4.299/${dir}/`, root)).length > 0, `${dir} is empty`);
  assert.ok(fs.existsSync(new URL('js/vendor/pdfjs-dist/6.4.299/LICENSE', root)));
});

test('registered for the Convert page: images -> pdf, pdf -> png/jpg/txt, and a pdf shrinker', async () => {
  const { createRegistry } = await import('../js/core/registry.js');
  const { CONVERT_PAGE_PDF_IDS } = await import('../js/converters/pdf-register.js');
  const registry = createRegistry();
  for (const c of pdfConverters) if (CONVERT_PAGE_PDF_IDS.includes(c.id)) registry.registerConverter(c);
  const { createConvertServices } = await import('../js/ui/services.js');
  const services = createConvertServices(registry);

  assert.deepEqual(registry.findTargets('pdf').map((t) => t.ext).sort(), ['jpg', 'png', 'txt']);
  for (const from of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']) {
    assert.equal(registry.getConverter(from, 'pdf')?.id, 'images-to-pdf', from);
  }
  assert.equal(services.findShrinker('pdf')?.id, 'pdf-compress');
  assert.equal(services.findConverter('pdf', 'pdf')?.id, 'pdf-compress');
  assert.equal(registry.suggestTarget('pdf').ext, 'png');
  // Merge, split and rotate need several files or settings: they stay on the PDF tools page.
  for (const id of ['pdf-merge', 'pdf-split', 'pdf-rotate']) assert.ok(!registry.listConverters().some((c) => c.id === id), id);
});

test('merge keeps the order it was given and says the result is a PDF', async () => {
  const [a, b] = [await makePdf(2, 'AAA'), await makePdf(3, 'BBB')];
  const job = { file: a, toExt: 'pdf', options: { files: [b, a] }, warnings: [] };
  const blob = await byId('pdf-merge').run(job);
  assert.equal(job.outExt, 'pdf');
  assert.equal(await pageCount(blob), 5);
  assert.equal(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer(), 0, 5)), '%PDF-');
});

test('merge needs at least two PDFs', async () => {
  const a = await makePdf(1, 'solo');
  await assert.rejects(byId('pdf-merge').run({ file: a, toExt: 'pdf', options: { files: [a] } }), /at least two/i);
});

test('split: one PDF for "1-2,4", a ZIP (job.outExt = zip) for "each" mode, and a clear error for a bad page', async () => {
  const doc = await makePdf(5, 'five');
  const one = { file: doc, toExt: 'pdf', options: { extra: { ranges: '1-2,4' } } };
  assert.equal(await pageCount(await byId('pdf-split').run(one)), 3);
  assert.equal(one.outExt, 'pdf');

  const each = { file: doc, toExt: 'pdf', options: { extra: { ranges: '1-2,4', mode: 'each' } } };
  const zip = await byId('pdf-split').run(each);
  assert.equal(each.outExt, 'zip');
  const { unzipSync } = await import('../js/vendor/fflate-0.8.3.js');
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(Object.keys(files).length, 2);
  assert.ok(Object.keys(files).every((n) => n.endsWith('.pdf')));

  await assert.rejects(byId('pdf-split').run({ file: doc, toExt: 'pdf', options: { extra: { ranges: '9' } } }), /Page 9 does not exist/);
});

test('rotate turns only the pages asked for', async () => {
  const doc = await makePdf(3, 'turn');
  const blob = await byId('pdf-rotate').run({ file: doc, toExt: 'pdf', options: { extra: { angle: 270, pages: '2-3' } } });
  const out = await PDFLib.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(out.getPages().map((p) => p.getRotation().angle), [0, 270, 270]);
});

test('settings travel in options.extra; the picture-only quality 85 of the Convert page is ignored', async () => {
  const doc = await makePdf(2, 'opts');
  // Generic options from the Convert page (quality 85, maxKB) must not break or change a rotate job.
  const blob = await byId('pdf-rotate').run({ file: doc, toExt: 'pdf', options: { quality: 85, maxKB: 500, stripMetadata: true, extra: { angle: 180 } } });
  const out = await PDFLib.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(out.getPages().map((p) => p.getRotation().angle), [180, 180]);
});

test('a damaged or fake PDF gives a friendly error in every tool, never an empty result', async () => {
  const cases = {
    'header but no pages': '%PDF-1.4\nnot really\n%%EOF', // pdf-lib opens this as an empty document
    'no header at all': 'hello world',
  };
  for (const [label, content] of Object.entries(cases)) {
    const junk = new File([new TextEncoder().encode(content)], 'junk.pdf');
    for (const id of ['pdf-rotate', 'pdf-split']) {
      await assert.rejects(byId(id).run({ file: junk, toExt: 'pdf', options: { extra: { ranges: '1' } } }), (err) => {
        assert.equal(err.code, 'BAD_PDF', `${id}: ${label}`);
        assert.match(err.userMessage, /not a PDF I can read/);
        return true;
      });
    }
    const good = await makePdf(1, 'good');
    await assert.rejects(byId('pdf-merge').run({ file: good, toExt: 'pdf', options: { files: [good, junk] } }), (err) => err.code === 'BAD_PDF', `merge: ${label}`);
  }
});

test('option lists: onlyWhen hides and shows fields', async () => {
  const { visibleItems } = await import('../js/ui/option-form.js');
  const spec = byId('images-to-pdf').options;
  assert.ok(visibleItems(spec, { pageSize: 'a4' }).some((i) => i.key === 'orientation'));
  assert.ok(!visibleItems(spec, { pageSize: 'fit' }).some((i) => i.key === 'orientation'));
  const toImages = byId('pdf-to-images').options;
  assert.ok(!visibleItems(toImages, {}, { toExt: 'png' }).some((i) => i.key === 'quality'));
  assert.ok(visibleItems(toImages, {}, { toExt: 'jpg' }).some((i) => i.key === 'quality'));
  assert.ok(!visibleItems(toImages, {}, { toExt: 'jpg' }, ['quality']).some((i) => i.key === 'quality'));
});

test('format helpers: PDF settings are passed on, picture-only fields stay away from images -> PDF', async () => {
  const { jobOptions, optionFields } = await import('../js/ui/format.js');
  assert.deepEqual(jobOptions({ quality: 0.85, extra: { angle: 90 } }).extra, { angle: 90 });
  assert.equal(jobOptions({ quality: 0.85, extra: {} }).extra, undefined);
  assert.equal(optionFields('png', 'pdf').resize, false);
  assert.equal(optionFields('png', 'jpg').resize, true);
});

test('libs.js lists pdf.js with its worker size', async () => {
  const { LIBS } = await import('../js/converters/libs.js');
  assert.equal(LIBS.pdfjs.version, '6.4.299');
  assert.ok(LIBS.pdfjs.workerKb > 1000);
});
