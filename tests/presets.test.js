import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_GROUPS,
  PRESET_KINDS,
  PRESETS_STORAGE_KEY,
  presets,
  validatePreset,
  loadMyPresets,
  saveMyPreset,
  getAllPresets,
  toSavedPreset,
  deleteMyPreset,
} from '../js/presets.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
  clear() { this.#values.clear(); }
}

test('every built-in preset uses the expected editable object shape and validates', () => {
  const required = ['id', 'label', 'group', 'kind', 'toExt', 'maxKB', 'maxWidth', 'quality'].sort();
  assert.equal(presets.length, 12);
  for (const preset of presets) {
    assert.deepEqual(Object.keys(preset).sort(), required);
    assert.equal(validatePreset(preset).valid, true, `${preset.id}: ${validatePreset(preset).errors.join('; ')}`);
    assert.ok(PRESET_GROUPS.includes(preset.group));
    assert.ok(PRESET_KINDS.includes(preset.kind));
  }
});

test('requested form-ready, social, email and web presets exist', () => {
  const labels = presets.map((preset) => preset.label);
  for (const label of [
    'Photo under 50 KB', 'Signature under 20 KB', 'Photo under 200 KB',
    'PDF under 500 KB', 'PDF under 1 MB', 'PDF under 2 MB', 'Custom size',
    'WhatsApp-friendly', 'Instagram post', 'Instagram story',
    'Email-friendly: total under 10 MB', 'WebP 80',
  ]) assert.ok(labels.includes(label), `Missing ${label}`);
  assert.equal(presets.find((preset) => preset.id === 'whatsapp-friendly').maxWidth, 1600);
  assert.equal(presets.find((preset) => preset.id === 'webp-80').quality, 0.8);
});

test('validator rejects invalid target size, extension and quality', () => {
  const base = { id: 'test', label: 'Test', group: 'My presets', kind: 'target-size', toExt: 'jpg', maxKB: 20, maxWidth: null, quality: 0.8 };
  assert.equal(validatePreset(base).valid, true);
  assert.equal(validatePreset({ ...base, maxKB: null }).valid, false);
  assert.equal(validatePreset({ ...base, quality: 1.1 }).valid, false);
  assert.equal(validatePreset({ ...base, toExt: '../leak' }).valid, false);
});

test('My presets save, replace, load and delete from local storage only', () => {
  const storage = new MemoryStorage();
  const saved = toSavedPreset({ ...presets[0], maxKB: 45 });
  assert.equal(saveMyPreset(saved, storage).saved, true);
  assert.equal(storage.getItem(PRESETS_STORAGE_KEY) !== null, true);
  assert.equal(loadMyPresets(storage)[0].maxKB, 45);
  assert.equal(getAllPresets(storage).length, presets.length + 1);
  assert.equal(saveMyPreset({ ...saved, maxKB: 40 }, storage).saved, true);
  assert.equal(loadMyPresets(storage).length, 1);
  assert.equal(loadMyPresets(storage)[0].maxKB, 40);
  assert.equal(deleteMyPreset(saved.id, storage), true);
  assert.equal(loadMyPresets(storage).length, 0);
});

test('invalid saved presets in localStorage are ignored', () => {
  const storage = new MemoryStorage();
  storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify([{ id: 'bad', label: '', group: 'My presets', kind: 'magic', toExt: 'jpg', maxKB: 1, maxWidth: null, quality: 4 }]));
  assert.deepEqual(loadMyPresets(storage), []);
});

import { splitBatchBudget } from '../js/presets.js';

test('a batch that already fits gets no limit', () => {
  assert.deepEqual(splitBatchBudget(10240, [1024 * 1024, 2 * 1024 * 1024]), [null, null]);
});

test('a batch over the total gets shares in proportion to size and never above the total', () => {
  const MB = 1024 * 1024;
  const shares = splitBatchBudget(10240, [8 * MB, 8 * MB, 4 * MB]); // 20 MB into 10 MB
  assert.deepEqual(shares, [4096, 4096, 2048]);
  assert.ok(shares.reduce((a, b) => a + b, 0) <= 10240);
});

test('bad input to the budget helper is safe', () => {
  assert.deepEqual(splitBatchBudget(0, [1000]), [null]);
  assert.deepEqual(splitBatchBudget(100, []), []);
});
