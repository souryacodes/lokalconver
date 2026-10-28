"""Make the PNG icons for the web app manifest from the two SVG files.

Run from the repo root:   python tools/make_icons.py

Input  (you edit these):  assets/icons/icon.svg, assets/icons/icon-maskable.svg
Output (generated PNGs):  icon-192, icon-512, icon-maskable-192,
                          icon-maskable-512, apple-touch-icon (180 px)

Why a script and not a build step: the website has no build step. This runs
only on your computer, and you commit the PNG files.

Dependency: resvg-py (see tools/requirements-dev.txt). The standard library
cannot draw SVG, so one small package is needed. It is a dev tool only.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ICON_DIR = Path("assets/icons")

# (output file name, source svg, size in pixels)
JOBS: list[tuple[str, str, int]] = [
    ("icon-192.png", "icon.svg", 192),
    ("icon-512.png", "icon.svg", 512),
    ("icon-maskable-192.png", "icon-maskable.svg", 192),
    ("icon-maskable-512.png", "icon-maskable.svg", 512),
    # iOS ignores the manifest icons and fills transparent pixels with black,
    # so it gets the full-bleed (maskable) artwork.
    ("apple-touch-icon.png", "icon-maskable.svg", 180),
]


def render(svg_path: Path, size: int) -> bytes:
    """Return PNG bytes of the SVG drawn at size x size pixels."""
    try:
        import resvg_py  # imported late so --help works without it
    except ImportError:
        sys.exit("resvg-py is missing. Run: pip install -r tools/requirements-dev.txt")
    return resvg_py.svg_to_bytes(svg_path=str(svg_path), width=size, height=size)


def make_icons(root: Path) -> list[Path]:
    """Write every PNG under root/assets/icons and return the paths."""
    out_dir = root / ICON_DIR
    written: list[Path] = []
    for name, source, size in JOBS:
        svg_path = out_dir / source
        if not svg_path.is_file():
            sys.exit(f"Missing {svg_path}")
        target = out_dir / name
        target.write_bytes(render(svg_path, size))
        written.append(target)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path("."), help="repo root")
    args = parser.parse_args(argv)
    for path in make_icons(args.root):
        print(f"wrote {path} ({path.stat().st_size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
