import test from 'node:test';
import assert from 'node:assert/strict';
import { safeBaseName, outputName } from '../js/core/filename.js';
import { fileExt, checkSize, formatBytes } from '../js/core/limits.js';
import { isZip, isOleOffice } from '../js/core/sniff.js';

test('keeps normal names, swaps the extension', () => {
  assert.equal(outputName('Marksheet 2026.docx', 'md'), 'Marksheet 2026.md');
});
test('removes folders, traversal and bad characters', () => {
  assert.equal(safeBaseName('../../etc/passwd.docx'), 'passwd');
  assert.equal(safeBaseName('C:\\Users\\me\\a<b>:c|d?.docx'), 'a_b__c_d_');
  assert.equal(safeBaseName('a/b\\c.txt'), 'c');
});
test('no hidden, empty or reserved names', () => {
  assert.equal(safeBaseName('.htaccess.docx'), 'htaccess');
  assert.equal(safeBaseName('.htaccess'), 'file'); // a lone dot-name counts as an extension
  assert.equal(safeBaseName('...'), 'file');
  assert.equal(safeBaseName(''), 'file');
  assert.equal(safeBaseName(null), 'file');
  assert.equal(safeBaseName('CON.txt'), 'file');
  assert.equal(safeBaseName('nul'), 'file');
});
test('strips control and right-to-left override characters', () => {
  assert.equal(safeBaseName('inv\u202Eoice\u0000.docx'), 'invoice');
});
test('long names are cut', () => assert.ok(safeBaseName('a'.repeat(300) + '.csv').length <= 80));
test('keeps Telugu and other scripts', () => assert.equal(safeBaseName('మార్కులు.docx'), 'మార్కులు'));
test('output extension is cleaned', () => assert.equal(outputName('x.docx', '../md'), 'x.md'));
test('fileExt', () => {
  assert.equal(fileExt('A.B.DOCX'), 'docx');
  assert.equal(fileExt('noext'), '');
});
test('checkSize: empty and too big give friendly errors', () => {
  assert.throws(() => checkSize({ size: 0 }, 'csv'), { code: 'EMPTY' });
  assert.throws(() => checkSize({ size: 11 * 1048576 }, 'csv'), (e) => e.code === 'TOO_BIG' && /10 MB/.test(e.userMessage));
  assert.doesNotThrow(() => checkSize({ size: 1000 }, 'csv'));
  assert.equal(formatBytes(1536), '1.5 KB');
});
test('sniff', () => {
  assert.ok(isZip(Uint8Array.of(0x50, 0x4b, 3, 4)));
  assert.ok(!isZip(Uint8Array.of(1, 2, 3, 4)));
  assert.ok(isOleOffice(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)));
});
