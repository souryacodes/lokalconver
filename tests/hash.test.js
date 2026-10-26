import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeHash, isValidSha256, compareHashes, sha256OfFile } from '../js/core/hash.js';

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; // SHA-256 of "abc"

test('sha256OfFile matches the known value for "abc"', async () => {
  assert.equal(await sha256OfFile(new Blob(['abc']), webcrypto.subtle), ABC);
});
test('empty file is refused, not hashed', async () => {
  await assert.rejects(sha256OfFile(new Blob([]), webcrypto.subtle), { code: 'EMPTY' });
});
test('no Web Crypto gives a friendly error', async () => {
  await assert.rejects(sha256OfFile(new Blob(['x']), null), { code: 'NO_CRYPTO' });
});
test('normalize: case, spaces, colons, prefixes', () => {
  assert.equal(normalizeHash(`  ${ABC.toUpperCase()}\n`), ABC);
  assert.equal(normalizeHash(`sha256:${ABC}`), ABC);
  assert.equal(normalizeHash(`SHA-256 = ${ABC}`), ABC);
  assert.equal(normalizeHash(ABC.match(/../g).join(':')), ABC);
  assert.equal(normalizeHash(ABC.match(/.{8}/g).join(' ')), ABC);
});
test('valid / invalid', () => {
  assert.ok(isValidSha256(ABC));
  assert.ok(!isValidSha256(ABC.slice(1)));
  assert.ok(!isValidSha256(`${ABC}0`));
  assert.ok(!isValidSha256(`${ABC.slice(0, 63)}g`));
});
test('compare: match, different, invalid, empty', () => {
  assert.equal(compareHashes(ABC, ABC.toUpperCase()).status, 'match');
  assert.equal(compareHashes(ABC, `${ABC.slice(0, 63)}0`).status, 'different');
  assert.equal(compareHashes(ABC, 'not a hash').status, 'invalid');
  assert.equal(compareHashes(ABC, '   ').status, 'empty');
  assert.equal(compareHashes(ABC, undefined).status, 'empty');
});
