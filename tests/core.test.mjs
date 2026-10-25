// Tests for js/core/. Run with: node --test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { detectType, detectFile, extOf, normalizeExt } from '../js/core/detect.js';
import { createRegistry, ensureLoaded } from '../js/core/registry.js';
import {
  ConvertError,
  createJobQueue,
  defaultConcurrency,
  friendlyError,
} from '../js/core/jobs.js';
import {
  MemoryLimitError,
  createMemoryGuard,
  createObjectUrlManager,
  formatBytes,
  safeFileName,
} from '../js/core/safe.js';
import { createHandler } from '../js/core/worker.js';
import { createWorkerClient } from '../js/core/workerClient.js';

// ------------------------------------------------------------ helpers

/** bytes('GIF89a', [1, 2], 0x10) -> Uint8Array. Strings are ASCII. */
function bytes(...parts) {
  const out = [];
  for (const part of parts) {
    if (typeof part === 'string') for (const ch of part) out.push(ch.charCodeAt(0));
    else if (Array.isArray(part)) out.push(...part);
    else out.push(part);
  }
  return Uint8Array.from(out);
}
const zeros = (n) => new Array(n).fill(0);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tiny but real zip: local headers, and optionally the central directory. */
function makeZip(names, { centralDirectory = true } = {}) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    offset += local.length;
  }
  const parts = [...locals];
  if (centralDirectory) {
    const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, names.length, true);
    ev.setUint16(10, names.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    parts.push(...centrals, end);
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const PNG = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, zeros(8));

// ------------------------------------------------------------ detect

describe('detectType: magic numbers', () => {
  const cases = [
    ['png', 'image', PNG],
    ['jpg', 'image', bytes(0xff, 0xd8, 0xff, 0xe0, zeros(10))],
    ['gif', 'image', bytes('GIF89a', zeros(10))],
    ['webp', 'image', bytes('RIFF', [0x24, 0, 0, 0], 'WEBP', 'VP8 ')],
    ['wav', 'audio', bytes('RIFF', [0x24, 0, 0, 0], 'WAVE', 'fmt ')],
    ['bmp', 'image', bytes('BM', zeros(12), [40, 0, 0, 0], zeros(20))],
    ['ico', 'image', bytes([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0])],
    ['pdf', 'pdf', bytes('%PDF-1.7\n%')],
    ['mp3', 'audio', bytes('ID3', [3, 0, 0, 0, 0, 0, 0], zeros(8))],
    ['mp3', 'audio', bytes(0xff, 0xfb, 0x90, 0x00, zeros(8))],
    ['ogg', 'audio', bytes('OggS', zeros(8))],
    ['flac', 'audio', bytes('fLaC', zeros(8))],
    ['mp4', 'video', bytes([0, 0, 0, 0x18], 'ftyp', 'isom', [0, 0, 2, 0], 'isom', 'mp41')],
    ['mov', 'video', bytes([0, 0, 0, 0x14], 'ftyp', 'qt  ', [0, 0, 0, 0], 'qt  ')],
    ['m4a', 'audio', bytes([0, 0, 0, 0x18], 'ftyp', 'M4A ', [0, 0, 0, 0], 'M4A ', 'mp42')],
    ['heic', 'image', bytes([0, 0, 0, 0x18], 'ftyp', 'heic', [0, 0, 0, 0], 'mif1', 'heic')],
    ['heic', 'image', bytes([0, 0, 0, 0x18], 'ftyp', 'mif1', [0, 0, 0, 0], 'mif1', 'heic')],
    ['heif', 'image', bytes([0, 0, 0, 0x14], 'ftyp', 'mif1', [0, 0, 0, 0], 'mif1')],
    ['avif', 'image', bytes([0, 0, 0, 0x14], 'ftyp', 'avif', [0, 0, 0, 0], 'avif')],
    ['webm', 'video', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0x82, 0x84], 'webm')],
    ['mkv', 'video', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0x82, 0x88], 'matroska')],
  ];
  for (const [ext, kind, data] of cases) {
    test(`${ext} (${kind})`, () => {
      const result = detectType(data, `file.${ext}`);
      assert.equal(result.ext, ext);
      assert.equal(result.kind, kind);
      assert.equal(result.mismatch, null);
      assert.match(result.mime, /\//);
    });
  }

  test('accepts an ArrayBuffer and a plain number array', () => {
    assert.equal(detectType(PNG.buffer.slice(0), 'a.png').ext, 'png');
    assert.equal(detectType([0xff, 0xd8, 0xff, 0xe0], 'a.jpg').ext, 'jpg');
  });

  test('PDF may have a few junk bytes before the header', () => {
    assert.equal(detectType(bytes('junk\n', '%PDF-1.4'), 'a.pdf').ext, 'pdf');
  });

  test('"BM" text is not a bitmap', () => {
    assert.equal(detectType(bytes('BMW is a car brand. '), 'a.txt').ext, 'txt');
  });
});

