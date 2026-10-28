import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, chipState, createInstallPolicy, safeStorage } from '../js/core/pwa-state.js';

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
};
const ctx = { hasPrompt: true, standalone: false };

// One "browser" with two visits: a policy is made again per visit, local storage is kept.
function browser() {
  const local = safeStorage(memoryStorage());
  return {
    local,
    visit() {
      const policy = createInstallPolicy(local, safeStorage(memoryStorage()));
      policy.startVisit();
      return policy;
    },
  };
}

test('chip: Offline wins, Works offline only when the shell is ready', () => {
  assert.equal(chipState({ online: false, shellReady: true }), 'offline');
  assert.equal(chipState({ online: false, shellReady: false }), 'offline');
  assert.equal(chipState({ online: true, shellReady: true }), 'works-offline');
  assert.equal(chipState({ online: true, shellReady: false }), 'none');
});

test('install card: never on the first visit, even after two conversions', () => {
  const policy = browser().visit();
  policy.recordConversion();
  policy.recordConversion();
  assert.equal(policy.shouldOffer(ctx), false);
});

test('install card: not before the second conversion', () => {
  const b = browser();
  b.visit().recordConversion();
  const second = b.visit();
  assert.equal(second.shouldOffer(ctx), false); // only 1 conversion so far
  second.recordConversion();
  assert.equal(second.shouldOffer(ctx), true); // 2nd conversion, 2nd visit
});

test('install card: a visit-1 pair of conversions shows at the next conversion', () => {
  const b = browser();
  const first = b.visit();
  first.recordConversion();
  first.recordConversion();
  const second = b.visit();
  second.recordConversion();
  assert.equal(second.shouldOffer(ctx), true);
});

test('install card: once per visit, and never again after No thanks', () => {
  const b = browser();
  const p1 = b.visit();
  p1.recordConversion();
  p1.recordConversion();
  const p2 = b.visit();
  p2.recordConversion();
  assert.equal(p2.shouldOffer(ctx), true);
  p2.markShown();
  assert.equal(p2.shouldOffer(ctx), false); // same visit
  p2.markDismissed();
  const p3 = b.visit(); // note: same session store is new, so this counts as a new visit
  p3.recordConversion();
  assert.equal(p3.shouldOffer(ctx), false);
});

test('install card: not when installed, standalone, or the browser gave no prompt', () => {
  const b = browser();
  b.visit().recordConversion();
  const p = b.visit();
  p.recordConversion();
  assert.equal(p.shouldOffer({ hasPrompt: false, standalone: false }), false);
  assert.equal(p.shouldOffer({ hasPrompt: true, standalone: true }), false);
  p.markInstalled();
  assert.equal(p.shouldOffer(ctx), false);
});

test('a visit is counted once per session, not once per page load', () => {
  const local = safeStorage(memoryStorage());
  const session = safeStorage(memoryStorage());
  const first = createInstallPolicy(local, session);
  assert.equal(first.startVisit(), 1);
  assert.equal(createInstallPolicy(local, session).startVisit(), 1); // reload in the same tab
});

test('storage that throws does not break anything', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const policy = createInstallPolicy(safeStorage(broken), safeStorage(broken));
  assert.equal(policy.startVisit(), 1);
  assert.equal(policy.recordConversion(), 1);
  assert.equal(policy.recordConversion(), 2);
  assert.equal(policy.shouldOffer(ctx), false); // still the first visit
});

test('storage keys are all under the lokalconver. prefix', () => {
  for (const key of Object.values(KEYS)) assert.match(key, /^lokalconver\./);
});
