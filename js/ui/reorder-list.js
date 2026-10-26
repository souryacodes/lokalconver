// js/ui/reorder-list.js
// A list the visitor can put in order: drag the handle (mouse, pen or
// finger), press the arrow keys on the handle, or use the up/down buttons.
// Used for "Images to PDF" and "Merge PDFs".
//
// WHY not the HTML5 drag-and-drop API: it does not work with a finger on
// most phones. Pointer Events work everywhere, so one code path serves
// mouse and touch. WHY buttons too: dragging is not possible for everyone.
//
// File names are untrusted text. They only ever go in with textContent.

import { moveItem } from '../converters/pdf-utils.js';

// items: [{ id, name, detail? }]   (id must be unique; detail is small text,
//                                   for example "2.4 MB")
// onChange(items): called with the new order after every change.
export function createReorderList({ items, onChange = () => {}, label = 'Files in order' }) {
  let current = [...items];

  const root = document.createElement('div');
  root.className = 'reorder';

  const list = document.createElement('ol');
  list.className = 'reorder__list';
  list.setAttribute('aria-label', label);

  // A polite announcement for screen readers after each move.
  const live = document.createElement('p');
  live.className = 'reorder__live';
  live.setAttribute('role', 'status');

  root.append(list, live);

  function announce(text) {
    live.textContent = '';
    // A tiny delay makes screen readers read the same text twice in a row.
    setTimeout(() => {
      live.textContent = text;
    }, 30);
  }

  function emit() {
    onChange([...current]);
  }

  // --------------------------------------------------------------- moving

  function moveTo(index, newIndex, focusKind = 'handle') {
    const target = Math.max(0, Math.min(current.length - 1, newIndex));
    if (target === index) return;
    const item = current[index];
    current = moveItem(current, index, target);
    render();
    focusItem(item.id, focusKind, target);
    announce(`Moved ${item.name} to position ${target + 1} of ${current.length}.`);
    emit();
  }

  function removeAt(index) {
    const [item] = current.splice(index, 1);
    current = [...current];
    render();
    const next = current[Math.min(index, current.length - 1)];
    if (next) focusItem(next.id, 'handle');
    announce(`Removed ${item.name}. ${current.length} left.`);
    emit();
  }

  function focusItem(id, kind, newIndex) {
    const row = list.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
    if (!row) return;
    let button = row.querySelector(`[data-kind="${kind}"]`);
    // The button we used may be disabled now (item reached the end).
    if (!button || button.disabled) button = row.querySelector('[data-kind="handle"]');
    button?.focus();
    return newIndex;
  }

  // ------------------------------------------------------------- dragging

  function startDrag(event, row, index) {
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.currentTarget;
    const rows = [...list.children];
    const centers = rows.map((r) => {
      const box = r.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    const rowHeight = rows[index].getBoundingClientRect().height;
    const startY = event.clientY;
    let newIndex = index;

    handle.setPointerCapture(event.pointerId);
    row.classList.add('reorder__item--dragging');

    function onMove(e) {
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      // Where would the dragged row land? Count the other rows whose centre
      // is above the dragged row's centre.
      const draggedCenter = centers[index] + dy;
      newIndex = centers.filter((c, i) => i !== index && c < draggedCenter).length;
      // Open a gap by sliding the rows in between.
      rows.forEach((r, i) => {
        if (i === index) return;
        let shift = 0;
        if (newIndex > index && i > index && i <= newIndex) shift = -rowHeight;
        if (newIndex < index && i >= newIndex && i < index) shift = rowHeight;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }

    function finish(e) {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      rows.forEach((r) => {
        r.style.transform = '';
      });
      row.classList.remove('reorder__item--dragging');
      // A cancelled gesture (for example the browser took over) changes nothing.
      if (e.type === 'pointerup') moveTo(index, newIndex);
    }

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  // ------------------------------------------------------------ rendering

  function makeButton(kind, text, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind === 'handle' ? 'reorder__handle' : 'reorder__btn';
    button.dataset.kind = kind;
    button.textContent = text;
    button.setAttribute('aria-label', ariaLabel);
    return button;
  }

  function render() {
    const rows = current.map((item, index) => {
      const row = document.createElement('li');
      row.className = 'reorder__item';
      row.dataset.id = String(item.id);

      const handle = makeButton(
        'handle',
        '\u2807', // braille dots: a drag grip that needs no icon file
        `Position ${index + 1} of ${current.length}: ${item.name}. Drag, or press the up and down arrow keys, to move.`,
      );
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startDrag(e, row, index);
      });
      handle.addEventListener('keydown', (e) => {
        const keys = {
          ArrowUp: index - 1,
          ArrowDown: index + 1,
          Home: 0,
          End: current.length - 1,
        };
        if (!(e.key in keys)) return;
        e.preventDefault();
        moveTo(index, keys[e.key]);
      });

      const number = document.createElement('span');
      number.className = 'reorder__num';
      number.textContent = String(index + 1);
      number.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'reorder__text';
      const name = document.createElement('span');
      name.className = 'reorder__name';
      name.textContent = item.name;
      text.append(name);
      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'reorder__detail';
        detail.textContent = item.detail;
        text.append(detail);
      }

      const up = makeButton('up', '\u2191', `Move ${item.name} up`);
      up.disabled = index === 0;
      up.addEventListener('click', () => moveTo(index, index - 1, 'up'));

      const down = makeButton('down', '\u2193', `Move ${item.name} down`);
      down.disabled = index === current.length - 1;
      down.addEventListener('click', () => moveTo(index, index + 1, 'down'));

      const remove = makeButton('remove', '\u00d7', `Remove ${item.name}`);
      remove.addEventListener('click', () => removeAt(index));

      row.append(handle, number, text, up, down, remove);
      return row;
    });
    list.replaceChildren(...rows);
  }

  render();

  return {
    element: root,
    getItems: () => [...current],
    setItems(next) {
      current = [...next];
      render();
    },
  };
}
