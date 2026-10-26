// Toasts: short messages at the bottom. The host element is a polite live
// region, so screen readers hear them without being interrupted.
import { el } from './dom.js';

const MAX_VISIBLE = 4;

export function createToaster(host) {
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');

  function show(message, { kind = 'info', timeout, action, onDismiss } = {}) {
    const wait = timeout ?? (kind === 'error' ? 8000 : kind === 'warning' ? 7000 : 4500);
    let timer = null;
    let closed = false;

    const close = (reason) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      node.remove();
      onDismiss?.(reason);
    };

    const children = [el('p', { class: 'cv-toast__text', text: message })];
    if (action) {
      children.push(el('button', {
        class: 'cv-toast__action', type: 'button', text: action.label,
        onclick: () => { action.onClick(); close('action'); },
      }));
    }
    children.push(el('button', {
      class: 'cv-icon-btn cv-toast__close', type: 'button', 'aria-label': 'Dismiss message',
      onclick: () => close('closed'),
    }, '\u00d7'));

    const node = el('div', { class: `cv-toast cv-toast--${kind}` }, children);
    host.append(node);
    while (host.children.length > MAX_VISIBLE) host.firstElementChild?.querySelector('.cv-toast__close')?.click();
    timer = setTimeout(() => close('timeout'), wait);
    return () => close('closed');
  }

  return { show };
}
