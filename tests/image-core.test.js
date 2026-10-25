// Tests for the pure parts of the image converter. Run: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ICO_SIZES, LIMITS, TARGET,
  bestQualityForTarget, bmpFileSize, buildIco, canvasSizeCandidates, clampToLimits,
  computeOutputSize, containSize, encodeBmp24, extOf, halvingPlan, inferInputExt,
  kbToBytes, looksLikeHeif, normalizeExt, parseLength, parseSvgSize, scaleSize,
  shrinkScales, svgRasterSize, targetMessage, validateOptions,
} from '../js/converters/image-core.js';

// A pretend encoder: the file gets bigger as quality goes up.
function fakeEncoder(bytesAtFullQuality) {
  const calls = [];
  const encode = async (q) => {
    calls.push(q);
    return { size: Math.round(q * bytesAtFullQuality), q };
  };
  encode.calls = calls;
  return encode;
}

// ---------- bestQualityForTarget ----------

test('bestQualityForTarget: fits at the top quality in one try', async () => {
  const enc = fakeEncoder(10_000);
  const r = await bestQualityForTarget(enc, 50_000);
  assert.equal(r.fits, true);
  assert.equal(r.tries, 1);
  assert.equal(r.quality, TARGET.maxQuality);
});

test('bestQualityForTarget: finds a quality that fits, close to the limit', async () => {
  const enc = fakeEncoder(100_000); // size = quality * 100 000
  const r = await bestQualityForTarget(enc, 50_000);
  assert.equal(r.fits, true);
  assert.ok(r.bytes <= 50_000, `bytes ${r.bytes}`);
  assert.ok(r.bytes >= 47_000, `should use most of the room, got ${r.bytes}`);
  assert.ok(r.tries <= 8, `tries ${r.tries}`);
  assert.equal(enc.calls.length, r.tries);
});

test('bestQualityForTarget: never makes more than maxTries encodes', async () => {
  const enc = fakeEncoder(1_000_000);
  const r = await bestQualityForTarget(enc, 640_000, { maxTries: 5 });
  assert.ok(r.tries <= 5);
  assert.ok(enc.calls.length <= 5);
});

test('bestQualityForTarget: impossible target returns the smallest result, fits=false', async () => {
  const enc = fakeEncoder(1_000_000);
  const r = await bestQualityForTarget(enc, 1_000);
  assert.equal(r.fits, false);
  assert.equal(r.quality, TARGET.minQuality);
  assert.equal(r.tries, 2, 'gives up early: top and bottom only');
  assert.equal(r.bytes, Math.round(TARGET.minQuality * 1_000_000));
});

test('bestQualityForTarget: picks the highest quality that fits (step-shaped encoder)', async () => {
  // Everything up to 0.70 fits, anything above does not.
  const enc = async (q) => ({ size: q <= 0.7 ? 900 : 1100 });
  const r = await bestQualityForTarget(enc, 1000);
  assert.equal(r.fits, true);
  assert.ok(r.quality <= 0.7 && r.quality >= 0.66, `quality ${r.quality}`);
});

test('bestQualityForTarget: stops when cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    bestQualityForTarget(fakeEncoder(1000), 500, { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('bestQualityForTarget: rejects bad input', async () => {
  await assert.rejects(bestQualityForTarget(null, 100), TypeError);
  await assert.rejects(bestQualityForTarget(fakeEncoder(1), 0), RangeError);
  await assert.rejects(bestQualityForTarget(fakeEncoder(1), 100, { maxTries: 0 }), RangeError);
  await assert.rejects(bestQualityForTarget(async () => ({}), 100), /no result/);
});

// ---------- size maths ----------

test('computeOutputSize: none, max width, max height, both, percent', () => {
  assert.deepEqual(computeOutputSize(4000, 3000, { mode: 'none' }), { width: 4000, height: 3000 });
  assert.deepEqual(computeOutputSize(4000, 3000, { mode: 'max', maxWidth: 1000 }), { width: 1000, height: 750 });
  assert.deepEqual(computeOutputSize(4000, 3000, { mode: 'max', maxHeight: 600 }), { width: 800, height: 600 });
  assert.deepEqual(
    computeOutputSize(4000, 3000, { mode: 'max', maxWidth: 1000, maxHeight: 300 }),
    { width: 400, height: 300 },
    'the tighter limit wins',
  );
  assert.deepEqual(computeOutputSize(4000, 3000, { mode: 'percent', percent: 25 }), { width: 1000, height: 750 });
});

