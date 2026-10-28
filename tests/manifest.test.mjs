import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', ROOT), 'utf8'));
const worker = readFileSync(new URL('service-worker.js', ROOT), 'utf8');

// Width and height are stored in the PNG header (bytes 16 to 23).
function pngSize(path) {
  const bytes = readFileSync(new URL(path, ROOT));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', path + ' is a PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('manifest: the basics Chrome needs to offer install', () => {
  assert.equal(manifest.name, 'LokalConver');
  assert.ok(manifest.short_name.length <= 12);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9A-F]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9A-F]{6}$/i);
});

test('manifest: icons exist, have the declared size, and include maskable ones', () => {
  const png = manifest.icons.filter((icon) => icon.type === 'image/png');
  for (const icon of png) assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  for (const purpose of ['any', 'maskable']) {
    for (const sizes of ['192x192', '512x512']) {
      assert.ok(png.some((i) => i.purpose === purpose && i.sizes === sizes), `${purpose} ${sizes}`);
    }
  }
  assert.ok(manifest.icons.every((i) => i.purpose === 'any' || i.purpose === 'maskable'), 'no "any maskable" mix');
});

test('manifest: share target is POST multipart with files, and the worker listens at that URL', () => {
  const target = manifest.share_target;
  assert.equal(target.method, 'POST');
  assert.equal(target.enctype, 'multipart/form-data');
  const files = target.params.files;
  assert.equal(files.length, 1);
  const accept = files[0].accept;
  for (const kind of ['image/*', 'application/pdf', 'audio/*', 'video/*']) assert.ok(accept.includes(kind), kind);
  // the worker routes this exact path, and the form field must be called "files"
  assert.equal(files[0].name, 'files');
  assert.ok(worker.includes(`const SHARE_PATH = '${target.action.replace('./', '')}'`));
  assert.ok(worker.includes("form.getAll('files')"));
});