describe('detectType: zip, docx, xlsx, pptx', () => {
  test('reads the file names inside (central directory)', () => {
    const docx = makeZip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const result = detectType(docx, 'cv.docx');
    assert.equal(result.ext, 'docx');
    assert.equal(result.kind, 'doc');
    assert.equal(result.mismatch, null);
    assert.equal(detectType(makeZip(['[Content_Types].xml', 'xl/workbook.xml']), 'a.xlsx').ext, 'xlsx');
    assert.equal(detectType(makeZip(['[Content_Types].xml', 'ppt/presentation.xml']), 'a.pptx').ext, 'pptx');
    assert.equal(detectType(makeZip(['xl/workbook.xml']), 'a.xlsx').kind, 'data');
  });

  test('reads the file names inside (only the start of the file)', () => {
    const head = makeZip(['[Content_Types].xml', 'word/document.xml'], { centralDirectory: false });
    assert.equal(detectType(head, 'cv.docx').ext, 'docx');
  });

  test('a plain zip stays a zip', () => {
    const result = detectType(makeZip(['notes.txt', 'photos/a.jpg']), 'bundle.zip');
    assert.equal(result.ext, 'zip');
    assert.equal(result.mismatch, null);
  });

  test('a docx that is named .zip is reported', () => {
    const result = detectType(makeZip(['[Content_Types].xml', 'word/document.xml']), 'x.zip');
    assert.equal(result.ext, 'docx');
    assert.equal(result.mismatch.claimed, 'zip');
    assert.equal(result.mismatch.found, 'docx');
  });

  test('cut-off Office file: goes by the name and says so', () => {
    const cut = makeZip(['[Content_Types].xml', '_rels/.rels'], { centralDirectory: false });
    const named = detectType(cut, 'cv.docx');
    assert.equal(named.ext, 'docx');
    assert.equal(named.mismatch, null);
    assert.ok(named.note);
    assert.equal(detectType(cut, 'cv.zip').ext, 'zip');
  });

  test('a docx that is really a plain zip is reported', () => {
    const result = detectType(makeZip(['a.txt']), 'cv.docx');
    assert.equal(result.ext, 'zip');
    assert.equal(result.mismatch.found, 'zip');
  });
});

describe('detectType: the bytes win over the name', () => {
  test('PNG bytes named .jpg', () => {
    const result = detectType(PNG, 'photo.jpg');
    assert.equal(result.ext, 'png');
    assert.equal(result.mime, 'image/png');
    assert.equal(result.claimedExt, 'jpg');
    assert.deepEqual(
      { claimed: result.mismatch.claimed, found: result.mismatch.found },
      { claimed: 'jpg', found: 'png' },
    );
    assert.match(result.mismatch.message, /\.jpg/);
    assert.match(result.mismatch.message, /PNG/);
  });

  test('no mismatch for spellings of the same format', () => {
    assert.equal(detectType(bytes(0xff, 0xd8, 0xff, 0xe0), 'a.JPEG').mismatch, null);
    const heic = bytes([0, 0, 0, 0x18], 'ftyp', 'heic', [0, 0, 0, 0], 'mif1', 'heic');
    assert.equal(detectType(heic, 'IMG_1.HEIF').mismatch, null);
    assert.equal(detectType(heic, 'IMG_1.heic').mismatch, null);
  });

  test('an unknown name on known bytes is a mismatch', () => {
    assert.equal(detectType(PNG, 'photo.xyz').mismatch.found, 'png');
    assert.equal(detectType(PNG, 'photo').mismatch, null); // no name, nothing to compare
  });

  test('unknown bytes', () => {
    const noise = bytes(1, 0, 2, 0, 3, 0, 4, 0, 5, 0);
    const lying = detectType(noise, 'x.png');
    assert.equal(lying.ext, '');
    assert.equal(lying.kind, 'unknown');
    assert.equal(lying.mime, 'application/octet-stream');
    assert.equal(lying.mismatch.found, 'unknown');
    // A format we do not handle at all is not a lie, just unsupported.
    assert.equal(detectType(noise, 'x.7z').mismatch, null);
  });

  test('empty and tiny input never throw', () => {
    const empty = detectType(new Uint8Array(0), 'a.png');
    assert.equal(empty.kind, 'unknown');
    assert.equal(empty.mismatch, null);
    assert.ok(empty.note);
    assert.doesNotThrow(() => detectType(bytes(0x89), 'a.png'));
    assert.doesNotThrow(() => detectType(null, undefined));
  });
});

describe('detectType: text formats', () => {
  test('csv and json follow the name when the content allows it', () => {
    assert.equal(detectType(bytes('a,b\n1,2\n'), 'rows.csv').ext, 'csv');
    assert.equal(detectType(bytes('{"a":1}'), 'data.json').ext, 'json');
    assert.equal(detectType(bytes('{"a":1}'), 'data.json').kind, 'data');
    assert.equal(detectType(bytes('{"a":1}'), 'noname').ext, 'json');
  });

  test('svg is checked by content', () => {
    const svg = bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert.equal(detectType(svg, 'logo.svg').ext, 'svg');
    assert.equal(detectType(bytes('just words'), 'logo.svg').ext, 'txt');
    assert.equal(detectType(bytes('just words'), 'logo.svg').mismatch.found, 'txt');
  });

  test('text named like a picture is reported', () => {
    const result = detectType(bytes('hello there, this is text'), 'photo.png');
    assert.equal(result.ext, 'txt');
    assert.equal(result.mismatch.claimed, 'png');
  });
});

test('detectFile reads a Blob/File', async () => {
  const file = new File([PNG], 'scan.jpg');
  const result = await detectFile(file);
  assert.equal(result.ext, 'png');
  assert.ok(result.mismatch);
});

