# LokalConver on phones and tablets

The site is built to work from a 280 px folded phone up to a desktop, upright or on its side.
This page says how, so the next change does not undo it.

## The rules

- **Nothing scrolls sideways.** `body` clips overflow as a safety net, and the header text size follows the screen width (`css/base.css`).
- **Every button is at least 44 x 44 px** on touch screens (`css/mobile.css`, section 2).
- **Text fields are 16 px or bigger** on touch screens. Smaller makes iPhones zoom in.
- **Hover effects only run where there is a mouse.** Every `:hover` rule sits inside `@media (hover: hover)`, so a tap never leaves a button stuck "lifted". `tests/mobile.test.mjs` fails if one is added outside.
- **Pinch-zoom is never switched off.** No `user-scalable=no`, no `maximum-scale`.
- **Notches and home bars are respected** (`viewport-fit=cover` plus `env(safe-area-inset-*)`).
- **A phone on its side** gets a header that scrolls away, so the page is not half covered.
- **Touch screens get touch wording:** "Add your files / Tap here", and no folder picker or keyboard-shortcut hint (`js/ui/convert.js`, `css/mobile.css` section 8).
- **Phones get a lower size limit** for the catch-all file type (128 MB instead of 512 MB), because a browser tab on a phone has far less memory (`js/core/limits.js`).
- **Lighter drawing on phones:** fewer background blobs, no blurred backdrops, shadows switch at once instead of animating.

## Checking it

```
python tools/serve.py                         # leave running in one window
python tools/mobile_audit.py http://localhost:8000
python tools/mobile_audit.py http://localhost:8000 --shots audit-shots   # also saves pictures
```

One-time setup: `pip install playwright`, then `playwright install chromium`.

The audit opens every page on ten screen sizes and fails if anything scrolls sideways, sticks out
past the screen, is under 44 px, or is a text field under 16 px.
It cannot simulate a notch, so after changing the header or the bottom of a page, also look at the site on a real phone.

## Fonts

Poppins is served from `assets/fonts/` (the page's security policy blocks Google Fonts) and is part of the
offline cache, so an installed app on a phone keeps its look with no connection. The two weights used on first
screen are preloaded in `index.html`.
