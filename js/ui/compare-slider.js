// Before/after slider. A real slider for keyboards and screen readers
// (role="slider", arrow keys) and a drag handle for mouse and touch.
// Shows a skeleton while both pictures decode. If either one cannot be shown
// (a HEIC original, for example) it calls onError and the card says so.
import { el } from './dom.js';

const STEP = 2;
const BIG_STEP = 10;

function whenLoaded(img) {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('This picture cannot be shown in the browser.'));
  });
}

export function createCompareSlider({ beforeBlob, afterBlob, onError }) {
  const beforeUrl = URL.createObjectURL(beforeBlob);
  const afterUrl = URL.createObjectURL(afterBlob);
  let dead = false;
  let dragging = false;

  const skeleton = el('div', { class: 'cv-skeleton cv-compare__skeleton', 'aria-hidden': 'true' });
  const afterImg = el('img', { class: 'cv-compare__img', alt: '', draggable: 'false', decoding: 'async' });
  const beforeImg = el('img', { class: 'cv-compare__img cv-compare__img--before', alt: '', draggable: 'false', decoding: 'async' });
  const handle = el('div', {
    class: 'cv-compare__handle', role: 'slider', tabindex: '0',
    'aria-label': 'Compare the original and the converted picture',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50',
  });
  const stage = el('div', { class: 'cv-compare__stage', hidden: true },
    afterImg, beforeImg,
    el('span', { class: 'cv-compare__tag cv-compare__tag--before', 'aria-hidden': 'true', text: 'Before' }),
    el('span', { class: 'cv-compare__tag cv-compare__tag--after', 'aria-hidden': 'true', text: 'After' }),
    handle);
  const root = el('div', { class: 'cv-compare is-loading' }, skeleton, stage);

  function setPos(percent) {
    const p = Math.max(0, Math.min(100, percent));
    stage.style.setProperty('--pos', `${p}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(p)));
    handle.setAttribute('aria-valuetext', `${Math.round(p)}% of the original is showing`);
  }
  setPos(50);

  const posFrom = (e) => {
    const rect = stage.getBoundingClientRect();
    return rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 50;
  };

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    stage.setPointerCapture?.(e.pointerId);
    setPos(posFrom(e));
    handle.focus({ preventScroll: true });
  });
  stage.addEventListener('pointermove', (e) => { if (dragging) setPos(posFrom(e)); });
  const stop = (e) => { dragging = false; stage.releasePointerCapture?.(e.pointerId); };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);

  handle.addEventListener('keydown', (e) => {
    const now = Number(handle.getAttribute('aria-valuenow'));
    const step = e.shiftKey ? BIG_STEP : STEP;
    const next = {
      ArrowLeft: now - step, ArrowDown: now - step, ArrowRight: now + step, ArrowUp: now + step,
      PageDown: now - BIG_STEP, PageUp: now + BIG_STEP, Home: 0, End: 100,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setPos(next);
  });

  const ready = Promise.all([whenLoaded(beforeImg), whenLoaded(afterImg)]); // handlers first, then src
  beforeImg.src = beforeUrl;
  afterImg.src = afterUrl;
  ready.then(() => {
    if (dead) return;
    const w = afterImg.naturalWidth || 4;
    const h = afterImg.naturalHeight || 3;
    stage.style.setProperty('--ar-w', String(w));
    stage.style.setProperty('--ar-h', String(h));
    skeleton.remove();
    stage.hidden = false;
    root.classList.remove('is-loading');
  }).catch((err) => { if (!dead) onError?.(err); });

  return {
    el: root,
    destroy() {
      dead = true;
      beforeImg.removeAttribute('src');
      afterImg.removeAttribute('src');
      URL.revokeObjectURL(beforeUrl);
      URL.revokeObjectURL(afterUrl);
      root.remove();
    },
  };
}