test('extOf and normalizeExt', () => {
  assert.equal(extOf('a/b\\Photo.JPEG'), 'jpg');
  assert.equal(extOf('.png'), '');
  assert.equal(extOf('noext'), '');
  assert.equal(normalizeExt('.HEIF'), 'heif');
});

// ------------------------------------------------------------ registry

function blobRun(text = 'x') {
  return async () => new Blob([text]);
}

describe('registry', () => {
  function sampleRegistry() {
    const registry = createRegistry();
    registry.registerConverter({
      id: 'heic-js',
      from: ['heic', 'heif'],
      to: ['jpg', 'png'],
      engine: 'js',
      estimate: () => ({ downloadKB: 180 }),
      run: blobRun(),
    });
    registry.registerConverter({
      id: 'png-native',
      from: ['png', 'jpg'],
      to: ['webp', 'jpg', 'png'],
      engine: 'native',
      estimate: () => ({ downloadKB: 0 }),
      run: blobRun(),
    });
    registry.registerConverter({
      id: 'png-wasm',
      from: ['png'],
      to: ['webp', 'avif'],
      engine: 'wasm',
      estimate: () => ({ downloadKB: 900 }),
      run: blobRun(),
    });
    return registry;
  }

  test('findTargets lists targets with tier and download size', () => {
    const registry = sampleRegistry();
    const heic = registry.findTargets('heic');
    assert.deepEqual(heic.map((t) => t.ext).sort(), ['jpg', 'png']);
    assert.deepEqual(
      heic.find((t) => t.ext === 'jpg'),
      { ext: 'jpg', converterId: 'heic-js', engine: 'js', tier: 1, downloadKB: 180 },
    );
    // from and to are never the same format
    assert.ok(!registry.findTargets('png').some((t) => t.ext === 'png'));
  });

  test('the lightest engine wins, and lighter targets come first', () => {
    const registry = sampleRegistry();
    const targets = registry.findTargets('png');
    assert.equal(targets.find((t) => t.ext === 'webp').engine, 'native');
    assert.equal(registry.getConverter('png', 'webp').id, 'png-native');
    assert.equal(registry.getConverter('png', 'avif').id, 'png-wasm');
    assert.deepEqual(targets.map((t) => t.tier), [...targets.map((t) => t.tier)].sort((a, b) => a - b));
  });

  test('names are normalised and unknown formats give nothing', () => {
    const registry = sampleRegistry();
    assert.equal(registry.findTargets('.HEIC').length, 2);
    assert.deepEqual(registry.findTargets('docx'), []);
    assert.equal(registry.getConverter('docx', 'txt'), null);
    assert.equal(registry.getConverter('png', 'png'), null);
  });

  test('a broken estimate becomes "unknown", never a crash', () => {
    const registry = createRegistry();
    registry.registerConverter({
      id: 'bad', from: ['png'], to: ['jpg'], engine: 'js', run: blobRun(),
      estimate: () => { throw new Error('boom'); },
    });
    assert.equal(registry.findTargets('png')[0].downloadKB, null);
  });

  test('estimate receives the file', () => {
    const registry = createRegistry();
    let seen = null;
    registry.registerConverter({
      id: 'e', from: ['png'], to: ['jpg'], engine: 'js', run: blobRun(),
      estimate: (file) => { seen = file; return { downloadKB: 1 }; },
    });
    const file = new File(['abc'], 'a.png');
    registry.findTargets('png', file);
    assert.equal(seen, file);
  });

  test('suggestTarget uses the table', () => {
    const registry = createRegistry();
    const add = (id, from, to, engine = 'js') =>
      registry.registerConverter({ id, from, to, engine, run: blobRun() });
    add('a', ['heic'], ['png', 'jpg', 'webp']);
    add('b', ['webp'], ['jpg', 'png']);
    add('c', ['png'], ['jpg', 'webp']);
    add('d', ['mov'], ['webm', 'mp4', 'mp3'], 'wasm');
    add('e', ['docx'], ['html', 'txt']);
    add('f', ['pdf'], ['txt', 'png', 'jpg']);
    add('g', ['wav'], ['ogg', 'mp3']);
    add('h', ['mp4'], ['webm', 'mp3']);
    assert.equal(registry.suggestTarget('heic').ext, 'jpg');
    assert.equal(registry.suggestTarget('webp').ext, 'png');
    assert.equal(registry.suggestTarget('png').ext, 'webp');
    assert.equal(registry.suggestTarget('mov').ext, 'mp4');
    assert.equal(registry.suggestTarget('docx').ext, 'txt');
    assert.equal(registry.suggestTarget('pdf').ext, 'png');
    assert.equal(registry.suggestTarget('wav').ext, 'mp3');
    assert.equal(registry.suggestTarget('mp4').ext, 'mp3');
  });

  test('suggestTarget only suggests what exists', () => {
    const registry = createRegistry();
    // heic -> jpg is the table favourite, but only png and webp are registered.
    registry.registerConverter({ id: 'x', from: ['heic'], to: ['webp', 'png'], engine: 'js', run: blobRun() });
    assert.equal(registry.suggestTarget('heic').ext, 'png');
    // not in the table at all: falls back to the first (lightest) target
    registry.registerConverter({ id: 'y', from: ['xyz'], to: ['abc'], engine: 'js', run: blobRun() });
    assert.equal(registry.suggestTarget('xyz').ext, 'abc');
    assert.equal(registry.suggestTarget('nothing'), null);
  });

  test('registerConverter checks its input', () => {
    const registry = createRegistry();
    const ok = { id: 'ok', from: ['png'], to: ['jpg'], engine: 'js', run: blobRun() };
    registry.registerConverter(ok);
    assert.throws(() => registry.registerConverter(ok), /already registered/);
    assert.throws(() => registry.registerConverter({ ...ok, id: 'e1', engine: 'magic' }), TypeError);
    assert.throws(() => registry.registerConverter({ ...ok, id: 'e2', run: null }), TypeError);
    assert.throws(() => registry.registerConverter({ ...ok, id: 'e3', from: [] }), TypeError);
    assert.throws(() => registry.registerConverter({ ...ok, id: '' }), TypeError);
    assert.throws(() => registry.registerConverter({ ...ok, id: 'e4', worker: {} }), TypeError);
  });

  test('ensureLoaded loads once, and forgets a failure so retry works', async () => {
    let calls = 0;
    const good = { load: async () => { calls += 1; } };
    await Promise.all([ensureLoaded(good), ensureLoaded(good)]);
    await ensureLoaded(good);
    assert.equal(calls, 1);

    let tries = 0;
    const flaky = { load: async () => { tries += 1; if (tries === 1) throw new TypeError('Failed to fetch'); } };
    await assert.rejects(ensureLoaded(flaky));
    await wait();
    await ensureLoaded(flaky);
    assert.equal(tries, 2);
  });
});

