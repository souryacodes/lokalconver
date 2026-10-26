// The Reveal: after a file finishes, the new size counts down from the
// original ("12.4 MB to 1.1 MB, saved 91%") and the saving shows in green.
// With prefers-reduced-motion the final numbers appear at once.
import { formatBytes, describeChange, changeLabel } from './format.js';

const easeOut = (t) => 1 - (1 - t) ** 3;

// Put the right class on the saving: green when saved, amber when it grew.
export function paintChange(changeEl, kind) {
  changeEl.classList.toggle('is-saved', kind === 'saved');
  changeEl.classList.toggle('is-grew', kind === 'grew');
  changeEl.classList.toggle('is-same', kind === 'same');
}

export function paintFinal({ toEl, changeEl, bytesIn, bytesOut }) {
  const { kind, percent } = describeChange(bytesIn, bytesOut);
  toEl.textContent = formatBytes(bytesOut);
  changeEl.textContent = changeLabel(kind, percent);
  paintChange(changeEl, kind);
}

export function paintStart({ toEl, changeEl, bytesIn, bytesOut }) {
  const { kind } = describeChange(bytesIn, bytesOut);
  toEl.textContent = formatBytes(bytesIn);
  changeEl.textContent = changeLabel(kind, 0);
  paintChange(changeEl, kind);
}

// Returns a function that stops the animation and jumps to the final numbers.
export function animateReveal(parts, { duration = 800, onDone } = {}) {
  const { toEl, changeEl, bytesIn, bytesOut } = parts;
  const { kind, percent } = describeChange(bytesIn, bytesOut);
  const begin = performance.now();
  let raf = 0;
  let stopped = false;

  const finish = () => { paintFinal(parts); onDone?.(); };
  const frame = (now) => {
    if (stopped) return;
    const t = Math.min(1, (now - begin) / duration);
    const e = easeOut(t);
    toEl.textContent = formatBytes(bytesIn + (bytesOut - bytesIn) * e);
    if (kind !== 'same') changeEl.textContent = changeLabel(kind, Math.round(percent * e));
    if (t < 1) raf = requestAnimationFrame(frame); else finish();
  };
  raf = requestAnimationFrame(frame);
  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    paintFinal(parts);
  };
}
