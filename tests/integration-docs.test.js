// The glue between the document converters and the rest of the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../js/core/registry.js';
import { converters } from '../js/converters/index.js';
import { ConvertError } from '../js/core/errors.js';
import { friendlyError } from '../js/ui/jobs.js';

function registryWithDocs() {
  const registry = createRegistry();
  for (const c of converters) if (c.available !== false) registry.registerConverter(c);
  return registry;
}

test('every document converter is accepted by the real registry', () => {
  assert.doesNotThrow(registryWithDocs);
});

test('the registry offers the expected targets for each document type', () => {
  const r = registryWithDocs();
  const targets = (from) => r.findTargets(from).map((t) => t.ext).sort();
  assert.deepEqual(targets('docx'), ['html', 'md', 'txt']);
  assert.deepEqual(targets('md'), ['html']);
  assert.deepEqual(targets('markdown'), ['html']); // alias
  assert.deepEqual(targets('txt'), ['pdf']);
  assert.deepEqual(targets('csv'), ['json']);
  assert.deepEqual(targets('json'), ['csv']);
  assert.deepEqual(targets('xlsx'), ['csv', 'json']);
});

test('Bridge-only conversions are never offered as real choices', () => {
  const r = registryWithDocs();
  assert.equal(r.getConverter('docx', 'pdf'), null);
  assert.equal(r.getConverter('pptx', 'pdf'), null);
  assert.equal(r.getConverter('xlsx', 'pdf'), null);
});

test('a converter message is shown in full, even when it is long', () => {
  const long = 'This looks like an old .doc file or a password-protected file. Open it in Word, remove the password or choose Save As > .docx, then try again.';
  assert.ok(long.length > 140);
  assert.equal(friendlyError(new ConvertError('BAD_FILE', long)), long);
  // anything else still gets the short, safe fallback
  assert.match(friendlyError(new Error('x'.repeat(200))), /Something went wrong/);
});