// ------------------------------------------------------------ queue

function makeFile(name = 'a.png', content = 'abc') {
  return new File([content], name);
}

function queueWith(converterSpec, queueOptions = {}) {
  const registry = createRegistry();
  registry.registerConverter({
    id: 'test', from: ['png'], to: ['jpg'], engine: 'native', ...converterSpec,
  });
  return createJobQueue({ registry, concurrency: 2, ...queueOptions });
}

describe('defaultConcurrency', () => {
  test('min(4, cores - 1), at least 1', () => {
    assert.equal(defaultConcurrency(16), 4);
    assert.equal(defaultConcurrency(8), 4);
    assert.equal(defaultConcurrency(4), 3);
    assert.equal(defaultConcurrency(2), 1);
    assert.equal(defaultConcurrency(1), 1);
    assert.equal(defaultConcurrency(0), 1);
    // Unknown core count counts as 2, so 1 job. (null/NaN, not undefined:
    // undefined means "use this computer's real core count".)
    assert.equal(defaultConcurrency(null), 1);
    assert.equal(defaultConcurrency(Number.NaN), 1);
    // With no argument it reads this computer. The answer depends on the
    // machine, so we only check it stays inside the allowed range.
    const here = defaultConcurrency();
    assert.ok(here >= 1 && here <= 4);
  });
});

