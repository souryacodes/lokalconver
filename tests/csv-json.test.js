import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHeaders, rowsToObjects, jsonToRows, csvJsonConverter } from '../js/converters/csv-json.js';
import { parseCsvSync } from '../js/core/csv.js';

test('headers: empty and duplicate names are fixed', () => {
  assert.deepEqual(cleanHeaders(['a', '', 'a', ' a ']), ['a', 'column_2', 'a_1', 'a_2']);
});
test('csv rows -> objects keeps text by default (leading zeros survive)', () => {
  assert.deepEqual(rowsToObjects([['roll', 'n'], ['0042', '7']]), [{ roll: '0042', n: '7' }]);
});
test('typed mode converts only safe plain numbers and booleans', () => {
  const [o] = rowsToObjects([['a', 'b', 'c', 'd', 'e'], ['12', '3.5', '0042', 'true', '1e5']], { typed: true });
  assert.deepEqual(o, { a: 12, b: 3.5, c: '0042', d: true, e: '1e5' });
});
test('ragged rows are padded; extra cells get column names', () => {
  assert.deepEqual(rowsToObjects([['a'], ['1', '2'], []]), [{ a: '1', column_2: '2' }, { a: '', column_2: '' }]);
});
test('json objects -> rows with the union of keys, nested values as JSON text', () => {
  const { rows, warnings } = jsonToRows([{ a: 1, b: { x: 1 } }, { a: null, c: true }]);
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '{"x":1}', ''], ['', '', 'true']]);
  assert.equal(warnings.length, 1);
});
test('json arrays of arrays, plain values, wrapped list, single object', () => {
  assert.deepEqual(jsonToRows([[1, 2], [3]]).rows, [['1', '2'], ['3']]);
  assert.deepEqual(jsonToRows([1, 'x']).rows, [['value'], ['1'], ['x']]);
  assert.deepEqual(jsonToRows({ students: [{ n: 'a' }] }).rows, [['n'], ['a']]);
  assert.deepEqual(jsonToRows({ n: 'a', m: 'b' }).rows, [['n', 'm'], ['a', 'b']]);
});
test('json shape errors are friendly', () => {
  assert.throws(() => jsonToRows(5), { code: 'BAD_JSON_SHAPE' });
  assert.throws(() => jsonToRows([]), { code: 'BAD_JSON_SHAPE' });
  assert.throws(() => jsonToRows([{ a: 1 }, 2]), { code: 'BAD_JSON_SHAPE' });
});

const run = async (name, content, fromExt, toExt, options) => {
  const file = new File([content], name);
  const job = { file, fromExt, toExt, options };
  const blob = await csvJsonConverter.run(job);
  return { text: await blob.text(), job };
};

test('end to end: csv -> json -> csv gives the same table', async () => {
  const csv = 'roll,name,note\r\n0042,"Rao, Sourya","said ""hi""\r\nand left"\r\n0043,Anil,\r\n';
  const { text: json, job } = await run('s.csv', csv, 'csv', 'json');
  assert.equal(JSON.parse(json)[0].name, 'Rao, Sourya');
  assert.match(job.preview, /roll/);
  const { text: back } = await run('s.json', json, 'json', 'csv', { bom: false });
  assert.deepEqual(parseCsvSync(back), parseCsvSync(csv));
});
test('invalid JSON: friendly message with a line, never the content', async () => {
  await assert.rejects(run('x.json', '[\n{"a": SECRET}\n]', 'json', 'csv'), (e) => e.code === 'BAD_JSON' && !/SECRET/.test(e.userMessage));
});
test('Windows-1252 csv is read with a warning', async () => {
  const bytes = Uint8Array.of(...Buffer.from('name\n'), 0x63, 0x61, 0x66, 0xe9, 0x0a); // "café" in 1252
  const { text, job } = await run('w.csv', bytes, 'csv', 'json');
  assert.match(text, /café/);
  assert.equal(job.warnings.length, 1);
});
test('empty and too-big files are refused', async () => {
  await assert.rejects(run('e.csv', '', 'csv', 'json'), { code: 'EMPTY' });
  await assert.rejects(csvJsonConverter.run({ file: { size: 99 * 1048576, name: 'b.csv' }, fromExt: 'csv', toExt: 'json' }), { code: 'TOO_BIG' });
});
