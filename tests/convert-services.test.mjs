// The adapter between the Convert page and the registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../js/core/registry.js';
import { createConvertServices } from '../js/ui/services.js';
import { normalizeSuggestion } from '../js/ui/format.js';

function setup() {
  const registry = createRegistry();
  registry.registerConverter({
    id: 'fake-image', from: ['png', 'jpg'], to: ['jpg', 'png', 'webp'], engine: 'native',
    estimate: () => ({ downloadKB: 0 }), load: async () => {}, run: async () => new Blob(['x']),
  });
  return createConvertServices(registry);
}

test('suggestTarget gives the registry pick first, then the other real targets', () => {
  const services = setup();
  const answer = services.suggestTarget('png');
  assert.equal(answer.target, 'webp');
  assert.deepEqual(answer.alternatives.sort(), ['jpg']);
  // and the page can read that shape
  assert.deepEqual(normalizeSuggestion(answer), { primary: 'webp', others: ['jpg'] });
});

test('suggestTarget is null for a type nobody can convert', () => {
  assert.equal(setup().suggestTarget('xyz'), null);
});

test('findConverter and listTargets only report what is registered', () => {
  const services = setup();
  assert.equal(services.findConverter('png', 'webp').id, 'fake-image');
  assert.equal(services.findConverter('png', 'pdf'), null);
  assert.deepEqual(services.listTargets('jpg').sort(), ['png', 'webp']);
});

import { jobOptions } from '../js/ui/format.js';
import { validateOptions } from '../js/converters/image-core.js';

test('jobOptions turns the card settings into what the image converter accepts', () => {
  const opts = jobOptions({ quality: 0.85, maxWidth: null, maxKB: null, stripMetadata: true });
  assert.equal(opts.quality, 85);
  assert.ok(!('maxWidth' in opts) && !('maxKB' in opts));
  assert.equal(validateOptions(opts, 'jpg').ok, true);
  assert.equal(validateOptions(jobOptions({ quality: 0.5, maxWidth: 800, maxKB: 200 }), 'jpg').ok, true);
});

test('jobOptions keeps quality inside 1 to 100', () => {
  assert.equal(jobOptions({ quality: 0.001 }).quality, 1);
  assert.equal(jobOptions({ quality: 1 }).quality, 100);
});

import { growNote } from '../js/ui/format.js';

test('growNote explains growth honestly and stays silent otherwise', () => {
  assert.equal(growNote('png', 'webp', 100, 50), '');
  assert.match(growNote('svg', 'png', 167, 30000), /vector/i);
  assert.match(growNote('jpg', 'png', 100, 400), /PNG keeps every pixel/);
  assert.match(growNote('jpg', 'webp', 100, 120), /lower quality/);
  // the quality tip is for pictures only
  assert.equal(growNote('md', 'html', 100, 900), '');
  assert.equal(growNote('txt', 'pdf', 100, 900), '');
  assert.equal(growNote('csv', 'json', 100, 900), '');
});