describe('job queue', () => {
  test('success: progress, events, result', async () => {
    const queue = queueWith({
      run: async (job, onProgress) => {
        onProgress(0.25);
        onProgress(7); // out of range is clamped
        onProgress(Number.NaN); // ignored
        return new Blob(['hello!']);
      },
    });
    const seen = [];
    for (const type of ['added', 'start', 'progress', 'done', 'idle']) {
      queue.on(type, (job) => seen.push(type === 'progress' ? `progress:${job.progress}` : type));
    }
    const job = queue.add({ file: makeFile('a.png', '123456789'), toExt: 'jpg' });
    assert.equal(job.fromExt, 'png'); // taken from the file name
    assert.equal(job.engine, 'native');
    await queue.whenIdle();
    assert.equal(job.status, 'done');
    assert.equal(job.progress, 1);
    assert.equal(job.bytesIn, 9);
    assert.equal(job.bytesOut, 6);
    assert.equal(job.resultBlob.size, 6);
    assert.equal(job.error, null);
    assert.deepEqual(seen, ['added', 'start', 'progress:0.25', 'progress:1', 'done', 'idle']);
  });

  test('a failed job never stops the others', async () => {
    const queue = queueWith({
      run: async (job) => {
        if (job.options.fail) throw new RangeError('Array buffer allocation failed');
        return new Blob(['ok']);
      },
    });
    const a = queue.add({ file: makeFile(), toExt: 'jpg' });
    const bad = queue.add({ file: makeFile(), toExt: 'jpg', options: { fail: true } });
    const c = queue.add({ file: makeFile(), toExt: 'jpg' });
    const d = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.deepEqual([a, bad, c, d].map((j) => j.status), ['done', 'error', 'done', 'done']);
    assert.equal(bad.error.code, 'out-of-memory');
    assert.match(bad.error.message, /memory/i);
    assert.doesNotMatch(bad.error.message, /Array buffer/); // no raw technical text
    assert.equal(bad.resultBlob, null);
  });

  test('a converter that throws synchronously is also isolated', async () => {
    const queue = queueWith({
      run: (job) => {
        if (job.options.fail) throw new Error('sync boom');
        return Promise.resolve(new Blob(['ok']));
      },
    });
    const bad = queue.add({ file: makeFile(), toExt: 'jpg', options: { fail: true } });
    const good = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(bad.status, 'error');
    assert.equal(bad.error.code, 'unknown');
    assert.equal(good.status, 'done');
  });

  test('no converter: the job fails at once with a plain message', async () => {
    const queue = queueWith({ run: blobRun() });
    const job = queue.add({ file: makeFile('a.png'), toExt: 'docx' });
    assert.equal(job.status, 'error');
    assert.equal(job.error.code, 'no-converter');
    assert.match(job.error.message, /png/);
    await queue.whenIdle();
  });

  test('a bad file is a programming error and throws', () => {
    const queue = queueWith({ run: blobRun() });
    assert.throws(() => queue.add({ file: null, toExt: 'jpg' }), TypeError);
  });

  test('runs at most N jobs at once', async () => {
    let now = 0;
    let most = 0;
    const queue = queueWith(
      {
        run: async () => {
          now += 1;
          most = Math.max(most, now);
          await wait(5);
          now -= 1;
          return new Blob(['x']);
        },
      },
      { concurrency: 2 },
    );
    const jobs = Array.from({ length: 6 }, () => queue.add({ file: makeFile(), toExt: 'jpg' }));
    await queue.whenIdle();
    assert.equal(most, 2);
    assert.ok(jobs.every((j) => j.status === 'done'));
  });

  test('cancel a queued job: it never runs', async () => {
    let runs = 0;
    const queue = queueWith(
      { run: async () => { runs += 1; await wait(5); return new Blob(['x']); } },
      { concurrency: 1 },
    );
    const first = queue.add({ file: makeFile(), toExt: 'jpg' });
    const second = queue.add({ file: makeFile(), toExt: 'jpg' });
    assert.equal(queue.cancel(second.id), true);
    await queue.whenIdle();
    assert.equal(first.status, 'done');
    assert.equal(second.status, 'cancelled');
    assert.equal(runs, 1);
  });

  test('cancel a running job: the signal fires and the next job starts', async () => {
    let sawAbort = false;
    const queue = queueWith(
      {
        run: (job, onProgress, signal) => {
          if (!job.options.hang) return Promise.resolve(new Blob(['ok']));
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              sawAbort = true;
              reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
            });
          });
        },
      },
      { concurrency: 1 },
    );
    const slow = queue.add({ file: makeFile(), toExt: 'jpg', options: { hang: true } });
    const next = queue.add({ file: makeFile(), toExt: 'jpg' });
    await wait(1);
    assert.equal(slow.status, 'running');
    assert.equal(queue.cancel(slow.id), true);
    assert.equal(slow.status, 'cancelled');
    await queue.whenIdle();
    assert.equal(sawAbort, true);
    assert.equal(slow.status, 'cancelled'); // the abort error did not turn it into 'error'
    assert.equal(slow.error, null);
    assert.equal(next.status, 'done');
  });

  test('cancel frees the slot even when the converter ignores the signal', async () => {
    let release;
    const queue = queueWith(
      {
        run: (job) =>
          job.options.hang
            ? new Promise((resolve) => { release = () => resolve(new Blob(['late'])); })
            : Promise.resolve(new Blob(['ok'])),
      },
      { concurrency: 1 },
    );
    const stuck = queue.add({ file: makeFile(), toExt: 'jpg', options: { hang: true } });
    const next = queue.add({ file: makeFile(), toExt: 'jpg' });
    await wait(1);
    queue.cancel(stuck.id);
    await queue.whenIdle();
    assert.equal(next.status, 'done');
    release(); // the stray result arrives late and is ignored
    await wait(1);
    assert.equal(stuck.status, 'cancelled');
    assert.equal(stuck.resultBlob, null);
  });

  test('cancelAll', async () => {
    const queue = queueWith(
      { run: (job, p, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('x')))) },
      { concurrency: 1 },
    );
    const jobs = [1, 2, 3].map(() => queue.add({ file: makeFile(), toExt: 'jpg' }));
    await wait(1);
    queue.cancelAll();
    assert.ok(jobs.every((j) => j.status === 'cancelled'));
    await queue.whenIdle();
  });

  test('retry: a failed job can run again and succeed', async () => {
    let calls = 0;
    const queue = queueWith({
      run: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
        return new Blob(['fine']);
      },
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(job.status, 'error');
    assert.equal(job.error.code, 'engine-load-failed');
    assert.equal(job.error.retryable, true);

    assert.equal(queue.retry(job.id), true);
    assert.equal(job.status, 'running'); // a free slot means it starts at once
    assert.equal(job.error, null);
    await queue.whenIdle();
    assert.equal(job.status, 'done');
    assert.equal(job.attempts, 2);
    assert.equal(queue.retry(job.id), false); // only failed or cancelled jobs
    assert.equal(queue.retry('nope'), false);
  });

  test('retry a cancelled job', async () => {
    const queue = queueWith({ run: blobRun() }, { concurrency: 1 });
    queue.add({ file: makeFile(), toExt: 'jpg' });
    const second = queue.add({ file: makeFile(), toExt: 'jpg' });
    queue.cancel(second.id);
    await queue.whenIdle();
    queue.retry(second.id);
    await queue.whenIdle();
    assert.equal(second.status, 'done');
  });

  test('remove forgets a job and drops its result', async () => {
    const queue = queueWith({ run: blobRun() });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(queue.remove(job.id), true);
    assert.equal(queue.get(job.id), undefined);
    assert.equal(job.resultBlob, null);
  });

  test('a converter that returns no file is an error', async () => {
    const queue = queueWith({ run: async () => 'not a blob' });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(job.status, 'error');
    assert.equal(job.error.code, 'bad-result');
  });

  test('ConvertError keeps its own message', async () => {
    const queue = queueWith({
      run: async () => { throw new ConvertError('password-protected', 'This PDF needs a password.'); },
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.deepEqual(job.error, { code: 'password-protected', message: 'This PDF needs a password.', retryable: false });
  });

  test('memory guard: too big is refused, big only warns', async () => {
    let runs = 0;
    const run = async () => { runs += 1; return new Blob(['x']); };

    const strict = queueWith({ run }, { memoryGuard: createMemoryGuard({ warnBytes: 5, hardLimitBytes: 50 }) });
    const huge = strict.add({ file: makeFile('a.png', 'x'.repeat(100)), toExt: 'jpg' });
    await strict.whenIdle();
    assert.equal(huge.status, 'error');
    assert.equal(huge.error.code, 'too-large');
    assert.equal(runs, 0);

    const warnings = [];
    const gentle = queueWith({ run }, { memoryGuard: createMemoryGuard({ warnBytes: 5, hardLimitBytes: 1000 }) });
    gentle.on('warning', (job) => warnings.push(job.warning));
    const big = gentle.add({ file: makeFile('a.png', 'x'.repeat(100)), toExt: 'jpg' });
    await gentle.whenIdle();
    assert.equal(big.status, 'done');
    assert.equal(warnings.length, 1);
    assert.match(big.warning, /big file/);
  });
});

describe('friendlyError', () => {
  const code = (err) => friendlyError(err).code;
  test('maps known problems to plain messages', () => {
    assert.equal(code(Object.assign(new Error('x'), { name: 'QuotaExceededError' })), 'out-of-memory');
    assert.equal(code(new RangeError('Invalid array length')), 'out-of-memory');
    assert.equal(code(new Error('abort(OOM). Build with -sASSERTIONS')), 'out-of-memory');
    assert.equal(code(Object.assign(new Error('x'), { name: 'EncodingError' })), 'unreadable');
    assert.equal(code(Object.assign(new Error('x'), { name: 'NotSupportedError' })), 'unsupported');
    assert.equal(code(Object.assign(new Error('x'), { name: 'SecurityError' })), 'blocked');
    assert.equal(code(Object.assign(new Error('x'), { name: 'AbortError' })), 'cancelled');
    assert.equal(code(new TypeError('Failed to fetch')), 'engine-load-failed');
    assert.equal(code(new MemoryLimitError(100, 10)), 'too-large');
    assert.equal(code(new Error('whatever')), 'unknown');
    assert.equal(code(undefined), 'unknown');
    assert.equal(code('a string'), 'unknown');
  });

  test('a plain TypeError from a bug is not blamed on the network', () => {
    assert.equal(code(new TypeError("Cannot read properties of undefined (reading 'load')")), 'unknown');
  });

  test('messages are short, plain, and hide technical text', () => {
    const { message } = friendlyError(new Error('at Object.run (blob:https://x/abc:12:3) secret-file-name.png'));
    assert.doesNotMatch(message, /secret-file-name|blob:|Object\.run/);
    assert.match(friendlyError(new MemoryLimitError(3 * 1024 ** 3, 2 * 1024 ** 3)).message, /3 GB/);
  });
});

// ------------------------------------------------------------ safe.js

describe('safeFileName', () => {
  test('removes folders and path tricks', () => {
    assert.equal(safeFileName('../../x.png', 'jpg'), 'x.jpg');
    assert.equal(safeFileName('..\\..\\Windows\\evil.png', 'jpg'), 'evil.jpg');
    assert.equal(safeFileName('C:\\Users\\me\\photo.png'), 'photo.png');
    assert.equal(safeFileName('/etc/passwd', 'txt'), 'passwd.txt');
    assert.equal(safeFileName('a/b/', 'pdf'), 'b.pdf');
    assert.equal(safeFileName('..', 'jpg'), 'file.jpg');
    assert.equal(safeFileName('.', 'jpg'), 'file.jpg');
    assert.equal(safeFileName('/', 'jpg'), 'file.jpg');
  });

  test('removes characters Windows rejects and control characters', () => {
    assert.equal(safeFileName('bad<>:"|?*name.png', 'jpg'), 'bad_name.jpg');
    assert.equal(safeFileName('x\u0000y\u001f.png', 'jpg'), 'xy.jpg');
  });

  test('the right-to-left override trick is removed', () => {
    const out = safeFileName('invoice\u202Egpj.exe', 'pdf');
    assert.equal(out, 'invoicegpj.pdf');
    assert.doesNotMatch(out, /[\u202a-\u202e]/);
  });

  test('no hidden files, no trailing dots, no Windows device names', () => {
    assert.equal(safeFileName('.htaccess', 'txt'), 'htaccess.txt');
    assert.equal(safeFileName('report...png', 'jpg'), 'report.jpg');
    assert.equal(safeFileName('CON.txt', 'pdf'), '_CON.pdf');
    assert.equal(safeFileName('lpt1', 'pdf'), '_lpt1.pdf');
  });

  test('empty or strange input still gives a usable name', () => {
    for (const input of ['', null, undefined, '   ', 42]) {
      const out = safeFileName(input, 'jpg');
      assert.match(out, /^[^/\\]+\.jpg$/);
    }
    assert.equal(safeFileName('', 'jpg'), 'file.jpg');
  });

  test('extension handling', () => {
    assert.equal(safeFileName('x.png', '.JPG '), 'x.jpg');
    assert.equal(safeFileName('x.png', '../png'), 'x.png');
    assert.equal(safeFileName('x.png', ''), 'x');
    assert.equal(safeFileName('x.png'), 'x.png');
    assert.equal(safeFileName('x.png.exe', 'jpg'), 'x.png.jpg');
    assert.equal(safeFileName('  my   photo  .png', 'jpg'), 'my photo.jpg');
  });

  test('keeps it short, by characters and by bytes', () => {
    const long = safeFileName(`${'a'.repeat(300)}.png`, 'jpg');
    assert.ok(long.length <= 90, long.length);
    const telugu = safeFileName(`${'అ'.repeat(200)}.png`, 'jpg');
    assert.ok(new TextEncoder().encode(telugu).length <= 255);
    assert.ok(telugu.endsWith('.jpg'));
    const emoji = safeFileName(`${'😀'.repeat(100)}.png`, 'jpg');
    assert.doesNotMatch(emoji, /[\ud800-\udbff](?![\udc00-\udfff])/); // no broken surrogate pairs
  });

  test('keeps letters of other languages', () => {
    assert.equal(safeFileName('నా ఫోటో.heic', 'jpg'), 'నా ఫోటో.jpg');
    assert.equal(safeFileName('मार्कशीट.png', 'pdf'), 'मार्कशीट.pdf');
  });
});

describe('formatBytes', () => {
  test('sizes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(150 * 1024), '150 KB');
    assert.equal(formatBytes(1.2 * 1024 * 1024), '1.2 MB');
    assert.equal(formatBytes(5 * 1024 ** 3), '5 GB');
  });
  test('bad input', () => {
    assert.equal(formatBytes(Number.NaN), '—');
    assert.equal(formatBytes(-1), '—');
    assert.equal(formatBytes('12'), '—');
  });
});

