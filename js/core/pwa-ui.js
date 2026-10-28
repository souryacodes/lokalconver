// Small DOM pieces for the PWA parts: status chip, toast, install card.
// Only createElement and textContent. No innerHTML.
// Looks come from css/pwa.css, which uses the design tokens and the existing
// .chip, .card and .btn classes.

export const STRINGS = {
  worksOffline: 'Works offline',
  offline: 'Offline',
  updateReady: 'New version ready.',
  reload: 'Reload',
  later: 'Later',
  installTitle: 'Install LokalConver',
  installBody: 'Open it from your home screen, like an app.',
  install: 'Install',
  noThanks: 'No thanks',
  shareError: 'Could not receive the shared file. Add it from the Convert page.',
  shareNothing: 'Nothing was added. This type of file is not supported.',
  opened: (n) => (n === 1 ? 'Opened 1 file from Share.' : `Opened ${n} files from Share.`),
  skipped: (n) => (n === 1 ? 'Skipped 1 file: type not supported.' : `Skipped ${n} files: type not supported.`),
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

// One fixed host for the toast and the install card.
function host() {
  let node = document.getElementById('pwa-host');
  if (!node) {
    node = el('div', 'pwa-host');
    node.id = 'pwa-host';
    document.body.append(node);
  }
  return node;
}

// ---- chip: "Works offline" / "Offline"

// The page has a slot in the footer: <div data-pwa-chip-slot role="status">.
// It is a live region from the start, so a screen reader announces the chip
// when it appears or changes.
export function createChip() {
  const chip = el('span', 'chip pwa-chip');
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('class', 'chip-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '12');
  dot.setAttribute('r', '6');
  icon.append(dot);
  const label = el('span');
  chip.append(icon, label);
  chip.hidden = true;

  const slot = document.querySelector('[data-pwa-chip-slot]');
  if (slot) {
    slot.append(chip);
  } else {
    chip.setAttribute('role', 'status');
    host().append(chip);
  }

  return {
    show(state) {
      chip.hidden = state === 'none';
      chip.dataset.state = state;
      label.textContent =
        state === 'offline' ? STRINGS.offline : state === 'works-offline' ? STRINGS.worksOffline : '';
    },
  };
}

// ---- toast: one message at a time

let toastNode = null;
let toastTimer = 0;

export function hideToast() {
  window.clearTimeout(toastTimer);
  if (toastNode) toastNode.remove();
  toastNode = null;
}

// actions: [{ label, onClick }]. timeoutMs 0 = stays until the person closes it.
export function showToast({ message, actions = [], timeoutMs = 6000 }) {
  hideToast();
  toastNode = el('div', 'pwa-toast');
  toastNode.setAttribute('role', 'status');
  toastNode.append(el('span', 'pwa-toast__text', message));
  for (const action of actions) {
    toastNode.append(
      button(action.label, 'btn btn-secondary', () => {
        hideToast();
        action.onClick();
      }),
    );
  }
  host().append(toastNode);
  if (timeoutMs > 0) toastTimer = window.setTimeout(hideToast, timeoutMs);
}

// ---- install card

// Two secondary buttons. The one gradient button on the screen belongs to the
// Convert page (brief: exactly one per screen).
export function showInstallCard({ onInstall, onDismiss }) {
  const card = el('section', 'card card-raised pwa-card');
  card.setAttribute('aria-label', STRINGS.installTitle);
  const buttons = el('div', 'pwa-card__buttons');
  const close = () => card.remove();
  buttons.append(
    button(STRINGS.install, 'btn btn-secondary', () => {
      close();
      onInstall();
    }),
    button(STRINGS.noThanks, 'btn btn-secondary', () => {
      close();
      onDismiss();
    }),
  );
  card.append(el('h2', 'pwa-card__title', STRINGS.installTitle), el('p', 'pwa-card__body', STRINGS.installBody), buttons);
  host().append(card);
  return close;
}
