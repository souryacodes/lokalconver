// Runs the REAL worker code with the REAL vendored libraries (no browser needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startWorker, sample, toArrayBuffer, vendorExists } from './helpers/worker-harness.js';
import { htmlToMarkdown } from '../js/converters/docx.js';
import { wrapHtmlDocument } from '../js/core/html-doc.js';

const require = createRequire(import.meta.url);
const run = startWorker();
const plain = (v) => JSON.parse(JSON.stringify(v)); // arrays from the vm have another prototype
const docx = () => toArrayBuffer(sample('sample.docx'));

test('docx -> html keeps heading, bold, table and image', async () => {
  const { ok, result } = await run('docx-html', { buffer: docx(), skipImages: false });
  assert.ok(ok);
  assert.match(result.html, /<h1>Lab Report/);
  assert.match(result.html, /<strong>bold<\/strong>/);
  assert.equal(result.tables, 1);
  assert.equal(result.images, 1);
  assert.match(result.html, /&amp; a &lt; sign/); // special characters stay escaped
});

test('docx -> txt', async () => {
  const { ok, result } = await run('docx-text', { buffer: docx() });
  assert.ok(ok);
  assert.match(result.text, /Lab Report: Ohm's Law/);
  assert.match(result.text, /Volts/);
});

const turndownInstalled = (() => { try { require.resolve('turndown'); return true; } catch { return false; } })();

test('docx -> md: heading, emphasis, list, table, images left out and counted', { skip: turndownInstalled ? false : 'turndown is a dev dependency: run npm install' }, async () => {
  const { result } = await run('docx-html', { buffer: docx(), skipImages: true });
  assert.equal(result.images, 1);
  assert.ok(!/<img[^>]+src="[^"]/.test(result.html));
  const TurndownService = require('turndown'); // Node build of the same library, DOM comes from domino
  const notes = {};
  const md = htmlToMarkdown(TurndownService, result.html, notes);
  assert.match(md, /^# Lab Report: Ohm's Law/m);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /^- +First point/m);
  assert.match(md, /\| Volts \| Amps \| Ohms \|\n\| --- \| --- \| --- \|\n\| 2 \| 0\.5 \| 4 \|/);
  assert.equal(notes.tables, 1);
  assert.ok(!md.includes('!['));
});

test('docx: a file that is not a zip gives a coded, friendly error', async () => {
  const bad = new TextEncoder().encode('this is not a docx').buffer;
  const r = await run('docx-html', { buffer: bad, skipImages: false });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_FILE');
});

test('md -> html: raw HTML and javascript: links are made harmless', async () => {
  const text = sample('sample.md').toString();
  const { result } = await run('md-html', { text });
  assert.match(result.html, /<h1>Hello<\/h1>/);
  assert.match(result.html, /<em>emphasis<\/em>/);
  assert.match(result.html, /<a href="https:\/\/example.com">link<\/a>/);
  assert.ok(!/<script/i.test(result.html), 'no live script tag');
  assert.match(result.html, /&lt;script&gt;/);
  assert.ok(!/href="javascript:/i.test(result.html));
  const page = wrapHtmlDocument({ title: 'x</title><script>', bodyHtml: result.html });
  assert.ok(!/<title>x<\/title><script>/.test(page), 'title is escaped');
  assert.match(page, /Content-Security-Policy" content="default-src 'none'/);
});

test('md: remote image becomes a link, data image is kept', async () => {
  const { result } = await run('md-html', { text: '![a](https://x.test/a.png) ![b](data:image/png;base64,AAAA)' });
  assert.ok(!/<img src="https/.test(result.html));
  assert.match(result.html, /<a href="https:\/\/x.test\/a.png">a \(image link\)<\/a>/);
  assert.match(result.html, /<img src="data:image\/png;base64,AAAA"/);
});

test('txt -> pdf: valid PDF, several pages, wraps long text', async () => {
  const text = sample('sample.txt').toString() + 'x'.repeat(400) + '\n' + 'More text here. '.repeat(900);
  const { ok, result } = await run('txt-pdf', { text, title: 'Sample' });
  assert.ok(ok);
  assert.equal(Buffer.from(result.bytes.slice(0, 5)).toString(), '%PDF-');
  assert.ok(result.pages >= 2, `pages ${result.pages}`);
  assert.equal(result.replaced, 0);
});

test('txt -> pdf: Telugu characters are counted, empty text is refused', async () => {
  const r = await run('txt-pdf', { text: 'Hello మార్కులు', title: 't' });
  assert.ok(r.ok);
  assert.ok(r.result.replaced >= 5);
  const e = await run('txt-pdf', { text: '  \n ', title: 't' });
  assert.equal(e.error.code, 'EMPTY');
});

test('xlsx -> sheets', { skip: !vendorExists('sheetjs') && 'SheetJS not vendored yet: run python tools/vendor_libs.py' }, async () => {
  const r = await run('xlsx-sheets', { buffer: toArrayBuffer(sample('sample.xlsx')) });
  assert.ok(r.ok);
  assert.deepEqual(plain(r.result.sheets.map((s) => s.name)), ['Marks', 'Second']);
  const rows = r.result.sheets[0].rows;
  assert.deepEqual(plain(rows[0]), ['roll', 'name', 'maths', 'date']);
  assert.equal(rows[1][0], '0042');            // text stays text
  assert.equal(rows[1][3], '2026-10-26');      // dates are yyyy-mm-dd
  assert.equal(rows[2][2], '85');
});

test('unknown job is refused', async () => {
  assert.equal((await run('nope', {})).error.code, 'UNSUPPORTED');
});
