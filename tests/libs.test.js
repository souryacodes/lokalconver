// Keeps the library list honest: pinned versions, hashes, licences, sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { LIBS } from '../js/converters/libs.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const exists = (p) => fs.existsSync(new URL(p, root));
const sums = () => Object.fromEntries(read('js/vendor/SHA256SUMS').toString().trim().split('\n').map((l) => { const [h, p] = l.split(/\s+/); return [p, h]; }));

test('every library is pinned to an exact version (no ^ ~ * or latest) and the path uses that version', () => {
  for (const [key, lib] of Object.entries(LIBS)) {
    assert.match(lib.version, /^\d+\.\d+\.\d+$/, key);
    assert.ok(lib.path.includes(`/${lib.version}/`), `${key} path should contain its version`);
  }
});

test('every library is listed in docs/LICENSES.md with its version and licence', () => {
  const doc = read('docs/LICENSES.md').toString();
  for (const [key, lib] of Object.entries(LIBS)) {
    const line = doc.split('\n').find((l) => l.includes(lib.version) && l.includes(lib.license));
    assert.ok(line, `${key} ${lib.version} ${lib.license} missing in docs/LICENSES.md`);
  }
});

test('vendored files match vendor/SHA256SUMS and the listed size', () => {
  const known = sums();
  for (const [key, lib] of Object.entries(LIBS)) {
    if (!exists(lib.path)) { assert.equal(key, 'sheetjs', `${key} must be vendored`); continue; }
    const buf = read(lib.path);
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), known[lib.path], `${key} hash changed`);
    if (lib.kb !== null) assert.ok(Math.abs(buf.length / 1024 - lib.kb) / lib.kb < 0.05, `${key} kb is ${buf.length / 1024}`);
  }
});

test('the worker file and the pages never load anything from another site', () => {
  for (const f of ['js/engines/lib-worker.js', 'js/core/lazy.js', 'js/core/lib-worker-client.js', 'js/converters/libs.js']) {
    assert.ok(!/https?:\/\//.test(read(f).toString().replace(/^\s*(\/\/|\*).*$/gm, '')), `${f} has an absolute URL`);
  }
});

test('every vendored library folder keeps its licence file next to it', () => {
  const vendorDir = new URL('js/vendor/', root);
  for (const name of fs.readdirSync(vendorDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const found = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
        else if (/^licen[sc]e/i.test(e.name)) found.push(e.name);
      }
    };
    walk(new URL(`${name.name}/`, vendorDir));
    assert.ok(found.length > 0, `js/vendor/${name.name} has no LICENSE file`);
  }
});
