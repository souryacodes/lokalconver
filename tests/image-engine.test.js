// Tests the control flow of the engine with a pretend canvas (no browser).
// They do not prove the pictures look right: that needs the browser checks.
import test from 'node:test';
import assert from 'node:assert/strict';

// ----- a tiny fake OffscreenCanvas -----
class FakeCanvas {
  static maxPixels = Infinity; // pretend the device refuses bigger canvases
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.fill = [0, 0, 0, 0];
  }
  getContext() {
    if (this.width * this.height > FakeCanvas.maxPixels) return null;
    const canvas = this;
    return {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '#000000',
      drawImage() {},
      fillRect() {
        const s = String(this.fillStyle);
        const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(s);
        if (rgb) canvas.fill = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), 255];
        else {
          const h = s.replace('#', '');
          canvas.fill = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(255);
        }
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i += 1) data.set(canvas.fill, i * 4);
        return { data };
      },
    };
  }
  async convertToBlob({ type, quality = 1 } = {}) {
    // Size grows with pixels and quality, like a real lossy encoder.
    const lossy = type !== 'image/png';
    const n = Math.max(16, Math.round(this.width * this.height * (lossy ? quality : 1) * 0.1));
    const bytes = new Uint8Array(n);
    if (type === 'image/png') bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new Blob([bytes], { type });
  }
}
globalThis.OffscreenCanvas = FakeCanvas;

const { convertImage } = await import('../js/converters/image-engine.js');
const { validateOptions } = await import('../js/converters/image-core.js');

const bitmap = (width, height) => ({ width, height, close() { this.closed = true; } });
const opts = (raw = {}, to = 'jpg') => validateOptions(raw, to).options;

test('converts to jpg at the same size and closes the bitmap', async () => {
  const bm = bitmap(4000, 3000);
  const r = await convertImage({ source: bm, ext: 'png', toExt: 'jpg', options: opts({ quality: 80 }) });
  assert.equal(r.blob.type, 'image/jpeg');
  assert.equal(r.info.width, 4000);
  assert.equal(r.info.height, 3000);
  assert.equal(r.info.quality, 80);
  assert.equal(bm.closed, true);
});

test('resize by max width keeps the ratio', async () => {
  const r = await convertImage({
    source: bitmap(4000, 3000), ext: 'jpg', toExt: 'png',
    options: opts({ resize: { mode: 'max', maxWidth: 1000 } }, 'png'),
  });
  assert.equal(r.blob.type, 'image/png');
  assert.deepEqual([r.info.width, r.info.height], [1000, 750]);
});

test('bmp: valid header and size', async () => {
  const r = await convertImage({ source: bitmap(40, 30), ext: 'png', toExt: 'bmp', options: opts({}, 'bmp') });
  const bytes = new Uint8Array(await r.blob.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'BM');
  assert.equal(bytes.length, 54 + 120 * 30); // 40 px * 3 = 120 bytes per row, already a multiple of 4
});

test('ico: one PNG per size, directory says so', async () => {
  const r = await convertImage({ source: bitmap(300, 100), ext: 'png', toExt: 'ico', options: opts({}, 'ico') });
  const bytes = new Uint8Array(await r.blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(view.getUint16(4, true), 6);
  const sizes = [0, 1, 2, 3, 4, 5].map((i) => bytes[6 + i * 16]);
  assert.deepEqual(sizes, [16, 32, 48, 64, 128, 0], 'small to big; 256 is stored as 0');
  assert.equal(r.blob.type, 'image/x-icon');
});

test('target size: shrinks until it fits, and says what happened', async () => {
  const r = await convertImage({
    source: bitmap(4000, 3000), ext: 'jpg', toExt: 'jpg',
    options: opts({ maxKB: 50 }), target: { maxKB: 50 },
  });
  assert.equal(r.info.fits, true);
  assert.ok(r.blob.size <= 50_000, `size ${r.blob.size}`);
  assert.ok(r.info.width < 4000, 'had to make the picture smaller');
  assert.match(r.info.message, /^Reached \d+ KB \(limit 50 KB\)\. Picture made smaller/);
  assert.ok(r.info.notes.includes(r.info.message));
});

test('target size: easy target keeps full size', async () => {
  const r = await convertImage({
    source: bitmap(200, 100), ext: 'jpg', toExt: 'webp',
    options: opts({ maxKB: 50 }, 'webp'), target: { maxKB: 50 },
  });
  assert.equal(r.info.fits, true);
  assert.deepEqual([r.info.width, r.info.height], [200, 100]);
});

test('target size: impossible target returns the smallest and an honest message', async () => {
  const r = await convertImage({
    source: bitmap(4000, 3000), ext: 'jpg', toExt: 'jpg',
    options: opts({ maxKB: 1 }), target: { maxKB: 1 },
  });
  assert.equal(r.info.fits, false);
  assert.match(r.info.message, /^Could not reach 1 KB without making it unreadable: got \d+ KB$/);
  assert.ok(r.blob.size > 1000);
  assert.ok(r.info.width >= 1000 && r.info.width < 4000, 'shrunk, but not to nothing');
});

test('target size: png is refused', async () => {
  await assert.rejects(
    convertImage({ source: bitmap(10, 10), ext: 'jpg', toExt: 'png', options: opts({}, 'png'), target: { maxKB: 5 } }),
    /jpg, webp or avif/,
  );
});

test('huge picture: steps down to a size the device can draw, and tells the user', async () => {
  FakeCanvas.maxPixels = 10_000_000; // this "phone" cannot draw more than 10 megapixels
  try {
    const r = await convertImage({ source: bitmap(8000, 6000), ext: 'jpg', toExt: 'jpg', options: opts() });
    assert.ok(r.info.width * r.info.height <= 10_000_000);
    assert.ok(r.info.width < 8000);
    assert.ok(r.info.notes.some((n) => /very big \(8000×6000\)/.test(n)));
    assert.ok(Math.abs(r.info.width / r.info.height - 4 / 3) < 0.01, 'ratio kept');
  } finally {
    FakeCanvas.maxPixels = Infinity;
  }
});

test('cancel: stops with AbortError', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    convertImage({ source: bitmap(100, 100), ext: 'png', toExt: 'jpg', options: opts(), signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('browser that quietly gives PNG instead of the asked format gets an honest error', async () => {
  const original = FakeCanvas.prototype.convertToBlob;
  FakeCanvas.prototype.convertToBlob = async function fallbackToPng() {
    return new Blob([new Uint8Array(20)], { type: 'image/png' });
  };
  try {
    await assert.rejects(
      convertImage({ source: bitmap(10, 10), ext: 'png', toExt: 'webp', options: opts({}, 'webp') }),
      /cannot save WEBP/,
    );
  } finally {
    FakeCanvas.prototype.convertToBlob = original;
  }
});
