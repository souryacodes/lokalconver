import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReceiptMetrics,
  formatBytes,
  buildReceiptText,
  recordBatchStats,
  readPersonalStats,
  STATS_STORAGE_KEY,
  resetPersonalStats,
  makeReceipt,
} from '../js/ui/receipt.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
  clear() { this.#values.clear(); }
}

test('receipt maths uses actual completed-file counters and ignores failed jobs', () => {
  const metrics = computeReceiptMetrics([
    { status: 'done', bytesIn: 1024, bytesOut: 512 },
    { status: 'done', file: { size: 2048 }, resultBlob: { size: 1024 } },
    { status: 'error', bytesIn: 9000, bytesOut: 10 },
    { status: 'done', bytesIn: 100, bytesOut: undefined },
  ]);
  assert.deepEqual(metrics, { files: 2, totalIn: 3072, totalOut: 1536, spaceSaved: 1536, uploadedBytes: 0 });
});

test('receipt maths retains negative savings when output grows', () => {
  const metrics = computeReceiptMetrics([{ status: 'done', bytesIn: 100, bytesOut: 140 }]);
  assert.equal(metrics.spaceSaved, -40);
  assert.match(buildReceiptText(metrics, new Date(2026, 9, 26)), /Space saved: −40 B \(output grew\)/);
});

test('receipt text carries all requested values and zero uploaded bytes', () => {
  const metrics = computeReceiptMetrics([
    { status: 'done', bytesIn: 4096, bytesOut: 1024 },
    { status: 'done', bytesIn: 2048, bytesOut: 512 },
  ]);
  const text = buildReceiptText(metrics, new Date(2026, 9, 26));
  assert.match(text, /Files: 2/);
  assert.match(text, /Total in: 6\.0 KB/);
  assert.match(text, /Total out: 1\.5 KB/);
  assert.match(text, /Space saved: 4\.5 KB/);
  assert.match(text, /0 bytes uploaded/);
  assert.match(text, /Date:/);
});

test('byte formatter handles bytes, KB, MB and negative amounts', () => {
  assert.equal(formatBytes(10), '10 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.00 MB');
  assert.equal(formatBytes(-12), '−12 B');
});

test('personal stats stay in local storage and batch IDs avoid duplicate counting', () => {
  const storage = new MemoryStorage();
  const jobs = [{ status: 'done', bytesIn: 2048, bytesOut: 1024 }];
  assert.equal(recordBatchStats(jobs, { batchId: 'batch-a', storage }).stats.filesConverted, 1);
  const second = recordBatchStats(jobs, { batchId: 'batch-a', storage });
  assert.equal(second.duplicate, true);
  assert.deepEqual(readPersonalStats(storage), { filesConverted: 1, bytesSaved: 1024 });
  assert.ok(storage.getItem(STATS_STORAGE_KEY));
});


test('personal stats have a reset action that clears only stats storage keys', () => {
  const storage = new MemoryStorage();
  recordBatchStats([{ status: 'done', bytesIn: 2048, bytesOut: 1024 }], { batchId: 'batch-a', storage });
  assert.equal(resetPersonalStats(storage), true);
  assert.deepEqual(readPersonalStats(storage), { filesConverted: 0, bytesSaved: 0 });
});

test('no receipt is made when no file has measured sizes', async () => {
  await assert.rejects(() => makeReceipt([{ status: 'error', bytesIn: 1, bytesOut: 1 }]), /nothing to put on a receipt/);
});