test('computeOutputSize: "max" never enlarges a photo, but vectors may be enlarged', () => {
  assert.deepEqual(computeOutputSize(500, 400, { mode: 'max', maxWidth: 2000 }), { width: 500, height: 400 });
  assert.deepEqual(computeOutputSize(500, 400, { mode: 'max', maxWidth: 2000 }, true), { width: 2000, height: 1600 });
});

test('scaleSize never returns 0', () => {
  assert.deepEqual(scaleSize(10, 1000, 0.01), { width: 1, height: 10 });
});

test('clampToLimits keeps big pictures inside the canvas limits', () => {
  const r = clampToLimits(20000, 10000);
  assert.ok(r.width <= LIMITS.maxSide && r.height <= LIMITS.maxSide);
  assert.ok(r.width * r.height <= LIMITS.maxPixels);
  assert.deepEqual(clampToLimits(4000, 3000), { width: 4000, height: 3000 });
  const ratioBefore = 20000 / 10000;
  assert.ok(Math.abs(r.width / r.height - ratioBefore) < 0.01);
});

test('canvasSizeCandidates: first is within limits, then strictly smaller, ends small', () => {
  const list = canvasSizeCandidates(12000, 9000);
  assert.ok(list[0].width * list[0].height <= LIMITS.maxPixels);
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i].width < list[i - 1].width, 'each step is smaller');
  }
  const last = list[list.length - 1];
  assert.ok(Math.max(last.width, last.height) < LIMITS.minSide / LIMITS.shrinkFactor + 1);
});

test('halvingPlan: steps of at most half, ends exactly at the target', () => {
  assert.deepEqual(halvingPlan(8000, 6000, 1000, 750), [
    { width: 4000, height: 3000 },
    { width: 2000, height: 1500 },
    { width: 1000, height: 750 },
  ]);
  assert.deepEqual(halvingPlan(1000, 800, 1000, 800), [{ width: 1000, height: 800 }], 'same size: one draw');
  assert.deepEqual(halvingPlan(100, 100, 300, 300), [{ width: 300, height: 300 }], 'enlarging: one draw');
  const plan = halvingPlan(9000, 7000, 700, 544);
  assert.deepEqual(plan[plan.length - 1], { width: 700, height: 544 });
});

test('halvingPlan: a source bigger than a canvas is halved first', () => {
  const plan = halvingPlan(20000, 10000, 20000, 10000, 64_000_000);
  assert.ok(plan.length >= 1);
  assert.ok(plan[0].width * plan[0].height <= 64_000_000 || plan.length === 1);
});

test('containSize fits inside a square', () => {
  assert.deepEqual(containSize(400, 200, 256), { width: 256, height: 128 });
  assert.deepEqual(containSize(100, 400, 64), { width: 16, height: 64 });
});

test('kbToBytes counts 1 KB as 1000 bytes (safe for both KB styles)', () => {
  assert.equal(kbToBytes(50), 50_000);
  assert.equal(kbToBytes(0.5), 500);
});

test('shrinkScales: 10 percent steps, stops before it gets unreadable', () => {
  const s = shrinkScales(4000, 3000);
  assert.equal(s[0], 1);
  assert.equal(s[1], 0.9);
  assert.equal(s[2], 0.81);
  const last = s[s.length - 1];
  assert.ok(last >= TARGET.minScale);
  assert.ok(4000 * last >= TARGET.minLongSide);
  assert.deepEqual(shrinkScales(300, 200), [1], 'a small picture is never shrunk');
  const smallish = shrinkScales(800, 600);
  assert.ok(800 * smallish[smallish.length - 1] >= TARGET.minLongSide);
});

test('targetMessage: honest wording', () => {
  assert.equal(
    targetMessage({ fits: false, maxKB: 20, bytes: 25_600 }),
    'Could not reach 20 KB without making it unreadable: got 26 KB',
  );
  assert.equal(
    targetMessage({ fits: true, maxKB: 50, bytes: 47_100, width: 800, height: 600, fromWidth: 800, fromHeight: 600 }),
    'Reached 48 KB (limit 50 KB)',
  );
  assert.match(
    targetMessage({ fits: true, maxKB: 50, bytes: 40_000, width: 600, height: 450, fromWidth: 800, fromHeight: 600 }),
    /Picture made smaller: 800×600 to 600×450/,
  );
  assert.match(targetMessage({ fits: false, maxKB: 20, bytes: 20_400 }), /got 21 KB/, 'rounds up, never understates');
});

// ---------- file type helpers ----------

