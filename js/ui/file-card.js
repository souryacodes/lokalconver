// One card per file. The card only DRAWS. All decisions (queue, cancel,
// download) live in convert.js and come in through the `handlers` object.
//
// item.state: 'loading' | 'ready' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'
import { el } from './dom.js';
import { icon } from './icons.js';
import { createCompareSlider } from './compare-slider.js';
import { animateReveal, paintFinal, paintStart } from './reveal.js';
import { mountOptionFields } from './option-form.js';
import {
  categoryOf, formatBytes, growNote, isImageExt, optionFields, revealText, TIER_HINT,
} from './format.js';

const ICON_FOR = { image: 'image', pdf: 'pdf', document: 'document', data: 'data', audio: 'audio', video: 'video', file: 'file' };

export function createCard(item, handlers) {
  const nameId = `cv-name-${item.id}`;
  const root = el('li', { class: 'cv-card' });
  const iconBox = el('span', { class: 'cv-card__icon', 'aria-hidden': 'true' });
  const nameEl = el('h3', { class: 'cv-card__name', id: nameId });
  const subEl = el('p', { class: 'cv-card__sub' });
  const removeBtn = el('button', { class: 'cv-icon-btn', type: 'button', onclick: () => handlers.onRemove(item) }, icon('x', 20));
  const body = el('div', { class: 'cv-card__body' });
  root.append(
    el('div', { class: 'cv-card__head' }, iconBox, el('div', { class: 'cv-card__meta' }, nameEl, subEl), removeBtn),
    body,
  );

  // things we must clean up when the card re-renders or goes away
  let compare = null;
  let observer = null;
  let stopReveal = null;
  let progressRefs = null;
  let raf = 0;
  let revealParts = null;

  function teardown() {
    observer?.disconnect();
    observer = null;
    compare?.destroy();
    compare = null;
    stopReveal?.();
    stopReveal = null;
    progressRefs = null;
    revealParts = null;
  }

  // ----- pieces of the body -----

  function skeletonBlock() {
    return el('div', { class: 'cv-skel-stack', 'aria-hidden': 'true' },
      el('div', { class: 'cv-skeleton cv-skeleton--btn' }),
      el('div', { class: 'cv-skeleton cv-skeleton--line' }));
  }

  function suggestBlock() {
    const target = item.target;
    const big = el('button', {
      class: 'cv-btn cv-btn--suggest', type: 'button',
      onclick: () => handlers.onConvert(item),
    }, icon('check', 22), el('span', { text: `Convert to ${target.toUpperCase()}` }));

    const others = item.targets.filter((t) => t !== target).map((t) => el('button', {
      class: 'cv-chip', type: 'button', text: t.toUpperCase(),
      'aria-label': `Change the format to ${t.toUpperCase()}`,
      onclick: () => handlers.onTarget(item, t),
    }));

    return el('div', { class: 'cv-suggest' },
      big,
      target === item.suggested ? el('p', { class: 'cv-suggest__caption', text: 'Suggested for this file' }) : null,
      others.length ? el('div', { class: 'cv-chips', role: 'group', 'aria-label': 'Other formats' }, others) : null);
  }

  // Said BEFORE converting: which engine, and what it costs to download.
  function engineBlock() {
    const info = item.engine;
    if (!info) return null;
    return el('p', { class: 'cv-engine' },
      el('span', { class: 'cv-tier', title: TIER_HINT[info.tier], text: `Tier ${info.tier}` }),
      el('span', { text: info.text }));
  }

  function field(label, input, extra) {
    return el('div', { class: 'cv-field' }, el('label', { for: input.id, text: label }), input, extra);
  }

  function numberInput(id, placeholder, value, min, max, onChange) {
    return el('input', {
      id, type: 'number', inputmode: 'numeric', min, max, step: '1', placeholder,
      value: value ?? null,
      oninput: (e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) && n > 0 ? Math.min(n, max) : null);
      },
    });
  }

  function optionsBlock() {
    const f = optionFields(item.fromExt, item.target);
    const spec = item.optionSpec; // settings of the converter itself (the PDF tools), or null
    if (!f.quality && !f.resize && !f.size && !spec) return null;
    const grid = el('div', { class: 'cv-options__grid' });
    const id = (name) => `cv-${name}-${item.id}`;

    if (f.quality) {
      const out = el('output', { for: id('q'), text: `${Math.round(item.options.quality * 100)}%` });
      const range = el('input', {
        id: id('q'), type: 'range', min: '10', max: '100', step: '5',
        value: String(Math.round(item.options.quality * 100)),
        oninput: (e) => {
          out.textContent = `${e.target.value}%`;
          handlers.onOptions(item, { quality: Number(e.target.value) / 100 });
        },
      });
      grid.append(field('Quality', range, out));
    }
    if (f.resize) {
      grid.append(field('Largest width (px)',
        numberInput(id('w'), 'Original size', item.options.maxWidth, '16', 20000, (v) => handlers.onOptions(item, { maxWidth: v }))));
    }
    if (f.size) {
      grid.append(field('Target size (KB)',
        numberInput(id('kb'), 'No limit', item.options.maxKB, '10', 100000, (v) => handlers.onOptions(item, { maxKB: v }))));
    }
    if (spec) {
      const host = el('div', { class: 'cv-options__extra' });
      grid.append(host);
      mountOptionFields({
        host, spec, values: item.options.extra, context: { toExt: item.target }, idPrefix: `cv-x-${item.id}`,
        // A preset such as "PDF under 500 KB" already chose the size goal.
        hide: item.options.maxKB ? ['targetKB'] : [],
      });
    }
    const details = el('details', { class: 'cv-options' }, el('summary', { text: 'Options' }), grid);
    details.open = Boolean(item.optionsOpen);
    details.addEventListener('toggle', () => { item.optionsOpen = details.open; });
    return details;
  }

  function progressBlock() {
    const bar = el('div', { class: 'cv-progress__bar' });
    const track = el('div', {
      class: 'cv-progress', role: 'progressbar', 'aria-label': `Converting ${item.name}`,
      'aria-valuemin': '0', 'aria-valuemax': '100',
    }, bar);
    const status = el('p', { class: 'cv-status' });
    progressRefs = { track, bar, status };
    paintProgress();
    return el('div', { class: 'cv-run' }, track, el('div', { class: 'cv-run__row' }, status,
      el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', text: 'Cancel', onclick: () => handlers.onCancel(item) })));
  }

  function paintProgress() {
    if (!progressRefs) return;
    const { track, bar, status } = progressRefs;
    const known = item.state === 'running' && item.progress > 0;
    track.classList.toggle('is-indeterminate', item.state === 'running' && !known);
    bar.style.transform = `scaleX(${known ? item.progress : 0})`;
    if (known) track.setAttribute('aria-valuenow', String(Math.round(item.progress * 100)));
    else track.removeAttribute('aria-valuenow');
    status.textContent = item.state === 'queued' ? 'Waiting in line'
      : item.phase === 'loading' ? 'Getting the engine ready'
      : known ? `Converting\u2026 ${Math.round(item.progress * 100)}%`
      : 'Converting\u2026';
  }

  function messageBlock(kind, text, actionLabel, actionIcon) {
    return el('div', { class: 'cv-msg-row' },
      el('p', { class: `cv-msg cv-msg--${kind}`, role: kind === 'error' ? 'alert' : null }, icon(kind === 'error' ? 'alert' : 'x', 18), el('span', { text })),
      el('button', { class: 'cv-btn cv-btn--ghost', type: 'button', onclick: () => handlers.onConvert(item) }, icon(actionIcon, 18), actionLabel));
  }

  function doneBlock() {
    const job = item.job;
    const toEl = el('span', { class: 'cv-reveal__to' });
    const changeEl = el('span', { class: 'cv-reveal__change' });
    revealParts = { toEl, changeEl, bytesIn: job.bytesIn, bytesOut: job.bytesOut };
    const reduced = handlers.reducedMotion();
    if (item.revealed || reduced) { paintFinal(revealParts); item.revealed = true; } else paintStart(revealParts);

    // The animated numbers are hidden from screen readers. They hear the final sentence once.
    const reveal = el('p', { class: 'cv-reveal' },
      el('span', { class: 'cv-sr', text: revealText(job.bytesIn, job.bytesOut) }),
      el('span', { class: 'cv-reveal__visual', 'aria-hidden': 'true' },
        el('span', { class: 'cv-reveal__from', text: formatBytes(job.bytesIn) }), ' to ', toEl, ', ', changeEl));

    const parts = [
      reveal,
      el('p', { class: 'cv-saved-as' }, 'Saved as ', el('strong', { text: item.outName })),
    ];
    const note = growNote(item.fromExt, item.target, job.bytesIn, job.bytesOut);
    if (note) parts.push(el('p', { class: 'cv-note', text: note }));
    for (const text of item.notes ?? []) parts.push(el('p', { class: 'cv-note', text: text }));

    if (isImageExt(item.fromExt) && isImageExt(item.target)) {
      const host = el('div', { class: 'cv-compare-host' }, el('div', { class: 'cv-skeleton cv-compare__skeleton', 'aria-hidden': 'true' }));
      parts.push(host);
      mountCompareWhenVisible(host);
    }

    const download = el('button', {
      class: 'cv-btn cv-btn--solid', type: 'button',
      'aria-label': `Download ${item.outName}`,
      onclick: () => handlers.onDownload(item),
    }, icon('download', 18), 'Download');
    parts.push(el('div', { class: 'cv-actions' }, download));
    return el('div', { class: 'cv-done' }, parts);
  }

  // Decoding two big photos for every card at once can use a lot of memory on a
  // phone, so each slider is built only when its card is near the screen.
  function mountCompareWhenVisible(host) {
    const build = () => {
      compare = createCompareSlider({
        beforeBlob: item.file,
        afterBlob: item.job.resultBlob,
        onError: () => {
          compare?.destroy();
          compare = null;
          host.replaceChildren(el('p', { class: 'cv-note', text: 'Your browser cannot show a preview of this picture. The converted file is ready to download.' }));
        },
      });
      host.replaceChildren(compare.el);
    };
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        observer = null;
        build();
      }, { rootMargin: '300px' });
      observer.observe(host);
    } else {
      build();
    }
  }

  // ----- public -----

  function render({ focus } = {}) {
    teardown();
    root.dataset.state = item.state;
    root.setAttribute('aria-labelledby', nameId);
    root.setAttribute('aria-busy', item.state === 'loading' ? 'true' : 'false');

    const category = categoryOf(item.fromExt);
    iconBox.replaceChildren(icon(ICON_FOR[category], 24));
    nameEl.textContent = item.name; // text, never HTML
    nameEl.title = item.path;
    removeBtn.setAttribute('aria-label', `Remove ${item.name}`);

    const sub = [formatBytes(item.file.size)];
    if (item.state === 'loading') sub.push('Checking the file\u2026');
    else {
      sub.push(item.typeLabel);
      if (item.folder) sub.push(`in ${item.folder}`);
    }
    subEl.textContent = sub.join(' \u00b7 ');
    if (item.mismatch && item.state !== 'loading') subEl.append(el('span', { class: 'cv-card__warn', text: item.mismatch }));

    body.replaceChildren();
    switch (item.state) {
      case 'loading': body.append(skeletonBlock()); break;
      case 'ready': body.append(...[suggestBlock(), engineBlock(), optionsBlock()].filter(Boolean)); break;
      case 'queued':
      case 'running': body.append(progressBlock()); break;
      case 'done': body.append(doneBlock()); break;
      case 'error': body.append(messageBlock('error', item.error || 'Something went wrong.', 'Try again', 'retry')); break;
      case 'cancelled': body.append(messageBlock('muted', 'Cancelled.', 'Convert again', 'retry')); break;
      default: break;
    }
    if (focus === 'suggest') body.querySelector('.cv-btn--suggest')?.focus();
  }

  // Many progress events can arrive per second. Paint at most once per frame.
  function repaintProgress() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paintProgress(); });
  }

  function playReveal() {
    if (!revealParts || item.revealed) return;
    item.revealed = true;
    stopReveal = animateReveal(revealParts);
  }

  function destroy() {
    teardown();
    cancelAnimationFrame(raf);
    root.remove();
  }

  return { el: root, render, repaintProgress, playReveal, destroy };
}
