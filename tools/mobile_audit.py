"""Checks the site on phone and tablet screens and reports what would be hard to use.

What it looks for, on every page and on ten screen sizes (a 280 px folded phone up to a tablet,
upright and on its side):
  - the page scrolling sideways
  - anything poking out past the edge of the screen
  - buttons and links smaller than 44 x 44 px (hard to hit with a thumb)
  - text fields under 16 px (iPhones zoom into those and stay zoomed)

Setup, once:   pip install playwright   then   playwright install chromium
Run:           python tools/serve.py          (in one window, leave it running)
               python tools/mobile_audit.py http://localhost:8000
Optional:      add  --shots audit-shots  to save a screenshot of every screen.
Exit code 0 = nothing found, 1 = problems found (so it can run in automation).
"""
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit('Playwright is missing. Run:  pip install playwright   then   playwright install chromium')

ROOT = Path(__file__).resolve().parent.parent
PHONE_UA = 'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
PROFILES = [  # (label, Playwright device name or a custom screen)
    ('iPhone SE', 'iPhone SE'), ('iPhone 13', 'iPhone 13'), ('iPhone 14 Pro Max', 'iPhone 14 Pro Max'),
    ('Galaxy S8', 'Galaxy S8'), ('Pixel 7', 'Pixel 7'), ('iPad Mini', 'iPad Mini'),
    ('iPhone 13 landscape', 'iPhone 13 landscape'), ('Pixel 7 landscape', 'Pixel 7 landscape'),
    ('320 x 568 phone', {'viewport': {'width': 320, 'height': 568}, 'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True, 'user_agent': PHONE_UA}),
    ('280 px folded phone', {'viewport': {'width': 280, 'height': 653}, 'device_scale_factor': 3, 'is_mobile': True, 'has_touch': True, 'user_agent': PHONE_UA}),
]
PAGES = ['convert', 'pdf', 'presets', 'proof', 'about']

CHECK = """
() => {
  const vw = document.documentElement.clientWidth;
  const out = {sideways: document.documentElement.scrollWidth > vw, small: [], outside: [], zoomy: []};
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 3 || r.height < 3 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden], dialog:not([open])')) continue;
    if (el.classList.contains('skip-link') || el.classList.contains('cv-sr') || el.type === 'file') continue;
    const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.className).trim().replace(/\\s+/g, ' ').slice(0, 30);
    const inText = el.tagName === 'A' && el.closest('p, li') && !el.closest('nav');
    if (Math.min(r.width, r.height) < 44 && !inText) out.small.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (r.right > vw + 1 || r.left < -1) out.outside.push(`${el.tagName.toLowerCase()} "${name}"`);
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(cs.fontSize) < 16 && !['checkbox', 'radio', 'range', 'color'].includes(el.type))
      out.zoomy.push(`${el.tagName.toLowerCase()} "${name}" ${cs.fontSize}`);
  }
  return out;
}
"""


def main():
    base = next((a for a in sys.argv[1:] if a.startswith('http')), 'http://localhost:8000').rstrip('/')
    shots = None
    if '--shots' in sys.argv:
        shots = Path(sys.argv[sys.argv.index('--shots') + 1]); shots.mkdir(parents=True, exist_ok=True)
    sample_files = [str(ROOT / 'shot-empty.png'), str(ROOT / 'samples' / 'sample.csv')]
    sample_files = [f for f in sample_files if Path(f).exists()]
    problems = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, prof in PROFILES:
            kw = dict(p.devices[prof]) if isinstance(prof, str) else dict(prof)
            ctx = browser.new_context(service_workers='block', **kw)
            page = ctx.new_page()
            page.goto(base + '/index.html'); page.wait_for_selector('.cv-empty', timeout=15000)
            found = []
            states = [(n, None) for n in PAGES] + ([('convert with files', sample_files)] if sample_files else [])
            for name, files in states:
                if files:
                    page.evaluate("location.hash = '#/convert'"); page.wait_for_timeout(400)
                    page.set_input_files('input[type=file]:not([webkitdirectory])', files)
                    page.wait_for_selector('.cv-btn--suggest'); page.click('.cv-options summary')
                else:
                    page.evaluate(f"location.hash = '#/{name}'")
                page.wait_for_timeout(600)
                r = page.evaluate(CHECK)
                if r['sideways']: found.append(f'{name}: the page scrolls sideways')
                found += [f'{name}: sticks out past the screen edge: {x}' for x in r['outside']]
                found += [f'{name}: smaller than 44 px: {x}' for x in r['small']]
                found += [f'{name}: text field under 16 px (iPhone zooms in): {x}' for x in r['zoomy']]
                if shots: page.screenshot(path=str(shots / f"{label.replace(' ', '_')}-{name.replace(' ', '_')}.png"), full_page=True)
            found = sorted(set(found)); problems += len(found)
            print(f"{'OK  ' if not found else 'FAIL'} {label}" + ('' if not found else f' ({len(found)})'))
            for line in found[:12]: print('       -', line)
            ctx.close()
        browser.close()
    print('\nNo problems found.' if not problems else f'\n{problems} problem(s) found.')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
