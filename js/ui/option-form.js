// option-form.js - draws the settings of a converter from its option list.
//
// A converter that has settings of its own (the PDF tools do) describes them as a plain list:
//   { key, label, type: 'choice' | 'number' | 'text' | 'color', default, choices?, min?, max?, step?, onlyWhen? }
// This file turns that list into form fields, so the Convert page and the PDF tools page show
// the same controls and no converter needs its own form code.
//
//   onlyWhen: { otherKey: [allowed values] }  show the field only while that other setting has one of these values.
//             The special key "toExt" is the format being made (for example "jpg").
//
// Everything is built with createElement. Labels come from our own lists, and the values the visitor
// types are only ever set as .value, never as HTML.
import { el } from './dom.js';

// What a value is right now: what the visitor chose, or the default.
export function valueOf(item, values) {
  return values[item.key] !== undefined ? values[item.key] : item.default;
}

// The fields that apply right now. `context` carries facts that are not settings, such as { toExt: 'jpg' }.
export function visibleItems(spec, values = {}, context = {}, hide = []) {
  const all = { ...context };
  for (const item of spec) all[item.key] = valueOf(item, values);
  return spec.filter((item) => {
    if (hide.includes(item.key)) return false;
    if (!item.onlyWhen) return true;
    return Object.entries(item.onlyWhen).every(([key, allowed]) => allowed.map(String).includes(String(all[key])));
  });
}

// Quality is stored as 0.4 - 1 but shown as a percentage, which is how people think about it.
const asPercent = (item) => item.key === 'quality';

function makeControl(item, id, current, set) {
  if (item.type === 'choice') {
    const select = el('select', { id });
    for (const choice of item.choices) {
      const option = el('option', { value: String(choice.value), text: choice.label });
      if (String(choice.value) === String(current)) option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const match = item.choices.find((c) => String(c.value) === select.value);
      set(match ? match.value : item.default, true);
    });
    return { control: select };
  }
  if (item.type === 'number' && asPercent(item)) {
    const out = el('output', { for: id, text: `${Math.round(current * 100)}%` });
    const range = el('input', {
      id, type: 'range', min: String(Math.round(item.min * 100)), max: String(Math.round(item.max * 100)),
      step: String(Math.max(1, Math.round((item.step ?? 0.05) * 100))), value: String(Math.round(current * 100)),
    });
    range.addEventListener('input', () => {
      out.textContent = `${range.value}%`;
      set(Number(range.value) / 100, false);
    });
    return { control: range, extra: out };
  }
  if (item.type === 'number') {
    const input = el('input', {
      id, type: 'number', inputmode: 'numeric', min: String(item.min), max: String(item.max),
      step: String(item.step ?? 1), value: String(current),
    });
    input.addEventListener('input', () => {
      const n = input.value.trim() === '' ? NaN : Number(input.value);
      // A value we cannot use is not stored, so the converter keeps its default. Limits are applied by the converter.
      set(Number.isFinite(n) ? n : undefined, false);
    });
    return { control: input };
  }
  if (item.type === 'color') {
    const input = el('input', { id, type: 'color', value: String(current) });
    input.addEventListener('input', () => set(input.value, false));
    return { control: input };
  }
  const input = el('input', { id, type: 'text', value: String(current ?? ''), autocomplete: 'off', spellcheck: 'false', placeholder: item.placeholder ?? null });
  input.addEventListener('input', () => set(input.value, false));
  return { control: input };
}

/**
 * Fill `host` with the fields for `spec`.
 *   values:   the object the visitor's choices are written to (item.options.extra, for example)
 *   context:  { toExt } and similar facts used by onlyWhen
 *   hide:     keys to leave out
 *   onChange: called after every change
 * Returns { refresh() } to draw the fields again (for example after `context` changed).
 */
export function mountOptionFields({ host, spec, values, context = {}, hide = [], idPrefix = 'opt', onChange = () => {} }) {
  function draw(focusKey) {
    const fields = visibleItems(spec, values, context, hide).map((item) => {
      const id = `${idPrefix}-${item.key}`;
      const set = (value, redraw) => {
        if (value === undefined) delete values[item.key];
        else values[item.key] = value;
        onChange(item.key, value);
        if (redraw) draw(item.key); // another field may appear or go away
      };
      const { control, extra } = makeControl(item, id, valueOf(item, values), set);
      return el('div', { class: 'cv-field', dataset: { key: item.key } }, el('label', { for: id, text: item.label }), control, extra);
    });
    host.replaceChildren(...fields);
    if (focusKey) host.querySelector(`#${CSS.escape(`${idPrefix}-${focusKey}`)}`)?.focus();
  }
  draw();
  return { refresh: () => draw() };
}
