import { getAllPresets, saveMyPreset, toSavedPreset, validatePreset } from '../presets.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function field(labelText, value, type, min, max, step) {
  const wrap = element('label', 'lc-preset-field');
  wrap.append(element('span', '', labelText));
  const input = element('input', '');
  input.type = type;
  input.value = value === null ? '' : String(value);
  if (type === 'number') {
    input.min = String(min ?? 0);
    if (max !== undefined && max !== null) input.max = String(max);
    input.step = String(step ?? 1);
  }
  wrap.append(input);
  return { wrap, input };
}

function describePreset(preset) {
  if (preset.id === 'email-10mb') return 'Batch guidance: keep the combined output below 10 MB. It does not guarantee a particular email provider limit.';
  if (preset.toExt === 'pdf' && preset.kind === 'target-size') return 'PDF size target. The project compression path can rasterize page text; read the converter warning before applying.';
  if (preset.group === 'Social' && preset.id === 'whatsapp-friendly') return 'Long side up to 1600 px; exports as WebP. Change the extension to JPG if needed. The queue should interpret 1600 px as the longest side.';
  if (preset.kind === 'target-size') return `Target size: ${preset.maxKB} KB maximum. Actual results depend on the file and available encoder.`;
  if (preset.maxWidth) return `Format: ${preset.toExt.toUpperCase()}, with the longer working width limited by this preset to ${preset.maxWidth} px.`;
  return `Output: ${preset.toExt === 'original' ? 'keep the original format' : preset.toExt.toUpperCase()}.`;
}

/** Render the preset catalogue. onApplyPreset should hand the selected values to the app's job queue. */
export function mountPresetsPage(container, { onApplyPreset, storage } = {}) {
  container.replaceChildren();
  container.classList.add('lc-page', 'lc-presets-page');

  const note = element('p', 'lc-preset-note', 'Portals change their rules. Check the size your form asks for and edit the preset.');
  const intro = element('p', 'lc-muted', 'Edit the values before using a preset. Save any version to My presets on this device.');
  const catalogue = element('div', 'lc-preset-groups');
  container.append(note, intro, catalogue);

  const render = () => {
    catalogue.replaceChildren();
    const all = getAllPresets(storage);
    const groups = ['Form-ready', 'Social', 'Email-friendly', 'Web', 'My presets'];
    for (const groupName of groups) {
      const groupPresets = all.filter((preset) => preset.group === groupName);
      if (!groupPresets.length) continue;
      const section = element('section', 'lc-preset-group');
      section.append(element('h2', 'lc-section-title', groupName));
      const cards = element('div', 'lc-preset-grid');
      for (const preset of groupPresets) cards.append(createPresetCard(preset));
      section.append(cards);
      catalogue.append(section);
    }
  };

  function createPresetCard(preset) {
    const card = element('article', 'lc-preset-card');
    const title = element('h3', 'lc-preset-title', preset.label);
    const description = element('p', 'lc-muted lc-preset-description', describePreset(preset));
    const fields = element('div', 'lc-preset-fields');
    const ext = field('Output extension', preset.toExt, 'text');
    ext.input.maxLength = 16;
    ext.input.autocomplete = 'off';
    const maxKB = field(preset.id === 'email-10mb' ? 'Combined batch max (KB)' : 'Max size (KB)', preset.maxKB, 'number', 1, 1_000_000, 1);
    const maxWidth = field('Max width (px)', preset.maxWidth, 'number', 1, 100_000, 1);
    const quality = field('Quality (0–1)', preset.quality, 'number', 0, 1, 0.01);
    fields.append(ext.wrap, maxKB.wrap, maxWidth.wrap, quality.wrap);

    const status = element('p', 'lc-preset-status', '');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'lc-preset-actions');
    const use = element('button', 'lc-button lc-button-secondary', 'Use preset');
    use.type = 'button';
    const save = element('button', 'lc-button lc-button-secondary', 'Save to My presets');
    save.type = 'button';

    const readEdited = () => {
      const readNumber = (input, original) => input.value.trim() === '' ? null : Number(input.value);
      return {
        id: preset.id,
        label: preset.label,
        group: preset.group,
        kind: preset.kind,
        toExt: ext.input.value.trim().toLowerCase(),
        maxKB: readNumber(maxKB.input, preset.maxKB),
        maxWidth: readNumber(maxWidth.input, preset.maxWidth),
        quality: readNumber(quality.input, preset.quality),
      };
    };

    const checkCurrent = () => {
      const validation = validatePreset(readEdited());
      if (!validation.valid) {
        status.textContent = validation.errors.join(' ');
        return false;
      }
      status.textContent = '';
      return true;
    };

    for (const input of [ext.input, maxKB.input, maxWidth.input, quality.input]) {
      input.addEventListener('input', checkCurrent);
    }

    use.addEventListener('click', () => {
      const selected = readEdited();
      const validation = validatePreset(selected);
      if (!validation.valid) {
        status.textContent = validation.errors.join(' ');
        return;
      }
      // Email-friendly is a batch-total threshold; the queue must apply it to the sum, not each file.
      if (typeof onApplyPreset === 'function') onApplyPreset({ ...selected });
      else container.dispatchEvent(new CustomEvent('lokalconver:apply-preset', { bubbles: true, detail: { preset: { ...selected } } }));
      status.textContent = 'Preset selected.';
    });

    save.addEventListener('click', () => {
      const candidate = toSavedPreset(readEdited());
      const result = saveMyPreset(candidate, storage);
      status.textContent = result.saved ? 'Saved in My presets on this device.' : result.errors.join(' ');
      if (result.saved) render();
    });

    actions.append(use, save);
    card.append(title, description, fields, actions, status);
    return card;
  }

  render();
  return { refresh: render };
}
