function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatReportedBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Not exposed';
  if (value === 0) return 'Not exposed or cached';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function requestOrigin(address) {
  try {
    const parsed = new URL(address, globalThis.location?.href || 'http://localhost/');
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return 'local-resource:';
    return parsed.origin;
  } catch {
    return '';
  }
}

function requestPath(address) {
  try { return new URL(address, globalThis.location?.href || 'http://localhost/').pathname; } catch { return ''; }
}

// Engines we ship ourselves (for example js/vendor/...) load from our own address,
// but they are "engine downloads": big files fetched only when a conversion needs them.
function addressClass(entry, ownOrigin, approvedOrigins, engineMarkers) {
  const origin = requestOrigin(entry.name);
  if (origin && approvedOrigins.has(origin)) return 'engine';
  if (origin === ownOrigin && engineMarkers.some((marker) => requestPath(entry.name).includes(marker))) return 'engine';
  if (origin === 'local-resource:' || (origin && origin === ownOrigin)) return 'own';
  return 'other';
}

function sizeForEntry(entry) {
  if (Number.isFinite(entry.transferSize) && entry.transferSize > 0) return formatReportedBytes(entry.transferSize);
  if (Number.isFinite(entry.encodedBodySize) && entry.encodedBodySize > 0) return `${formatReportedBytes(entry.encodedBodySize)} encoded body`;
  return 'Not exposed or cached';
}

function parsePolicy(policyText) {
  const directives = new Map();
  for (const segment of String(policyText || '').split(';')) {
    const parts = segment.trim().split(/\s+/).filter(Boolean);
    if (parts.length && !directives.has(parts[0].toLowerCase())) directives.set(parts[0].toLowerCase(), parts.slice(1));
  }
  return directives;
}

export function describeCsp(policyText) {
  const policy = String(policyText || '').trim();
  if (!policy) {
    return [
      'No Content-Security-Policy text was visible to this page script.',
      'A policy sent only as an HTTP response header cannot be read by page JavaScript. Supply the deployed policy text to this panel if it is header-only.',
      'The browser enforces the policy actually delivered by the server. Until that policy text is supplied here, this panel cannot list its allowed sources.',
    ];
  }

  const directives = parsePolicy(policy);
  const lines = [];
  const sourceList = (name) => directives.get(name) || directives.get('default-src') || [];
  const scripts = sourceList('script-src');
  const connects = sourceList('connect-src');
  const images = sourceList('img-src');
  const workers = sourceList('worker-src');

  if (directives.has('default-src')) {
    lines.push(`Default rule: resources without a more specific rule may load only from ${directives.get('default-src').join(' ') || '(no sources)'}.`);
  }
  if (directives.has('script-src') || directives.has('default-src')) {
    lines.push(`Scripts: ${scripts.length ? scripts.join(', ') : 'no sources are listed'}; scripts that do not match this directive are blocked by the browser.`);
  }
  if (directives.has('connect-src') || directives.has('default-src')) {
    lines.push(`Network connections made by APIs such as fetch or WebSocket: ${connects.length ? connects.join(', ') : 'no sources are listed'}; other matching connections are blocked by the browser.`);
  }
  if (directives.has('img-src') || directives.has('default-src')) {
    lines.push(`Images: ${images.length ? images.join(', ') : 'no sources are listed'}; images outside those sources are blocked by the browser.`);
  }
  if (directives.has('worker-src') || directives.has('default-src')) {
    lines.push(`Workers: ${workers.length ? workers.join(', ') : 'no sources are listed'}; workers outside those sources are blocked by the browser.`);
  }
  if (!lines.length) {
    lines.push('This policy has specific directives. The browser blocks resource loads or connections that violate the matching directive; inspect each source list above to see what is allowed.');
  }
  lines.push('A CSP blocks matching loads to disallowed addresses; it does not inspect request bodies or prove whether a request contained file bytes.');
  return lines;
}

function getPolicyText(configuredPolicy) {
  if (typeof configuredPolicy === 'string' && configuredPolicy.trim()) return configuredPolicy.trim();
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
  return meta?.content?.trim() || '';
}

function createRequestTable(entries) {
  const table = el('table', 'lc-proof-table');
  const thead = el('thead');
  const header = el('tr');
  for (const label of ['Address', 'Type', 'Size (reported)', 'Time']) {
    const th = el('th', '', label);
    th.scope = 'col';
    header.append(th);
  }
  thead.append(header);
  table.append(thead);
  const tbody = el('tbody');

  if (!entries.length) {
    const row = el('tr');
    const cell = el('td', 'lc-proof-empty', 'No matching resource requests have been reported yet.');
    cell.colSpan = 4;
    row.append(cell);
    tbody.append(row);
  }

  for (const entry of entries) {
    const row = el('tr');
    const address = el('td', 'lc-proof-address', entry.name || '(address not exposed)');
    address.title = entry.name || '';
    const type = el('td', '', entry.initiatorType || 'unknown');
    const size = el('td', 'lc-proof-nowrap', sizeForEntry(entry));
    const duration = Number(entry.duration);
    const time = el('td', 'lc-proof-nowrap', Number.isFinite(duration) ? `${duration.toFixed(1)} ms` : 'Not exposed');
    row.append(address, type, size, time);
    tbody.append(row);
  }
  table.append(tbody);
  return table;
}

