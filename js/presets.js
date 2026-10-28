/**
 * Editable conversion presets. Values are plain data so the UI can change them
 * without changing the defaults shipped with the application.
 */
export const PRESETS_STORAGE_KEY = 'lokalconver.myPresets.v1';
export const PRESET_GROUPS = ['Form-ready', 'Social', 'Email-friendly', 'Web'];
export const PRESET_KINDS = ['target-size', 'format'];

export const presets = [
  { id: 'photo-50kb', label: 'Photo under 50 KB', group: 'Form-ready', kind: 'target-size', toExt: 'jpg', maxKB: 50, maxWidth: 1600, quality: 0.82 },
  { id: 'signature-20kb', label: 'Signature under 20 KB', group: 'Form-ready', kind: 'target-size', toExt: 'jpg', maxKB: 20, maxWidth: 1200, quality: 0.78 },
  { id: 'photo-200kb', label: 'Photo under 200 KB', group: 'Form-ready', kind: 'target-size', toExt: 'jpg', maxKB: 200, maxWidth: 2400, quality: 0.88 },
  { id: 'pdf-500kb', label: 'PDF under 500 KB', group: 'Form-ready', kind: 'target-size', toExt: 'pdf', maxKB: 500, maxWidth: null, quality: 0.80 },
  { id: 'pdf-1mb', label: 'PDF under 1 MB', group: 'Form-ready', kind: 'target-size', toExt: 'pdf', maxKB: 1024, maxWidth: null, quality: 0.82 },
  { id: 'pdf-2mb', label: 'PDF under 2 MB', group: 'Form-ready', kind: 'target-size', toExt: 'pdf', maxKB: 2048, maxWidth: null, quality: 0.85 },
  { id: 'custom-size', label: 'Custom size', group: 'Form-ready', kind: 'target-size', toExt: 'jpg', maxKB: 100, maxWidth: 2400, quality: 0.85 },
  { id: 'whatsapp-friendly', label: 'WhatsApp-friendly', group: 'Social', kind: 'format', toExt: 'webp', maxKB: null, maxWidth: 1600, quality: 0.82 },
  { id: 'instagram-post', label: 'Instagram post', group: 'Social', kind: 'format', toExt: 'jpg', maxKB: null, maxWidth: 1080, quality: 0.88 },
  { id: 'instagram-story', label: 'Instagram story', group: 'Social', kind: 'format', toExt: 'jpg', maxKB: null, maxWidth: 1080, quality: 0.88 },
  { id: 'email-10mb', label: 'Email-friendly: total under 10 MB', group: 'Email-friendly', kind: 'format', toExt: 'original', maxKB: 10240, maxWidth: null, quality: 0.85 },
  { id: 'webp-80', label: 'WebP 80', group: 'Web', kind: 'format', toExt: 'webp', maxKB: null, maxWidth: null, quality: 0.80 },
];

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isPositiveNumberOrNull(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/** Validate a preset before it is applied or persisted. */
export function validatePreset(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { valid: false, errors: ['Preset must be an object.'] };
  }

  if (typeof candidate.id !== 'string' || !candidate.id.trim()) errors.push('ID is required.');
  if (typeof candidate.label !== 'string' || !candidate.label.trim()) errors.push('Label is required.');
  if (typeof candidate.group !== 'string' || !candidate.group.trim()) errors.push('Group is required.');
  if (!PRESET_KINDS.includes(candidate.kind)) errors.push('Kind must be target-size or format.');
  if (typeof candidate.toExt !== 'string' || !/^(original|[a-z0-9][a-z0-9.+-]{0,15})$/i.test(candidate.toExt)) {
    errors.push('Output extension must be a short extension or original.');
  }
  if (!isPositiveNumberOrNull(candidate.maxKB)) errors.push('Max KB must be a positive number or null.');
  if (!isPositiveNumberOrNull(candidate.maxWidth)) errors.push('Max width must be a positive number or null.');
  if (typeof candidate.quality !== 'number' || !Number.isFinite(candidate.quality) || candidate.quality < 0 || candidate.quality > 1) {
    errors.push('Quality must be a number from 0 to 1.');
  }
  if (candidate.kind === 'target-size' && candidate.maxKB === null) {
    errors.push('A target-size preset needs a maximum size.');
  }
  return { valid: errors.length === 0, errors };
}

/** Read only validated, app-owned preset data from localStorage. */
export function loadMyPresets(storage) {
  const target = storageOrNull(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(PRESETS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({ ...item, group: 'My presets' }))
      .filter((item) => validatePreset(item).valid)
      .map((item) => ({ ...item }));
  } catch {
    return [];
  }
}

/** Save or replace a user preset. File names and file contents are not stored. */
export function saveMyPreset(candidate, storage) {
  const target = storageOrNull(storage);
  const preset = { ...candidate, group: 'My presets' };
  const validation = validatePreset(preset);
  if (!validation.valid) return { saved: false, errors: validation.errors };
  if (!target) return { saved: false, errors: ['Local storage is unavailable in this browser.'] };

  const existing = loadMyPresets(target);
  const updated = existing.filter((item) => item.id !== preset.id);
  updated.push(preset);
  try {
    target.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
    return { saved: true, preset: { ...preset }, errors: [] };
  } catch {
    return { saved: false, errors: ['The preset could not be saved in local storage.'] };
  }
}

export function deleteMyPreset(id, storage) {
  const target = storageOrNull(storage);
  if (!target) return false;
  const remaining = loadMyPresets(target).filter((item) => item.id !== id);
  try {
    target.setItem(PRESETS_STORAGE_KEY, JSON.stringify(remaining));
    return true;
  } catch {
    return false;
  }
}

export function getAllPresets(storage) {
  return [...presets.map((item) => ({ ...item })), ...loadMyPresets(storage)];
}

export function toSavedPreset(candidate) {
  const id = String(candidate.id || 'custom').startsWith('my-')
    ? String(candidate.id)
    : `my-${String(candidate.id || 'custom')}`;
  return { ...candidate, id, group: 'My presets' };
}

/**
 * "Total under N KB" for a batch: give each file a share of the budget in
 * proportion to its size. Returns one maxKB per file, or null for every file
 * when the files already fit (so nothing is squeezed for no reason).
 * Why proportional: a big photo needs more room than a small one.
 */
export function splitBatchBudget(totalKB, sizesInBytes) {
  const sizes = Array.isArray(sizesInBytes) ? sizesInBytes.map((n) => (Number.isFinite(n) && n > 0 ? n : 0)) : [];
  if (!(Number(totalKB) > 0) || sizes.length === 0) return sizes.map(() => null);
  const sumKB = sizes.reduce((a, b) => a + b, 0) / 1024;
  if (sumKB <= totalKB) return sizes.map(() => null);
  return sizes.map((bytes) => Math.max(1, Math.floor((totalKB * (bytes / 1024)) / sumKB)));
}
