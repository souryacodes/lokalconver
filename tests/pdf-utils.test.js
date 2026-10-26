// tests/pdf-utils.test.js
// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PdfError,
  PAGE_SIZES,
  FIT_DPI,
  MAX_PAGE_PT,
  MAX_CANVAS_PIXELS,
  parseRanges,
  parseRangeGroups,
  describePages,
  mmToPt,
  dpiToScale,
  getPageSize,
  placeImage,
  limitLongestSide,
  safeRenderScale,
  pickQualityForTarget,
  estimateBytesAtQuality,
  moveItem,
  safeBaseName,
  padPageNumber,
  addRotation,
} from '../js/converters/pdf-utils.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`);
const rejects = (fn) =>
  assert.throws(fn, (e) => e instanceof PdfError && e.code === 'BAD_RANGE' && e.message.length > 0);

// ---------------------------------------------------------- parseRanges

test('parseRanges: your example 1-3,5,8- on a 10 page PDF', () => {
  assert.deepEqual(parseRanges('1-3,5,8-', 10), [1, 2, 3, 5, 8, 9, 10]);
});

test('parseRanges: a single page and the page 2 to 3 case', () => {
  assert.deepEqual(parseRanges('4', 6), [4]);
  assert.deepEqual(parseRanges('2-3', 6), [2, 3]);
});

test('parseRanges: spaces are fine, typed order is kept, repeats are dropped', () => {
  assert.deepEqual(parseRanges(' 1 - 3 , 5 ', 6), [1, 2, 3, 5]);
  assert.deepEqual(parseRanges('3,1', 5), [3, 1]);
  assert.deepEqual(parseRanges('1-3,2,3-4', 5), [1, 2, 3, 4]);
});

test('parseRanges: open end and the last page', () => {
  assert.deepEqual(parseRanges('3-', 3), [3]);
  assert.deepEqual(parseRanges('1-', 1), [1]);
  assert.deepEqual(parseRanges('5-5', 5), [5]);
});

test('parseRanges: rejects nonsense', () => {
  rejects(() => parseRanges('', 10));
  rejects(() => parseRanges('   ', 10));
  rejects(() => parseRanges(undefined, 10));
  rejects(() => parseRanges('abc', 10));
  rejects(() => parseRanges('1,,3', 10)); // empty part
  rejects(() => parseRanges('1,2,', 10)); // trailing comma
  rejects(() => parseRanges(',1', 10));
  rejects(() => parseRanges('0', 10));
  rejects(() => parseRanges('0-3', 10));
  rejects(() => parseRanges('-3', 10)); // no first page
  rejects(() => parseRanges('5-3', 10)); // goes backwards
  rejects(() => parseRanges('1-2-3', 10));
  rejects(() => parseRanges('1--3', 10));
  rejects(() => parseRanges('1.5', 10));
  rejects(() => parseRanges('+2', 10));
  rejects(() => parseRanges('1e1', 10));
  rejects(() => parseRanges('1-3x', 10));
  rejects(() => parseRanges('11', 10)); // beyond the end
  rejects(() => parseRanges('9-11', 10));
  rejects(() => parseRanges('11-', 10));
  rejects(() => parseRanges('99999999999999999999', 10));
});

test('parseRanges: rejects a bad page count', () => {
  rejects(() => parseRanges('1', 0));
  rejects(() => parseRanges('1', -2));
  rejects(() => parseRanges('1', 2.5));
  rejects(() => parseRanges('1', undefined));
});

test('parseRanges: messages are plain and name the problem', () => {
  assert.throws(() => parseRanges('12', 10), /Page 12 does not exist\. This PDF has 10 pages\./);
  assert.throws(() => parseRanges('3', 1), /has 1 page\./);
  assert.throws(() => parseRanges('5-3', 10), /goes backwards\. Write it as 3-5\./);
});

test('parseRangeGroups: one list per comma part', () => {
  assert.deepEqual(parseRangeGroups('1-2,2,4-', 5), [[1, 2], [2], [4, 5]]);
});

test('describePages: file name friendly text', () => {
  assert.equal(describePages([1, 2, 3]), '1-3');
  assert.equal(describePages([5]), '5');
  assert.equal(describePages([1, 2, 4, 6, 7]), '1-2,4,6-7');
  assert.equal(describePages([3, 1]), '3,1');
  assert.equal(describePages([]), '');
});

// -------------------------------------------------------- page-size maths

test('unit conversions', () => {
  near(mmToPt(25.4), 72);
  near(mmToPt(0), 0);
  near(mmToPt(10), 28.3464566929, 1e-6);
  near(dpiToScale(72), 1);
  near(dpiToScale(150), 150 / 72);
  near(dpiToScale(300), 300 / 72);
});