describe('memory guard', () => {
  const MIB = 1024 * 1024;
  test('warns above 500 MB, not at 500 MB', () => {
    const guard = createMemoryGuard();
    assert.equal(guard.check(500 * MIB).level, 'ok');
    assert.equal(guard.check(500 * MIB + 1).level, 'warn');
    assert.match(guard.check(600 * MIB).message, /600 MB/);
  });
  test('hard limit is configurable', () => {
    const guard = createMemoryGuard({ hardLimitBytes: 800 * MIB });
    assert.equal(guard.check(700 * MIB).level, 'warn');
    assert.equal(guard.check(801 * MIB).level, 'block');
    assert.throws(() => guard.assertOk(801 * MIB), MemoryLimitError);
    guard.setHardLimit(2000 * MIB);
    assert.equal(guard.check(801 * MIB).level, 'warn');
    assert.equal(guard.hardLimitBytes, 2000 * MIB);
    assert.throws(() => guard.setHardLimit(0), RangeError);
  });
  test('odd sizes are treated as empty', () => {
    assert.equal(createMemoryGuard().check(Number.NaN).level, 'ok');
  });
});

describe('object URLs', () => {
  function fakeApi() {
    const made = [];
    const revoked = [];
    return {
      made,
      revoked,
      createObjectURL: () => { const url = `blob:fake/${made.length + 1}`; made.push(url); return url; },
      revokeObjectURL: (url) => revoked.push(url),
    };
  }

  test('use() revokes after success and after failure', async () => {
    const api = fakeApi();
    const urls = createObjectUrlManager({ api });
    assert.equal(await urls.use(new Blob(['a']), async (url) => url), 'blob:fake/1');
    await assert.rejects(urls.use(new Blob(['b']), async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(api.revoked, ['blob:fake/1', 'blob:fake/2']);
    assert.equal(urls.size, 0);
  });

  test('revoke is safe to call twice; revokeAll clears everything', () => {
    const api = fakeApi();
    const urls = createObjectUrlManager({ api });
    const a = urls.create(new Blob(['a']));
    urls.create(new Blob(['b']));
    urls.revoke(a);
    urls.revoke(a);
    assert.equal(api.revoked.length, 1);
    urls.revokeAll();
    assert.equal(api.revoked.length, 2);
    assert.equal(urls.size, 0);
  });

  test('revokeAfter waits for the timer', () => {
    const api = fakeApi();
    let fire;
    const urls = createObjectUrlManager({ api, setTimer: (fn) => { fire = fn; return {}; } });
    const url = urls.create(new Blob(['a']));
    urls.revokeAfter(url, 1000);
    assert.equal(api.revoked.length, 0);
    fire();
    assert.deepEqual(api.revoked, [url]);
  });
});

// ------------------------------------------------------------ worker pieces

/** A pretend Worker that runs worker.js's real message handler in-process. */
class FakeWorker extends EventTarget {
  constructor(handle, { failToStart = false } = {}) {
    super();
    this.handle = handle;
    this.failToStart = failToStart;
    this.terminated = false;
    this.sent = [];
  }
  postMessage(message) {
    this.sent.push(message.type);
    if (this.failToStart) {
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
      return;
    }
    this.handle(message, (reply) =>
      queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('message'), { data: reply }))),
    );
  }
  terminate() {
    this.terminated = true;
  }
}

