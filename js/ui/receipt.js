export const STATS_STORAGE_KEY = 'lokalconver.personalStats.v1';
export const PROCESSED_BATCHES_KEY = 'lokalconver.processedBatches.v1';

function storageOrNull(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function finiteByteCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function bytesInFor(job) {
  if (finiteByteCount(job?.bytesIn)) return job.bytesIn;
  if (finiteByteCount(job?.file?.size)) return job.file.size;
  return null;
}

function bytesOutFor(job) {
  if (finiteByteCount(job?.bytesOut)) return job.bytesOut;
  if (finiteByteCount(job?.resultBlob?.size)) return job.resultBlob.size;
  return null;
}

/** Use only output counters or Blob sizes measured by the app; failed jobs are excluded. */
export function computeReceiptMetrics(jobs) {
  const completed = Array.isArray(jobs) ? jobs.filter((job) => job && (job.status === undefined || job.status === 'done')) : [];
  const measured = completed.map((job) => ({ input: bytesInFor(job), output: bytesOutFor(job) }))
    .filter((item) => finiteByteCount(item.input) && finiteByteCount(item.output));
  const totalIn = measured.reduce((sum, item) => sum + item.input, 0);
  const totalOut = measured.reduce((sum, item) => sum + item.output, 0);
  return { files: measured.length, totalIn, totalOut, spaceSaved: totalIn - totalOut, uploadedBytes: 0 };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Not available';
  const sign = bytes < 0 ? '−' : '';
  const amount = Math.abs(bytes);
  if (amount < 1024) return `${sign}${Math.round(amount)} B`;
  if (amount < 1024 * 1024) return `${sign}${(amount / 1024).toFixed(amount < 10 * 1024 ? 1 : 0)} KB`;
  return `${sign}${(amount / (1024 * 1024)).toFixed(amount < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

function dateLabel(date) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function buildReceiptText(metrics, date = new Date()) {
  const savedText = metrics.spaceSaved < 0
    ? `Space saved: ${formatBytes(metrics.spaceSaved)} (output grew)`
    : `Space saved: ${formatBytes(metrics.spaceSaved)}`;
  return [
    'LokalConver',
    'Conversion receipt',
    `Files: ${metrics.files}`,
    `Total in: ${formatBytes(metrics.totalIn)}`,
    `Total out: ${formatBytes(metrics.totalOut)}`,
    savedText,
    `${metrics.uploadedBytes ?? 0} bytes uploaded`,
    `Date: ${dateLabel(date)}`,
  ].join('\n');
}

function canvasRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawReceiptCanvas(metrics, date = new Date()) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  const background = ctx.createLinearGradient(0, 0, 1200, 630);
  background.addColorStop(0, '#07090F');
  background.addColorStop(1, '#151B30');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#7C5CFF';
  ctx.beginPath();
  ctx.arc(1075, 95, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22D3EE';
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(1110, 125, 55, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  canvasRoundRect(ctx, 54, 48, 1092, 534, 28);
  ctx.strokeStyle = 'rgba(222,230,255,0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#EDEFF8';
  ctx.font = '700 27px system-ui, sans-serif';
  ctx.fillText('LokalConver', 92, 105);
  ctx.fillStyle = '#9DA9CD';
  ctx.font = '500 18px system-ui, sans-serif';
  ctx.fillText('CONVERSION RECEIPT', 92, 143);
  ctx.fillStyle = '#EDEFF8';
  ctx.font = '700 43px system-ui, sans-serif';
  ctx.fillText(`${metrics.files} ${metrics.files === 1 ? 'file' : 'files'} processed`, 92, 215);

  const stats = [
    ['TOTAL IN', formatBytes(metrics.totalIn)],
    ['TOTAL OUT', formatBytes(metrics.totalOut)],
    ['SPACE SAVED', metrics.spaceSaved < 0 ? `${formatBytes(metrics.spaceSaved)} · output grew` : formatBytes(metrics.spaceSaved)],
  ];
  const starts = [92, 438, 784];
  for (let index = 0; index < stats.length; index += 1) {
    const [label, value] = stats[index];
    const x = starts[index];
    ctx.fillStyle = '#8E97B8';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText(label, x, 285);
    ctx.fillStyle = '#EDEFF8';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(value, x, 331);
  }

  ctx.fillStyle = '#34D399';
  ctx.font = '700 24px system-ui, sans-serif';
  ctx.fillText(`${metrics.uploadedBytes ?? 0} bytes uploaded`, 92, 417);
  ctx.fillStyle = '#AEB7D3';
  ctx.font = '500 19px system-ui, sans-serif';
  ctx.fillText(dateLabel(date), 92, 466);
  ctx.fillStyle = '#8E97B8';
  ctx.font = '400 16px system-ui, sans-serif';
  ctx.fillText('Files processed on your device', 92, 525);
  return canvas;
}

function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The receipt PNG could not be created.'));
    }, 'image/png');
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function createReceiptPng(jobs, date = new Date()) {
  const metrics = computeReceiptMetrics(jobs);
  const canvas = drawReceiptCanvas(metrics, date);
  const blob = await canvasToPng(canvas);
  return { blob, metrics, text: buildReceiptText(metrics, date), canvas };
}

/** Share a generated PNG only when file sharing is explicitly supported; otherwise download it. */
export async function makeReceipt(jobs, { date = new Date(), navigatorObject = globalThis.navigator } = {}) {
  if (computeReceiptMetrics(jobs).files === 0) throw new Error('There are no finished files with measured sizes yet, so there is nothing to put on a receipt.');
  const receipt = await createReceiptPng(jobs, date);
  let file = null;
  let shareSupported = false;
  if (typeof globalThis.File === 'function'
      && typeof navigatorObject?.share === 'function'
      && typeof navigatorObject?.canShare === 'function') {
    file = new globalThis.File([receipt.blob], 'lokalconver-receipt.png', { type: 'image/png' });
    try { shareSupported = navigatorObject.canShare({ files: [file] }); } catch { shareSupported = false; }
  }
  if (shareSupported && file) {
    await navigatorObject.share({ files: [file], title: 'LokalConver receipt', text: receipt.text });
    return { ...receipt, action: 'shared' };
  }
  downloadBlob(receipt.blob, 'lokalconver-receipt.png');
  return { ...receipt, action: 'downloaded' };
}

function readStoredObject(storage, key, fallback) {
  const target = storageOrNull(storage);
  if (!target) return { ...fallback };
  try {
    const parsed = JSON.parse(target.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function readPersonalStats(storage) {
  const stats = readStoredObject(storage, STATS_STORAGE_KEY, { filesConverted: 0, bytesSaved: 0 });
  return {
    filesConverted: Number.isFinite(stats.filesConverted) && stats.filesConverted >= 0 ? stats.filesConverted : 0,
    bytesSaved: Number.isFinite(stats.bytesSaved) ? stats.bytesSaved : 0,
  };
}

export function resetPersonalStats(storage) {
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.removeItem(STATS_STORAGE_KEY);
    target.removeItem(PROCESSED_BATCHES_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Call once per completed batch. The optional opaque batch ID prevents accidental double counting. */
export function recordBatchStats(jobs, { batchId, storage } = {}) {
  const target = storageOrNull(storage);
  if (!target) return { saved: false, error: 'Local storage is unavailable.' };
  const metrics = computeReceiptMetrics(jobs);
  const processed = readStoredObject(target, PROCESSED_BATCHES_KEY, { ids: [] });
  const ids = Array.isArray(processed.ids) ? processed.ids.filter((id) => typeof id === 'string') : [];
  if (batchId && ids.includes(batchId)) return { saved: true, duplicate: true, stats: readPersonalStats(target) };

  const current = readPersonalStats(target);
  const next = {
    filesConverted: current.filesConverted + metrics.files,
    bytesSaved: current.bytesSaved + metrics.spaceSaved,
  };
  try {
    target.setItem(STATS_STORAGE_KEY, JSON.stringify(next));
    if (batchId) {
      const nextIds = [...ids.filter((id) => id !== batchId), batchId].slice(-100);
      target.setItem(PROCESSED_BATCHES_KEY, JSON.stringify({ ids: nextIds }));
    }
    return { saved: true, duplicate: false, stats: next };
  } catch {
    return { saved: false, error: 'Stats could not be saved in local storage.' };
  }
}

/** Mount this button only after the application has a completed batch. */
export function createReceiptButton(container, jobsProvider, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lc-button lc-button-secondary';
  button.textContent = 'Make a receipt';
  const status = document.createElement('p');
  status.className = 'lc-receipt-status';
  status.setAttribute('aria-live', 'polite');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Preparing receipt…';
    status.textContent = '';
    try {
      const jobs = typeof jobsProvider === 'function' ? jobsProvider() : jobsProvider;
      const result = await makeReceipt(jobs, options);
      status.textContent = result.action === 'shared' ? 'Receipt shared.' : 'Receipt PNG downloaded.';
    } catch (error) {
      if (error?.name === 'AbortError') status.textContent = 'Sharing cancelled.';
      else status.textContent = error instanceof Error ? error.message : 'The receipt could not be created.';
    } finally {
      button.disabled = false;
      button.textContent = 'Make a receipt';
    }
  });
  container.append(button, status);
  return { button, status };
}