test('getPageSize: A4 and Letter, portrait', () => {
  const a4 = getPageSize({ size: 'a4', imgW: 3000, imgH: 4000 });
  near(a4.width, 595.28);
  near(a4.height, 841.89);
  assert.equal(a4.margin, 0);
  const letter = getPageSize({ size: 'letter', imgW: 3000, imgH: 4000 });
  assert.deepEqual([letter.width, letter.height], [612, 792]);
});

test('getPageSize: auto orientation follows the image', () => {
  const wide = getPageSize({ size: 'a4', imgW: 4000, imgH: 3000 });
  near(wide.width, 841.89);
  near(wide.height, 595.28);
  const square = getPageSize({ size: 'a4', imgW: 1000, imgH: 1000 });
  near(square.width, 595.28); // square stays portrait
});

test('getPageSize: forced orientation wins over the image', () => {
  const land = getPageSize({ size: 'letter', orientation: 'landscape', imgW: 100, imgH: 400 });
  assert.deepEqual([land.width, land.height], [792, 612]);
  const port = getPageSize({ size: 'letter', orientation: 'portrait', imgW: 400, imgH: 100 });
  assert.deepEqual([port.width, port.height], [612, 792]);
});

test('getPageSize: fit to image uses 150 dpi plus margins', () => {
  assert.equal(FIT_DPI, 150);
  const p = getPageSize({ size: 'fit', imgW: 1500, imgH: 750, marginMm: 0 });
  near(p.width, 720); // 1500 px / 150 dpi = 10 in = 720 pt
  near(p.height, 360);
  const m = getPageSize({ size: 'fit', imgW: 1500, imgH: 750, marginMm: 25.4 });
  near(m.width, 720 + 144); // 1 inch margin on each side
  near(m.height, 360 + 144);
  near(m.margin, 72);
});

test('getPageSize: fit to image never goes beyond the PDF page limit', () => {
  const p = getPageSize({ size: 'fit', imgW: 200000, imgH: 100000 });
  near(Math.max(p.width, p.height), MAX_PAGE_PT, 1e-6);
  near(p.width / p.height, 2, 1e-9); // same shape as the image
});

test('getPageSize: rejects bad input', () => {
  assert.throws(() => getPageSize({ size: 'a5', imgW: 10, imgH: 10 }), PdfError);
  assert.throws(() => getPageSize({ size: 'a4', imgW: 0, imgH: 10 }), PdfError);
  assert.throws(() => getPageSize({ size: 'a4', imgW: 10, imgH: NaN }), PdfError);
  assert.throws(() => getPageSize({ size: 'a4', imgW: 10, imgH: 10, marginMm: -1 }), PdfError);
  assert.throws(() => getPageSize({ size: 'a4', imgW: 10, imgH: 10, marginMm: 51 }), PdfError);
  assert.throws(() => getPageSize({ size: 'a4', imgW: 10, imgH: 10, marginMm: Infinity }), PdfError);
  // 50 mm margins on a 4 x 6 inch image page leave too little room
  assert.throws(() => getPageSize({ size: 'fit', imgW: 100, imgH: 100, marginMm: 50 }), /too big/);
});

test('placeImage: fills the box, keeps the shape, stays centred', () => {
  // Tall image on A4 with no margin: height decides.
  const [pw, ph] = PAGE_SIZES.a4;
  const tall = placeImage(1000, 2000, pw, ph, 0);
  near(tall.height, ph);
  near(tall.width, ph / 2);
  near(tall.x, (pw - tall.width) / 2);
  near(tall.y, 0);

  // Wide image on A4: width decides, centred up and down.
  const wide = placeImage(2000, 1000, pw, ph, 0);
  near(wide.width, pw);
  near(wide.height, pw / 2);
  near(wide.x, 0);
  near(wide.y, (ph - wide.height) / 2);
});

test('placeImage: margins stay free on every side', () => {
  const margin = mmToPt(10);
  const [pw, ph] = PAGE_SIZES.letter;
  for (const [w, h] of [[300, 400], [400, 300], [500, 500], [10, 1000]]) {
    const b = placeImage(w, h, pw, ph, margin);
    assert.ok(b.x >= margin - 1e-9, 'left margin');
    assert.ok(b.y >= margin - 1e-9, 'bottom margin');
    assert.ok(b.x + b.width <= pw - margin + 1e-9, 'right margin');
    assert.ok(b.y + b.height <= ph - margin + 1e-9, 'top margin');
    near(b.width / b.height, w / h, 1e-9); // not stretched
  }
});