test('extension helpers', () => {
  assert.equal(normalizeExt('.JPEG'), 'jpg');
  assert.equal(normalizeExt('jfif'), 'jpg');
  assert.equal(normalizeExt('HEIF'), 'heic');
  assert.equal(extOf('My Photo.IMG_0001.HEIC'), 'heic');
  assert.equal(extOf('noextension'), '');
  assert.equal(inferInputExt({ name: 'a.jpeg', type: '' }), 'jpg');
  assert.equal(inferInputExt({ name: 'download', type: 'image/webp' }), 'webp');
  assert.equal(inferInputExt({ name: 'x.bin', type: 'image/heif' }), 'heic');
});

test('looksLikeHeif reads the ftyp brand', () => {
  const make = (brand) => Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftyp'), ...Buffer.from(brand), 0, 0, 0, 0]);
  assert.equal(looksLikeHeif(make('heic')), true);
  assert.equal(looksLikeHeif(make('mif1')), true);
  assert.equal(looksLikeHeif(make('isom')), false);
  assert.equal(looksLikeHeif(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  assert.equal(looksLikeHeif(new Uint8Array(4)), false);
});

// ---------- options ----------

test('validateOptions: defaults', () => {
  const r = validateOptions({}, 'jpg');
  assert.equal(r.ok, true);
  assert.equal(r.options.quality, 85);
  assert.equal(r.options.background, '#ffffff');
  assert.deepEqual(r.options.resize, { mode: 'none' });
  assert.deepEqual(r.options.icoSizes, ICO_SIZES);
  assert.equal(r.options.maxKB, null);
});

test('validateOptions: quality', () => {
  assert.equal(validateOptions({ quality: 0 }).ok, false);
  assert.equal(validateOptions({ quality: 101 }).ok, false);
  assert.equal(validateOptions({ quality: 'abc' }).ok, false);
  assert.equal(validateOptions({ quality: '70' }).options.quality, 70);
});

test('validateOptions: resize', () => {
  assert.deepEqual(validateOptions({ resize: { mode: 'max', maxWidth: '800' } }).options.resize, {
    mode: 'max', maxWidth: 800, maxHeight: undefined,
  });
  assert.equal(validateOptions({ resize: { mode: 'max' } }).ok, false, 'needs at least one limit');
  assert.equal(validateOptions({ resize: { mode: 'max', maxWidth: -5 } }).ok, false);
  assert.equal(validateOptions({ resize: { mode: 'percent', percent: 0 } }).ok, false);
  assert.equal(validateOptions({ resize: { mode: 'percent', percent: 500 } }).ok, false);
  assert.equal(validateOptions({ resize: { mode: 'percent', percent: 50 } }).options.resize.percent, 50);
  assert.equal(validateOptions({ resize: { mode: 'weird' } }).ok, false);
  // presets use flat fields
  assert.equal(validateOptions({ maxWidth: 1200 }).options.resize.maxWidth, 1200);
});

test('validateOptions: background colour', () => {
  assert.equal(validateOptions({ background: '#FFF' }).options.background, '#ffffff');
  assert.equal(validateOptions({ background: '#1A2b3C' }).options.background, '#1a2b3c');
  assert.equal(validateOptions({ background: 'red' }).ok, false);
  assert.equal(validateOptions({ background: '#12' }).ok, false);
});

test('validateOptions: target size only for formats that have quality', () => {
  assert.equal(validateOptions({ maxKB: 50 }, 'jpg').options.maxKB, 50);
  assert.equal(validateOptions({ maxKB: 50 }, 'webp').ok, true);
  assert.equal(validateOptions({ maxKB: 50 }, 'png').ok, false);
  assert.equal(validateOptions({ maxKB: 0 }, 'jpg').ok, false);
  assert.equal(validateOptions({ maxKB: 'x' }, 'jpg').ok, false);
});

test('validateOptions: icon sizes and metadata', () => {
  assert.deepEqual(validateOptions({ icoSizes: [64, 16, 16] }, 'ico').options.icoSizes, [16, 64]);
  assert.equal(validateOptions({ icoSizes: [20] }, 'ico').ok, false);
  assert.equal(validateOptions({ icoSizes: [] }, 'ico').ok, false);
  assert.equal(validateOptions({ stripMetadata: false }).options.stripMetadata, true, 'always on');
});

// ---------- SVG ----------

test('parseLength and parseSvgSize', () => {
  assert.equal(parseLength('24'), 24);
  assert.equal(parseLength('24px'), 24);
  assert.equal(parseLength('1in'), 96);
  assert.equal(parseLength('50%'), null);
  assert.equal(parseLength('abc'), null);
  assert.deepEqual(parseSvgSize({ width: '100', height: '50' }), { width: 100, height: 50 });
  assert.deepEqual(parseSvgSize({ viewBox: '0 0 200 100' }), { width: 200, height: 100 });
  assert.deepEqual(parseSvgSize({ width: '400', viewBox: '0 0 200 100' }), { width: 400, height: 200 });
  assert.deepEqual(parseSvgSize({ width: '100%', height: '100%', viewBox: '0 0 10 10' }), { width: 10, height: 10 });
  assert.equal(parseSvgSize({}), null);
  assert.equal(parseSvgSize({ viewBox: '0 0 0 0' }), null);
});

test('svgRasterSize: small vectors are drawn big, "max" may enlarge', () => {
  assert.deepEqual(svgRasterSize({ width: 24, height: 24 }), { width: 1024, height: 1024 });
  assert.deepEqual(svgRasterSize({ width: 2000, height: 1000 }), { width: 2000, height: 1000 });
  assert.deepEqual(svgRasterSize({ width: 24, height: 24 }, { mode: 'max', maxWidth: 2048 }), { width: 2048, height: 2048 });
  assert.deepEqual(svgRasterSize({ width: 24, height: 24 }, { mode: 'percent', percent: 50 }), { width: 512, height: 512 });
});

// ---------- ICO ----------

function fakePng(extraBytes) {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(extraBytes).fill(7)]);
}