const IMAGE_FEATURES = { Worker: () => true, OffscreenCanvas: () => true };

function workerSetup({ workerSide, mainSide, features = IMAGE_FEATURES, failToStart = false }) {
  const registry = createRegistry();
  registry.registerConverter({
    id: 'img',
    from: ['png'],
    to: ['jpg'],
    engine: 'native',
    run: mainSide ?? (async () => new Blob(['from main'])),
    worker: { module: 'fake://converter.js', needs: ['OffscreenCanvas'] },
  });
  const handle = createHandler(async () => ({ converter: { id: 'img', run: workerSide } }));
  const workers = [];
  const client = createWorkerClient({
    featureTests: features,
    createWorker: () => {
      const worker = new FakeWorker(handle, { failToStart });
      workers.push(worker);
      return worker;
    },
  });
  const queue = createJobQueue({ registry, runner: client.run, concurrency: 2 });
  return { queue, client, workers };
}

describe('worker + workerClient', () => {
  test('runs in the worker, forwards progress, keeps the worker for next time', async () => {
    const { queue, client, workers } = workerSetup({
      workerSide: async (job, onProgress) => {
        onProgress(0.5);
        return new Blob(['from worker']);
      },
    });
    const progress = [];
    queue.on('progress', (job) => progress.push(job.progress));
    const first = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(first.status, 'done');
    assert.equal(await first.resultBlob.text(), 'from worker');
    assert.deepEqual(progress, [0.5]);
    assert.equal(workers.length, 1);
    assert.deepEqual(client.stats(), { idle: 1, busy: 0, broken: false });

    const second = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(second.status, 'done');
    assert.equal(workers.length, 1); // the warm worker was reused
  });

  test('the worker passes plain job data and the file, never functions', async () => {
    let received;
    const { queue } = workerSetup({
      workerSide: async (job) => {
        received = job;
        return new Blob(['x']);
      },
    });
    const file = makeFile('scan.png');
    queue.add({ file, toExt: 'jpg', options: { quality: 0.8 } });
    await queue.whenIdle();
    assert.equal(received.file, file);
    assert.equal(received.toExt, 'jpg');
    assert.deepEqual(received.options, { quality: 0.8 });
  });

  test('falls back to the main thread when the browser lacks a feature', async () => {
    const { queue, workers } = workerSetup({
      workerSide: async () => new Blob(['from worker']),
      features: { Worker: () => true, OffscreenCanvas: () => false },
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(await job.resultBlob.text(), 'from main');
    assert.equal(workers.length, 0);
  });

  test('falls back when there are no workers at all', async () => {
    const { queue, workers } = workerSetup({
      workerSide: async () => new Blob(['from worker']),
      features: {},
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(await job.resultBlob.text(), 'from main');
    assert.equal(workers.length, 0);
  });

  test('a converter without a worker field always runs on the main thread', async () => {
    const registry = createRegistry();
    registry.registerConverter({ id: 'plain', from: ['png'], to: ['jpg'], engine: 'js', run: async () => new Blob(['main']) });
    const client = createWorkerClient({ featureTests: IMAGE_FEATURES, createWorker: () => assert.fail('no worker expected') });
    const queue = createJobQueue({ registry, runner: client.run });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(await job.resultBlob.text(), 'main');
  });

  test('a worker that cannot start falls back, and is not tried again', async () => {
    const { queue, client, workers } = workerSetup({
      workerSide: async () => new Blob(['from worker']),
      failToStart: true,
    });
    const first = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(first.status, 'done');
    assert.equal(await first.resultBlob.text(), 'from main');
    assert.equal(client.stats().broken, true);
    assert.equal(workers[0].terminated, true);

    const second = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(await second.resultBlob.text(), 'from main');
    assert.equal(workers.length, 1); // no second worker was created
  });

  test('cancel stops the worker for real', async () => {
    const { queue, workers } = workerSetup({
      workerSide: () => new Promise(() => {}), // never finishes, never checks the signal
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await wait(2);
    assert.equal(job.status, 'running');
    queue.cancel(job.id);
    await queue.whenIdle();
    assert.equal(job.status, 'cancelled');
    assert.equal(workers[0].terminated, true);
    assert.deepEqual(workers[0].sent, ['run', 'cancel']);
  });

  test('an error inside the worker keeps its meaning', async () => {
    const { queue } = workerSetup({
      workerSide: async () => {
        throw new ConvertError('password-protected', 'This PDF needs a password.');
      },
    });
    const job = queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    assert.equal(job.status, 'error');
    assert.equal(job.error.code, 'password-protected');
    assert.equal(job.error.message, 'This PDF needs a password.');

    const { queue: queue2 } = workerSetup({
      workerSide: async () => {
        throw Object.assign(new Error('decode failed'), { name: 'EncodingError' });
      },
    });
    const job2 = queue2.add({ file: makeFile(), toExt: 'jpg' });
    await queue2.whenIdle();
    assert.equal(job2.error.code, 'unreadable');
  });

  test('a job already cancelled never reaches a worker', async () => {
    const { client, workers } = workerSetup({ workerSide: async () => new Blob(['x']) });
    const controller = new AbortController();
    controller.abort();
    const converter = { id: 'img', worker: { module: 'fake://x', needs: [] }, run: async () => new Blob(['x']) };
    await assert.rejects(client.run(converter, { id: 'j', file: makeFile() }, () => {}, controller.signal), { name: 'AbortError' });
    assert.equal(workers.length, 0);
  });

  test('dispose terminates every worker', async () => {
    const { queue, client, workers } = workerSetup({ workerSide: async () => new Blob(['x']) });
    queue.add({ file: makeFile(), toExt: 'jpg' });
    await queue.whenIdle();
    client.dispose();
    assert.ok(workers.every((w) => w.terminated));
    assert.deepEqual(client.stats(), { idle: 0, busy: 0, broken: false });
  });
});
