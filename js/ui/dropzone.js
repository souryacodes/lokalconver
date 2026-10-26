// A drop area that also works with the keyboard (it is a real file input under the label).
// File names are put in with textContent only.
export function createDropzone({ title, hint, accept = '', multiple = true, onFiles }) {
  const label = document.createElement('label');
  label.className = 'lc-drop';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = hint;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = multiple;
  if (accept) input.accept = accept;
  label.append(strong, span, input);

  const pick = (list) => { const files = Array.from(list).filter((f) => f.size > 0 || f.type !== ''); if (files.length) onFiles(files); };
  input.addEventListener('change', () => { pick(input.files); input.value = ''; });
  for (const type of ['dragenter', 'dragover']) {
    label.addEventListener(type, (e) => { e.preventDefault(); label.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    label.addEventListener(type, (e) => { e.preventDefault(); label.classList.remove('is-over'); });
  }
  label.addEventListener('drop', (e) => pick(e.dataTransfer?.files ?? []));
  return label;
}
