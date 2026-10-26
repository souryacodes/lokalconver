import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvSync, parseCsv, toCsv, detectDelimiter, previewText } from '../js/core/csv.js';

test('plain rows, CRLF and LF', () => {
  assert.deepEqual(parseCsvSync('a,b\r\n1,2\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});
test('quoted comma, quoted quote, quoted new line', () => {
  assert.deepEqual(parseCsvSync('"x, y","say ""hi""","l1\nl2"\n'), [['x, y', 'say "hi"', 'l1\nl2']]);
});
test('empty fields, trailing comma, blank lines skipped', () => {
  assert.deepEqual(parseCsvSync('a,,c\n\n1,2,\n'), [['a', '', 'c'], ['1', '2', '']]);
});
test('quoted empty string is a real empty field, not a blank line', () => {
  assert.deepEqual(parseCsvSync('""\n'), [['']]);
});
test('BOM is removed', () => {
  assert.deepEqual(parseCsvSync('\uFEFFa,b\n1,2'), [['a', 'b'], ['1', '2']]);
});
test('last row without a final new line', () => {
  assert.deepEqual(parseCsvSync('a\nb'), [['a'], ['b']]);
});
test('a quote in the middle of an unquoted field is kept', () => {
  assert.deepEqual(parseCsvSync('5" pipe,x'), [['5" pipe', 'x']]);
});
test('unterminated quote gives a friendly error with the line', () => {
  assert.throws(() => parseCsvSync('a,b\n1,"oops\n2,3'), (e) => e.code === 'BAD_CSV' && /line 2/.test(e.userMessage));
});
test('delimiter detection: semicolon, tab, default comma', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('single'), ',');
  assert.equal(detectDelimiter('"a;b",c\n1,2'), ',');
});
test('toCsv quotes only when needed and round-trips', () => {
  const rows = [['a', 'b c'], ['x,y', 'q"q'], ['l1\nl2', ' pad']];
  const csv = toCsv(rows, { bom: false });
  assert.equal(csv, 'a,b c\r\n"x,y","q""q"\r\n"l1\nl2"," pad"\r\n');
  assert.deepEqual(parseCsvSync(csv), rows);
});
test('toCsv adds a BOM by default', () => assert.ok(toCsv([['a']]).startsWith('\uFEFF')));
test('async parser gives the same result and can be cancelled', async () => {
  const text = Array.from({ length: 12000 }, (_, i) => `${i},x`).join('\n');
  assert.equal((await parseCsv(text, { sliceRows: 1000 })).rows.length, 12000);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(parseCsv(text, { signal: ac.signal, sliceRows: 1000 }), { name: 'AbortError' });
});
test('previewText shows 10 rows as plain text and counts the rest', () => {
  const rows = Array.from({ length: 25 }, (_, i) => [`r${i}`, '<b>x</b>']);
  const t = previewText(rows);
  assert.equal(t.split('\n').length, 11);
  assert.match(t, /… 15 more rows/);
  assert.match(t, /<b>x<\/b>/); // kept as text, the UI must use textContent
});
