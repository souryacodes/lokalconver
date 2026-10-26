// Tests for the pure parts of the Convert page (no browser needed).
// Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from '../js/vendor/fflate-0.8.3.js';
import {
  formatBytes, describeChange, revealText, extOf, replaceExt, dirOf, isHiddenName, safeZipPath, uniquePaths,
  sniffType, resolveType, categoryOf, typeLabel, optionFields, describeEngine, normalizeSuggestion, pickPrimary,
} from '../js/ui/format.js';
import { raceAbort, friendlyError, runPool } from '../js/ui/jobs.js';
import { buildZip, shouldDeflate } from '../js/ui/zip.js';

const bytes = (...n) => Uint8Array.from(n);
const text = (s) => new TextEncoder().encode(s);

test('formatBytes reads like the brief', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(640), '640 B');
  assert.equal(formatBytes(31 * 1024), '31 KB');
  assert.equal(formatBytes(12.4 * 1024 * 1024), '12.4 MB');
  assert.equal(formatBytes(12 * 1024 * 1024), '12 MB');
  assert.equal(formatBytes(1.1 * 1024 * 1024), '1.1 MB');
});

test('revealText matches the example: 12.4 MB to 1.1 MB, saved 91%', () => {
  assert.equal(revealText(12.4 * 1024 * 1024, 1.1 * 1024 * 1024), '12.4 MB to 1.1 MB, saved 91%');
});

test('a file that got bigger is never called "saved"', () => {
  assert.deepEqual(describeChange(1000, 2500), { kind: 'grew', percent: 150 });
  assert.match(revealText(1000, 2500), /150% larger/);
  assert.deepEqual(describeChange(1000, 1000), { kind: 'same', percent: 0 });
  assert.deepEqual(describeChange(0, 10), { kind: 'same', percent: 0 });
});

test('names: extensions, aliases and replacing', () => {
  assert.equal(extOf('Photo.JPEG'), 'jpg');
  assert.equal(extOf('.gitignore'), '');
  assert.equal(extOf('archive.tar.gz'), 'gz');
  assert.equal(extOf('noext'), '');
  assert.equal(replaceExt('trip/a.heic', 'jpg'), 'trip/a.jpg');
  assert.equal(replaceExt('a.b.png', 'webp'), 'a.b.webp');
  assert.equal(dirOf('trip/day1/a.png'), 'trip/day1');
  assert.equal(dirOf('a.png'), '');
  assert.ok(isHiddenName('.DS_Store') && isHiddenName('Thumbs.db') && !isHiddenName('a.png'));
});

test('zip paths are safe and unique', () => {
  assert.equal(safeZipPath('../../etc/passwd'), 'etc/passwd');
  assert.equal(safeZipPath('/abs/a:b?.png'), 'abs/a_b_.png');
  assert.equal(safeZipPath('..'), 'file');
  assert.deepEqual(uniquePaths(['a.jpg', 'A.JPG', 'b.jpg', 'a.jpg']), ['a.jpg', 'A (2).JPG', 'b.jpg', 'a (3).jpg']);
  assert.deepEqual(uniquePaths(['dir/a', 'dir/a']), ['dir/a', 'dir/a (2)']);
});

