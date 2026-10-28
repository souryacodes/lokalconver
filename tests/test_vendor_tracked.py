"""Every engine listed in js/vendor/SHA256SUMS must be visible to git.

WHY this test exists: .gitignore once contained "build/", which also matched
pdf.js's legacy/build/ folder. The two files inside (pdf.min.mjs and
pdf.worker.min.mjs) stayed on the developer's disk, so everything worked on
localhost and the SHA-256 check passed, but git never uploaded them. The live
site then answered 404 and PDF to images said "The PDF engine could not be
loaded". A file that is ignored by git can never reach GitHub Pages.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SUMS = ROOT / "js" / "vendor" / "SHA256SUMS"

pytestmark = pytest.mark.skipif(
    shutil.which("git") is None or not (ROOT / ".git").exists(),
    reason="needs git and a git checkout",
)


def vendored_paths() -> list[str]:
    paths = []
    for line in SUMS.read_text(encoding="utf-8").splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            paths.append(parts[1].strip())
    return paths


def test_sums_file_lists_the_pdf_engine() -> None:
    # If this fails the list below would check nothing at all.
    paths = vendored_paths()
    assert any(p.endswith("legacy/build/pdf.min.mjs") for p in paths)
    assert any(p.endswith("legacy/build/pdf.worker.min.mjs") for p in paths)


def test_no_vendored_engine_file_is_ignored_by_git() -> None:
    hidden = []
    for rel in vendored_paths():
        # exit code 0 = ignored, 1 = not ignored
        result = subprocess.run(
            ["git", "check-ignore", "-q", rel], cwd=ROOT, capture_output=True
        )
        if result.returncode == 0:
            hidden.append(rel)
    assert hidden == [], (
        "These engine files are hidden by .gitignore, so they would never be "
        "uploaded (the live site would show 404): " + ", ".join(hidden)
    )
