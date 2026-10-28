#!/usr/bin/env python3
"""Best-effort static check for common file-upload code patterns.

This is not a browser network monitor and cannot prove what a running page sends.
Use the browser's Network panel and offline checks as described on the Privacy Proof page.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("XMLHttpRequest", re.compile(r"\bXMLHttpRequest\b", re.IGNORECASE)),
    ("sendBeacon", re.compile(r"\b(?:navigator\s*\.\s*)?sendBeacon\s*\(", re.IGNORECASE)),
    ("FormData construction", re.compile(r"\bnew\s+FormData\s*\(", re.IGNORECASE)),
    ("POST request method", re.compile(r"\bmethod\s*[:=]\s*['\"]?POST\b", re.IGNORECASE)),
    ("WebSocket", re.compile(r"\bnew\s+WebSocket\s*\(", re.IGNORECASE)),
    ("EventSource", re.compile(r"\bnew\s+EventSource\s*\(", re.IGNORECASE)),
    ("HTML form with an action", re.compile(r"<form\b[^>]*\baction\s*=", re.IGNORECASE)),
    ("send(file/blob/form) body", re.compile(r"\.send\s*\(\s*(?:file|blob|formData|form)\b", re.IGNORECASE)),
    ("fetch with a file-like body", re.compile(
        r"\bfetch\s*\([^;]{0,500}(?:body\s*:\s*(?:file|blob|formData)|\bFormData\s*\()",
        re.IGNORECASE | re.DOTALL,
    )),
)

CODE_SUFFIXES = {".js", ".mjs", ".html", ".py"}
EXCLUDED_PARTS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


# Third-party libraries are not our code. Their files are pinned by hash (js/vendor/SHA256SUMS), and
# the page policy only allows requests to our own address. Some contain network code that we never call
# with your files (for example the HEIC decoder). Use --include-vendor to look at them too.
VENDOR_PARTS = ("js", "vendor")


def scan(root: Path, include_vendor: bool = False) -> list[str]:
    findings: list[str] = []
    if not root.exists():
        return [f"Root does not exist: {root}"]
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
            continue
        if any(part in EXCLUDED_PARTS for part in path.parts):
            continue
        relative = path.relative_to(root).parts
        if not include_vendor and relative[: len(VENDOR_PARTS)] == VENDOR_PARTS:
            continue
        # Do not scan this detector's own regex literals or adversarial test fixtures.
        if path.resolve() == Path(__file__).resolve() or "tests" in path.relative_to(root).parts:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        for label, pattern in PATTERNS:
            if pattern.search(source):
                findings.append(f"{path.relative_to(root)}: possible {label} pattern")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Look for common upload code patterns in our source files.")
    parser.add_argument("--include-vendor", action="store_true", help="also scan third-party files in js/vendor")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    findings = scan(root, include_vendor=args.include_vendor)
    if not args.include_vendor:
        print("Skipped js/vendor (third-party files). Add --include-vendor to scan them too.")
    if findings:
        print("Possible upload-related patterns found:")
        for finding in findings:
            print(f"- {finding}")
        print("Review each match manually; this static scan can produce false positives.")
        return 1
    print("No common file-upload patterns found in scanned source files.")
    print("This is not proof of zero network traffic. Check DevTools Network and test offline too.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
