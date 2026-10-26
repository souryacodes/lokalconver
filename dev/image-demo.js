// Manual test page for the image converter. Calls the converter directly,
// the same way the real app will. Text goes in with textContent only.
import { imageConverter } from '../js/converters/image.js';

const $ = (id) => document.getElementById(id);
const el = {
  file: $('file'), format: $('format'), quality: $('quality'), qualityOut: $('qualityOut'),
  resizeMode: $('resizeMode'), maxWidth: $('maxWidth'), maxHeight: $('maxHeight'), percent: $('percent'),
  background: $('background'), targetKB: $('targetKB'), convert: $('convert'), cancel: $('cancel'),
  status: $('status'), notes: $('notes'), result: $('result'), download: $('download'), preview: $('preview'),
};

let controller = null;
let resultUrl = null;

function fillFormats() {
  const previous = el.format.value;
  el.format.replaceChildren();
  for (const ext of imageConverter.to) {
    const option = document.createElement('option');
    option.value = ext;
    option.textContent = ext.toUpperCase();
    el.format.append(option);
  }
  if (previous && imageConverter.to.includes(previous)) el.format.value = previous;
}

function setStatus(text, kind = 'info') {
  el.status.textContent = text;
  el.status.dataset.kind = kind;
}

function readOptions() {
  const options = { quality: Number(el.quality.value), background: el.background.value };
  const mode = el.resizeMode.value;
  if (mode === 'max') {
    options.resize = {
      mode: 'max',
      maxWidth: el.maxWidth.value || undefined,
      maxHeight: el.maxHeight.value || undefined,
    };
  } else if (mode === 'percent') {
    options.resize = { mode: 'percent', percent: el.percent.value };
  }
  if (el.targetKB.value) options.maxKB = el.targetKB.value;
  return options;
}

function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} KB`;
}

async function convert() {
  const file = el.file.files[0];
  if (!file) {
    setStatus('Pick a picture first.', 'error');
    return;
  }
  controller = new AbortController();
  el.convert.disabled = true;
  el.cancel.disabled = false;
  el.notes.replaceChildren();
  el.result.textContent = '';
  el.download.hidden = true;
  el.preview.hidden = true;
  const toExt = el.format.value;
  const job = { file, toExt, options: readOptions() };
  const started = performance.now();
  try {
    const blob = await imageConverter.run(
      job,
      (value, text) => setStatus(`${Math.round(value * 100)}%  ${text ?? ''}`),
      controller.signal,
    );
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    const info = job.resultInfo;
    setStatus(`Done in ${seconds} s.`);
    el.result.textContent = `${file.name}: ${kb(file.size)} to ${toExt.toUpperCase()}: ${kb(blob.size)}, ${info.width}×${info.height}`
      + (info.quality ? `, quality ${info.quality}` : '');
    for (const note of job.notes ?? []) {
      const li = document.createElement('li');
      li.textContent = note;
      el.notes.append(li);
    }
    el.download.href = resultUrl;
    el.download.download = `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
    el.download.hidden = false;
    el.preview.src = resultUrl;
    el.preview.hidden = false;
  } catch (err) {
    if (err?.name === 'AbortError') setStatus('Cancelled.');
    else setStatus(err?.message || 'Something went wrong.', 'error');
    console.error(err);
  } finally {
    el.convert.disabled = false;
    el.cancel.disabled = true;
    controller = null;
  }
}

el.quality.addEventListener('input', () => { el.qualityOut.textContent = el.quality.value; });
el.convert.addEventListener('click', convert);
el.cancel.addEventListener('click', () => controller?.abort());

fillFormats();
imageConverter.ready.then(fillFormats); // AVIF appears here only if this browser can save it