test('placeImage: fit to image fills the page inside the margins', () => {
  const size = getPageSize({ size: 'fit', imgW: 1200, imgH: 900, marginMm: 10 });
  const box = placeImage(1200, 900, size.width, size.height, size.margin);
  near(box.x, size.margin);
  near(box.y, size.margin);
  near(box.width, 1200 * (72 / 150));
  near(box.height, 900 * (72 / 150));
});

test('limitLongestSide: only shrinks', () => {
  assert.deepEqual(limitLongestSide(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(limitLongestSide(1000, 500, 2000), { width: 1000, height: 500 });
  assert.deepEqual(limitLongestSide(1000, 500, 0), { width: 1000, height: 500 });
  assert.deepEqual(limitLongestSide(10000, 1, 100), { width: 100, height: 1 });
});

test('safeRenderScale: A4 at 72, 150 and 300 dpi fits; huge pages are reduced', () => {
  const [pw, ph] = PAGE_SIZES.a4;
  for (const dpi of [72, 150, 300]) {
    const r = safeRenderScale(pw, ph, dpiToScale(dpi));
    assert.equal(r.reduced, false);
    near(r.scale, dpiToScale(dpi));
  }
  // A0 poster (about 2384 x 3370 pt) at 300 dpi is far too big.
  const big = safeRenderScale(2384, 3370, dpiToScale(300));
  assert.equal(big.reduced, true);
  assert.ok(2384 * big.scale * (3370 * big.scale) <= MAX_CANVAS_PIXELS + 1);
  assert.ok(big.scale < dpiToScale(300));
});

// -------------------------------------------------------- target size

test('pickQualityForTarget: interpolates between samples', () => {
  const curve = [
    { quality: 0.3, bytes: 100_000 },
    { quality: 0.9, bytes: 400_000 },
  ];
  const mid = pickQualityForTarget(curve, 250_000);
  assert.equal(mid.fits, true);
  near(mid.quality, 0.6, 1e-9);
});

test('pickQualityForTarget: edges', () => {
  const curve = [
    { quality: 0.9, bytes: 400_000 }, // order does not matter
    { quality: 0.3, bytes: 100_000 },
  ];
  assert.deepEqual(pickQualityForTarget(curve, 50_000), { quality: 0.3, fits: false });
  assert.deepEqual(pickQualityForTarget(curve, 9_000_000), { quality: 0.9, fits: true });
  assert.deepEqual(pickQualityForTarget(curve, 100_000), { quality: 0.3, fits: true });
  assert.throws(() => pickQualityForTarget([], 10), PdfError);
});

test('estimateBytesAtQuality: inverse of pickQualityForTarget', () => {
  const curve = [
    { quality: 0.3, bytes: 100_000 },
    { quality: 0.9, bytes: 400_000 },
  ];
  near(estimateBytesAtQuality(curve, 0.6), 250_000);
  assert.equal(estimateBytesAtQuality(curve, 0.1), 100_000);
  assert.equal(estimateBytesAtQuality(curve, 1), 400_000);
  const target = 180_000;
  const { quality } = pickQualityForTarget(curve, target);
  near(estimateBytesAtQuality(curve, quality), target, 1e-6);
  assert.throws(() => estimateBytesAtQuality([], 0.5), PdfError);
});

// -------------------------------------------------------- small helpers

test('moveItem: returns a new list and clamps', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(list, 1, 99), ['a', 'c', 'd', 'b']);
  assert.deepEqual(moveItem(list, 1, -5), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveItem(list, 9, 0), list); // bad index: no change
  assert.deepEqual(list, ['a', 'b', 'c', 'd']); // original untouched
});

test('safeBaseName: no slashes, no odd characters, never empty', () => {
  assert.equal(safeBaseName('My Marksheet (final).pdf'), 'My_Marksheet_final');
  assert.equal(safeBaseName('../../etc/passwd.pdf'), 'passwd');
  assert.equal(safeBaseName('a/b\\c.pdf'), 'c');
  assert.equal(safeBaseName('.pdf'), 'document');
  assert.equal(safeBaseName(''), 'document');
  assert.equal(safeBaseName(undefined), 'document');
  assert.equal(safeBaseName('మార్కుల జాబితా.pdf').length > 0, true);
  assert.ok(safeBaseName('x'.repeat(300) + '.pdf').length <= 60);
});

test('padPageNumber: at least three digits', () => {
  assert.equal(padPageNumber(1, 5), '001');
  assert.equal(padPageNumber(12, 150), '012');
  assert.equal(padPageNumber(7, 1200), '0007');
});

test('addRotation: wraps around', () => {
  assert.equal(addRotation(0, 90), 90);
  assert.equal(addRotation(270, 90), 0);
  assert.equal(addRotation(90, 270), 0);
  assert.equal(addRotation(180, 180), 0);
  assert.equal(addRotation(0, -90), 270);
  assert.equal(addRotation(450, 90), 180);
});