function createGroup(title, key, list) {
  const section = el('section', 'lc-proof-group');
  section.append(el('h2', 'lc-section-title', title));
  section.append(createRequestTable(list));
  section.dataset.requestGroup = key;
  return section;
}

/** Mount a resource-timing view. Resource Timing exposes browser-reported metadata, not request bodies. */
export function mountProofPage(container, { cspText, approvedEngineOrigins = [], enginePathMarkers = [] } = {}) {
  container.replaceChildren();
  container.classList.add('lc-page', 'lc-proof-page');
  const summary = el('p', 'lc-muted', 'This panel lists resource requests the browser reports through the Resource Timing API. It is not a packet capture and cannot show request bodies.');
  const count = el('p', 'lc-proof-count', 'Requests that carried your files: 0');
  count.setAttribute('aria-live', 'polite');
  const countNote = el('p', 'lc-muted', 'The zero means this browser has reported no request to an address outside our own files and the engines you approved. It cannot see request bodies, so check the Network tab too (step 1 below).');

  const policySection = el('section', 'lc-proof-policy');
  policySection.append(el('h2', 'lc-section-title', 'Content-Security-Policy, in plain words'));
  const policyText = getPolicyText(cspText);
  const policyLines = el('ul', 'lc-proof-policy-lines');
  for (const line of describeCsp(policyText)) policyLines.append(el('li', '', line));
  policySection.append(policyLines);
  const rawPolicy = el('details', 'lc-proof-policy-source');
  rawPolicy.append(el('summary', '', 'Show policy text'));
  rawPolicy.append(el('pre', 'lc-proof-code', policyText || 'Policy text is not available to page JavaScript.')); 
  policySection.append(rawPolicy);

  const listIntro = el('p', 'lc-muted', 'Size and timing fields depend on what this browser exposes. A zero or hidden size can mean cached or restricted timing data, not a measured zero-byte transfer.');
  const groupHolder = el('div', 'lc-proof-groups');
  const verifySection = el('section', 'lc-proof-verify');
  verifySection.append(el('h2', 'lc-section-title', 'Verify it yourself'));
  const verifySteps = el('ol', 'lc-proof-verify-steps');
  verifySteps.append(el('li', '', 'Press F12 and open the Network tab. Reload the page and inspect the requests the browser shows. This panel does not inspect request bodies.'));
  verifySteps.append(el('li', '', 'Turn on airplane mode and try a conversion that should work locally. Load any approved engine first if the converter needs it.'));
  verifySteps.append(el('li', '', 'From the project root, run python tools/verify_no_upload.py. Review any flagged lines manually; the static scan cannot prove zero network traffic.'));
  verifySection.append(verifySteps);
  container.append(summary, count, countNote, policySection, el('h2', 'lc-section-title', 'Requests reported by this browser'), listIntro, groupHolder, verifySection);

  const ownOrigin = globalThis.location?.origin || '';
  const approvedOrigins = new Set(approvedEngineOrigins.map((entry) => {
    try { return new URL(entry, globalThis.location?.href || 'http://localhost/').origin; } catch { return ''; }
  }).filter(Boolean));
  const seen = new Set();
  const resources = [];
  let observer = null;

  const render = () => {
    const groups = { own: [], engine: [], other: [] };
    for (const entry of resources) groups[addressClass(entry, ownOrigin, approvedOrigins, enginePathMarkers)].push(entry);
    // The zero is only shown while the browser reports no request to an address we did not approve.
    // If one appears, we say so instead of repeating the promise.
    count.textContent = groups.other.length === 0
      ? 'Requests that carried your files: 0'
      : `Requests to addresses we did not approve: ${groups.other.length}. Review them below.`;
    groupHolder.replaceChildren(
      createGroup('Our own files', 'own', groups.own),
      createGroup('Engine downloads (you approved these)', 'engine', groups.engine),
    );
    if (groups.other.length) groupHolder.append(createGroup('Other reported requests', 'other', groups.other));
  };

  const addEntries = (entries) => {
    let changed = false;
    for (const entry of entries) {
      const key = `${entry.name || ''}|${entry.startTime ?? ''}|${entry.duration ?? ''}|${entry.initiatorType || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(entry);
      changed = true;
    }
    if (changed) render();
  };

  if (globalThis.performance?.getEntriesByType) addEntries(globalThis.performance.getEntriesByType('resource'));
  if (typeof globalThis.PerformanceObserver === 'function') {
    try {
      observer = new globalThis.PerformanceObserver((list) => addEntries(list.getEntries()));
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      try {
        observer?.disconnect();
        observer = new globalThis.PerformanceObserver((list) => addEntries(list.getEntries()));
        observer.observe({ entryTypes: ['resource'] });
      } catch {
        observer = null;
      }
    }
  }
  render();

  return {
    refresh() {
      if (globalThis.performance?.getEntriesByType) addEntries(globalThis.performance.getEntriesByType('resource'));
    },
    disconnect() { observer?.disconnect(); },
    getReportedRequests() { return resources.map((entry) => ({ name: entry.name, type: entry.initiatorType, size: sizeForEntry(entry), timeMs: entry.duration })); },
  };
}