test('buildIco: header and directory bytes are exactly right', () => {
  const a = fakePng(10); // 18 bytes
  const b = fakePng(30); // 38 bytes
  const ico = buildIco([{ size: 16, data: a }, { size: 256, data: b }]);

  // ICONDIR: reserved 0, type 1, count 2
  assert.deepEqual([...ico.slice(0, 6)], [0, 0, 1, 0, 2, 0]);
  // entry 0: 16x16, no palette, planes 1, 32 bits, size 18, offset 6+32=38
  assert.deepEqual([...ico.slice(6, 22)], [16, 16, 0, 0, 1, 0, 32, 0, 18, 0, 0, 0, 38, 0, 0, 0]);
  // entry 1: 256 is stored as 0, size 38, offset 38+18=56
  assert.deepEqual([...ico.slice(22, 38)], [0, 0, 0, 0, 1, 0, 32, 0, 38, 0, 0, 0, 56, 0, 0, 0]);
  assert.equal(ico.length, 38 + 18 + 38);
  assert.deepEqual([...ico.slice(38, 56)], [...a]);
  assert.deepEqual([...ico.slice(56)], [...b]);
});

test('buildIco: rejects things that are not PNG or sizes that do not exist', () => {
  assert.throws(() => buildIco([]), /at least one/);
  assert.throws(() => buildIco([{ size: 16, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) }]), /PNG/);
  assert.throws(() => buildIco([{ size: 512, data: fakePng(1) }]), /1 to 256/);
});

// ---------- BMP ----------

test('encodeBmp24: header, bottom-up rows, BGR order and row padding', () => {
  // 2 x 2 picture. Top row: red, green. Bottom row: blue, white.
  const rgba = Uint8ClampedArray.from([
    255, 0, 0, 255, /**/ 0, 255, 0, 255,
    0, 0, 255, 255, /**/ 255, 255, 255, 255,
  ]);
  // Ask for one row at a time, to test that strips are joined correctly.
  const bmp = encodeBmp24(2, 2, (y0, rows) => rgba.slice(y0 * 8, (y0 + rows) * 8), 1);
  const view = new DataView(bmp.buffer);

  assert.equal(String.fromCharCode(bmp[0], bmp[1]), 'BM');
  assert.equal(bmp.length, 54 + 8 * 2); // each row: 6 pixel bytes + 2 padding = 8
  assert.equal(bmp.length, bmpFileSize(2, 2));
  assert.equal(view.getUint32(2, true), bmp.length);
  assert.equal(view.getUint32(10, true), 54);
  assert.equal(view.getUint32(14, true), 40);
  assert.equal(view.getInt32(18, true), 2);
  assert.equal(view.getInt32(22, true), 2);
  assert.equal(view.getUint16(26, true), 1);
  assert.equal(view.getUint16(28, true), 24);
  assert.equal(view.getUint32(30, true), 0, 'no compression');

  // First stored row is the BOTTOM row: blue then white, as B,G,R
  assert.deepEqual([...bmp.slice(54, 60)], [255, 0, 0, 255, 255, 255]);
  assert.deepEqual([...bmp.slice(60, 62)], [0, 0], 'padding is zero');
  // Second stored row is the TOP row: red then green
  assert.deepEqual([...bmp.slice(62, 68)], [0, 0, 255, 0, 255, 0]);
});

test('encodeBmp24: rejects a bad size', () => {
  assert.throws(() => encodeBmp24(0, 5, () => []), /Bad BMP size/);
  assert.throws(() => encodeBmp24(1.5, 5, () => []), /Bad BMP size/);
});