test('sniffType recognises common files by their first bytes', () => {
  assert.equal(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), 'jpg');
  assert.equal(sniffType(text('GIF89a....')), 'gif');
  assert.equal(sniffType(text('%PDF-1.7')), 'pdf');
  assert.equal(sniffType(text('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
  assert.equal(sniffType(text('RIFF\0\0\0\0WAVEfmt ')), 'wav');
  assert.equal(sniffType(text('\0\0\0\x18ftypheic\0\0\0\0')), 'heic');
  assert.equal(sniffType(text('\0\0\0\x18ftypmif1\0\0\0\0heicmif1')), 'heif');
  assert.equal(sniffType(text('\0\0\0\x18ftypmif1\0\0\0\0avifmif1')), 'avif');
  assert.equal(sniffType(text('\0\0\0\x18ftypisom\0\0\0\0')), 'mp4');
  assert.equal(sniffType(text('\0\0\0\x14ftypqt  \0\0\0\0')), 'mov');
  assert.equal(sniffType(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d)), 'webm');
  assert.equal(sniffType(text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(sniffType(text('PK\u0003\u0004rest')), 'zip');
  assert.equal(sniffType(text('ID3\u0004\0\0')), 'mp3');
});

test('sniffType does not guess wrong on plain text', () => {
  assert.equal(sniffType(text('BMW is a car maker, nothing to see.')), null);
  assert.equal(sniffType(text('<html><body><svg></svg></body></html>')), null); // inline svg in a web page
  assert.equal(sniffType(text('name,age\nAda,36\n')), null);
  assert.equal(sniffType(bytes(1, 2)), null);
});

test('resolveType trusts the bytes and flags a wrong name', () => {
  assert.deepEqual(resolveType('png', 'jpg'), { ext: 'png', mismatch: true });
  assert.deepEqual(resolveType('png', 'png'), { ext: 'png', mismatch: false });
  assert.deepEqual(resolveType('heic', 'heif'), { ext: 'heif', mismatch: false });
  assert.deepEqual(resolveType('zip', 'docx'), { ext: 'docx', mismatch: false });
  assert.deepEqual(resolveType(null, 'csv'), { ext: 'csv', mismatch: false });
  assert.deepEqual(resolveType('mp4', ''), { ext: 'mp4', mismatch: false });
});

test('type labels and option fields', () => {
  assert.equal(typeLabel('heic'), 'HEIC image');
  assert.equal(typeLabel('docx'), 'Word document');
  assert.equal(typeLabel(''), 'Unknown type');
  assert.equal(categoryOf('mp3'), 'audio');
  assert.deepEqual(optionFields('png', 'jpg'), { quality: true, resize: true, size: true });
  assert.deepEqual(optionFields('png', 'png'), { quality: false, resize: true, size: false });
  assert.deepEqual(optionFields('pdf', 'png'), { quality: false, resize: false, size: false });
});

test('engine text is said before converting', () => {
  assert.deepEqual(describeEngine('js', 31), { tier: 1, text: 'Uses a 31 KB library' });
  assert.deepEqual(describeEngine('wasm', 12 * 1024), { tier: 2, text: 'Downloads an engine, 12 MB, once' });
  assert.equal(describeEngine('native', 0).tier, 0);
  assert.equal(describeEngine('bridge', 0).tier, 3);
  assert.equal(describeEngine('nope', 0), null);
});

test('normalizeSuggestion accepts every shape', () => {
  assert.deepEqual(normalizeSuggestion('JPG'), { primary: 'jpg', others: [] });
  assert.deepEqual(normalizeSuggestion(['jpg', 'png', 'jpg']), { primary: 'jpg', others: ['png'] });
  assert.deepEqual(normalizeSuggestion({ target: '.webp', alternatives: ['png'] }), { primary: 'webp', others: ['png'] });
  assert.equal(normalizeSuggestion(null), null);
  assert.equal(normalizeSuggestion({}), null);
});

test('exactly one primary button owner', () => {
  assert.equal(pickPrimary({ count: 0, pending: 0, busy: 0, done: 0 }), 'choose');
  assert.equal(pickPrimary({ count: 3, pending: 3, busy: 0, done: 0 }), 'convert-all');
  assert.equal(pickPrimary({ count: 3, pending: 1, busy: 1, done: 1 }), 'convert-all');
  assert.equal(pickPrimary({ count: 3, pending: 0, busy: 0, done: 3 }), 'zip');
});

test('raceAbort rejects at once, even if the work ignores the signal', async () => {
  const controller = new AbortController();
  const never = new Promise(() => {});
  const racing = raceAbort(never, controller.signal);
  controller.abort();
  await assert.rejects(racing, { name: 'AbortError' });
  await assert.rejects(raceAbort(never, controller.signal), { name: 'AbortError' });
  assert.equal(await raceAbort(Promise.resolve(7), new AbortController().signal), 7);
});

test('friendlyError hides stack traces', () => {
  assert.equal(friendlyError(new Error('The file is empty.')), 'The file is empty.');
  assert.match(friendlyError(new Error('boom\n   at x (a.js:1:1)')), /Something went wrong/);
  assert.match(friendlyError(null), /Something went wrong/);
});

test('runPool: one failure does not stop the others', async () => {
  const seen = [];
  await runPool([1, 2, 3, 4], 2, async (n) => { if (n === 2) throw new Error('bad'); seen.push(n); });
  assert.deepEqual(seen.sort(), [1, 3, 4]);
});

test('shouldDeflate only for small text-like files', () => {
  assert.ok(shouldDeflate('a.csv', 1000));
  assert.ok(!shouldDeflate('a.jpg', 1000));
  assert.ok(!shouldDeflate('big.json', 9 * 1024 * 1024));
});

test('buildZip makes a real ZIP with unicode names, folders and exact bytes', async () => {
  const jpg = new Blob([Uint8Array.from({ length: 5000 }, (_, i) => i % 251)], { type: 'image/jpeg' });
  const csv = new Blob(['a,b\n1,2\n'.repeat(100)], { type: 'text/csv' });
  const progress = [];
  const zip = await buildZip(
    [{ path: 'trip/photo \u00e9.jpg', blob: jpg }, { path: 'data.csv', blob: csv }],
    { onProgress: (p) => progress.push(p) },
  );
  assert.equal(zip.type, 'application/zip');
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['data.csv', 'trip/photo \u00e9.jpg']);
  assert.deepEqual(files['trip/photo \u00e9.jpg'], new Uint8Array(await jpg.arrayBuffer()));
  assert.equal(strFromU8(files['data.csv']), 'a,b\n1,2\n'.repeat(100));
  assert.deepEqual(progress, [0.5, 1]);
});
