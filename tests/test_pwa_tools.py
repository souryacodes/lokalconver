"""Tests for tools/gen_precache.py and tools/make_icons.py (run with pytest)."""
from __future__ import annotations

import shutil
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))

import gen_precache  # noqa: E402
import make_icons  # noqa: E402


def make_repo(tmp_path: Path) -> Path:
    files = {
        "index.html": "<!doctype html>",
        "manifest.webmanifest": "{}",
        "css/app.css": "a{}",
        "js/app.js": "export {};",
        "js/vendor/big-lib-1.0.0/lib.js": "x",
        "assets/icons/icon-192.png": "x",
        "js/converters/pdf.js": "export {};",
        "locales/en.json": "{}",
        "assets/icons/icon.svg": "<svg/>",
        "tests/a.test.mjs": "x",
        "tools/gen_precache.py": "x",
        "docs/LICENSES.md": "x",
        "service-worker.js": "x",
        "js/readme.txt": "not a shell file type",
    }
    for rel, text in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return tmp_path


def test_shell_list_has_only_shell_files(tmp_path: Path) -> None:
    listed = gen_precache.list_shell_files(make_repo(tmp_path))
    assert listed == [
        "assets/icons/icon.svg",
        "css/app.css",
        "index.html",
        "js/app.js",
        "js/converters/pdf.js",
        "locales/en.json",
        "manifest.webmanifest",
    ]


def test_version_changes_with_content_not_with_line_endings(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    first = gen_precache.build(root)[0]["version"]
    (root / "js/app.js").write_bytes(b"export {};\r\n")  # CRLF
    crlf = gen_precache.build(root)[0]["version"]
    (root / "js/app.js").write_bytes(b"export {};\n")  # LF
    lf = gen_precache.build(root)[0]["version"]
    assert crlf == lf
    assert first != lf  # a trailing newline is a real change
    (root / "js/app.js").write_text("export const x = 1;\n", encoding="utf-8")
    assert gen_precache.build(root)[0]["version"] != lf


def test_engines_and_png_icons_are_not_in_the_shell(tmp_path: Path) -> None:
    listed = gen_precache.list_shell_files(make_repo(tmp_path))
    assert not [name for name in listed if name.startswith("js/vendor/")]
    assert not [name for name in listed if name.endswith(".png")]


def test_big_files_are_left_for_first_use(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    (root / "js/engines").mkdir()
    (root / "js/engines/core.js").write_bytes(b"x" * 200 * 1024)
    manifest, skipped, _ = gen_precache.build(root)
    assert "js/engines/core.js" not in manifest["files"]
    assert skipped == ["js/engines/core.js"]


def test_check_mode(tmp_path: Path) -> None:
    root = make_repo(tmp_path)
    assert gen_precache.main(["--root", str(root), "--check"]) == 1  # no file yet
    assert gen_precache.main(["--root", str(root)]) == 0
    assert gen_precache.main(["--root", str(root), "--check"]) == 0
    (root / "css/app.css").write_text("b{}", encoding="utf-8")
    assert gen_precache.main(["--root", str(root), "--check"]) == 1  # stale


def test_the_real_precache_manifest_is_up_to_date() -> None:
    # Fails when a shell file changed and you forgot: python tools/gen_precache.py
    assert gen_precache.main(["--root", str(REPO), "--check"]) == 0


def test_shell_code_never_imports_an_engine_statically() -> None:
    # Engines are not in the shell. If a shell module imported one with a plain
    # `import ... from`, the page would not start offline on a fresh install.
    # Lazy `await import(...)` and library loaders are fine.
    import re

    static_import = re.compile(r"^\s*(?:import|export)\b[^;()]*\bfrom\s+['\"][^'\"]*vendor/", re.M)
    offenders = [
        name
        for name in gen_precache.list_shell_files(REPO)
        if name.endswith((".js", ".mjs")) and static_import.search((REPO / name).read_text(encoding="utf-8"))
    ]
    assert offenders == []


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


def test_icons_are_made_at_the_right_sizes(tmp_path: Path) -> None:
    pytest.importorskip("resvg_py")
    shutil.copytree(REPO / "assets/icons", tmp_path / "assets/icons", ignore=shutil.ignore_patterns("*.png"))
    written = make_icons.make_icons(tmp_path)
    sizes = {p.name: png_size(p.read_bytes()) for p in written}
    assert sizes == {
        "icon-192.png": (192, 192),
        "icon-512.png": (512, 512),
        "icon-maskable-192.png": (192, 192),
        "icon-maskable-512.png": (512, 512),
        "apple-touch-icon.png": (180, 180),
    }


def test_maskable_svg_is_full_bleed() -> None:
    # Android crops maskable icons, so the background must cover the whole
    # square: no transparent corners and no rounded rectangle.
    root = ET.parse(REPO / "assets/icons/icon-maskable.svg").getroot()
    rect = root.find("{http://www.w3.org/2000/svg}rect")
    assert rect is not None
    assert (rect.get("x"), rect.get("y"), rect.get("width"), rect.get("height")) == ("0", "0", "512", "512")
    assert rect.get("rx") is None
