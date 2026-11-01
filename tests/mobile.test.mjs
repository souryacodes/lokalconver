// Mobile contract tests: these read the real files and fail if a phone-breaking change sneaks back in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkSize, limitMB, isSmallDevice, LIMITS_MB, MOBILE_ANY_MB } from '../js/core/limits.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');

test('the viewport allows pinch-zoom and covers notched screens', () => {
  const tag = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? '';
  assert.match(tag, /width=device-width/);
  assert.match(tag, /viewport-fit=cover/);
  assert.doesNotMatch(tag, /user-scalable\s*=\s*(no|0)/i, 'zooming must stay possible');
  assert.doesNotMatch(tag, /maximum-scale/i, 'zooming must stay possible');
});

test('mobile.css is linked, and last, so it can fine-tune the other stylesheets', () => {
  const links = [...html.matchAll(/<link rel="stylesheet" href="\.\/css\/([^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.at(-1), 'mobile.css');
});

test('every :hover rule is wrapped in (hover: hover), so taps never leave a stuck hover look', () => {
  for (const file of readdirSync(new URL('../css/', import.meta.url)).filter((f) => f.endsWith('.css') && f !== 'docs.css')) {
    const css = read(`css/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    // walk the file; remember whether we are inside @media (hover: hover)
    let depth = 0; let hoverDepth = -1; let sel = '';
    for (const ch of css) {
      if (ch === '{') {
        if (/@media[^{]*hover:\s*hover/.test(sel)) hoverDepth = depth;
        else if (sel.includes(':hover') && !sel.trim().startsWith('@')) {
          assert.ok(hoverDepth !== -1 && depth > hoverDepth, `${file}: ".${sel.trim().slice(0, 50)}" has :hover outside @media (hover: hover)`);
        }
        depth++; sel = '';
      } else if (ch === '}') {
        depth--; if (depth === hoverDepth) hoverDepth = -1; sel = '';
      } else if (ch === ';') sel = '';
      else sel += ch;
    }
  }
});

test('text fields are at least 16 px on touch screens (smaller makes iPhones zoom in)', () => {
  const css = read('css/mobile.css');
  assert.match(css, /pointer: coarse\), \(max-width: 40rem\)[\s\S]*?font-size: 1rem/);
});

test('phones get the lower catch-all limit; small kinds are untouched', () => {
  const phone = { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-M055F) Mobile Safari/537.36' };
  const laptop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' };
  assert.equal(isSmallDevice(phone), true);
  assert.equal(isSmallDevice(laptop), false);
  assert.equal(isSmallDevice({ ...laptop, deviceMemory: 2 }), true);
  assert.equal(isSmallDevice({ ...laptop, userAgentData: { mobile: true } }), true);
  assert.equal(limitMB('any', phone), MOBILE_ANY_MB);
  assert.equal(limitMB('any', laptop), LIMITS_MB.any);
  assert.equal(limitMB('docx', phone), LIMITS_MB.docx);
});

test('checkSize uses the phone limit and says so', () => {
  const phone = { userAgent: 'iPhone Mobile' };
  const big = { name: 'a.bin', size: 200 * 1048576 };
  assert.throws(() => checkSize(big, 'any', phone), /128 MB/);
  assert.doesNotThrow(() => checkSize(big, 'any', { userAgent: 'Windows Chrome' }));
});
