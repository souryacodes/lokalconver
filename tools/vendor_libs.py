"""Fetch the official SheetJS build and verify vendored-library checksums.

Usage (run from any working directory):
    python tools/vendor_libs.py            Fetch SheetJS if needed, initialize missing
                                           checksums for existing vendor files, then verify.
    python tools/vendor_libs.py --check    Verify only; never download or modify files.

The checksum manifest is js/vendor/SHA256SUMS. Each line contains a SHA-256
hash followed by two spaces and a repository-relative file path.

First-time setup note: when normal mode finds existing files under js/vendor
that are not listed in SHA256SUMS, it records their current local hashes. This
is trust-on-first-use; it does not prove that those files came from their claimed
publishers. Review the vendored files and their source before committing changes.

Only the Python standard library is used.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import re
import sys
import tarfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "js" / "vendor"
SUMS = VENDOR / "SHA256SUMS"

SHEETJS_VERSION = "0.20.3"
SHEETJS_URL = (
    f"https://cdn.sheetjs.com/xlsx-{SHEETJS_VERSION}/"
    f"xlsx-{SHEETJS_VERSION}.tgz"
)
SHEETJS_DIR = VENDOR / "sheetjs" / SHEETJS_VERSION
WANTED = {
    "package/dist/xlsx.mini.min.js": "xlsx.mini.min.js",
    "package/LICENSE": "LICENSE",
}
MAX_BYTES = 30 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_FILES = tuple(
    (SHEETJS_DIR / filename).relative_to(ROOT).as_posix()
    for filename in WANTED.values()
)


def sha256_file(path: Path) -> str:
    """Hash a file in chunks so large vendored files need not fit in memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    """Return the lowercase SHA-256 digest of bytes already in memory."""
    return hashlib.sha256(data).hexdigest()


sha256_hex = sha256_bytes  # the name tests/test_vendor_libs.py uses


def safe_repo_path(relative_path: str) -> Path:
    """Validate a manifest path and ensure it cannot escape the repository."""
    if not relative_path or "\\" in relative_path or ":" in relative_path:
        raise ValueError(f"invalid path in SHA256SUMS: {relative_path!r}")

    posix_path = PurePosixPath(relative_path)
    if (
        posix_path.is_absolute()
        or posix_path.as_posix() != relative_path
        or any(part in {"", ".", ".."} for part in posix_path.parts)
    ):
        raise ValueError(f"unsafe or non-canonical path in SHA256SUMS: {relative_path!r}")

    candidate = ROOT.joinpath(*posix_path.parts)
    try:
        candidate.resolve(strict=False).relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ValueError(f"path escapes the repository root: {relative_path!r}") from exc
    return candidate


def read_sums(path: Path | None = None) -> dict[str, str]:
    """Read SHA256SUMS: one '<64-char hash>  <repo-relative path>' per line."""
    manifest = SUMS if path is None else path
    if not manifest.exists():
        return {}
    if not manifest.is_file():
        raise ValueError(f"checksum manifest is not a regular file: {manifest}")

    sums: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        manifest.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            raise ValueError(
                f"invalid SHA256SUMS line {line_number}: expected a hash and a path"
            )
        digest, relative_path = parts[0].lower(), parts[1].strip()
        if not SHA256_RE.fullmatch(digest):
            raise ValueError(f"invalid SHA-256 hash on SHA256SUMS line {line_number}")
        safe_repo_path(relative_path)
        if relative_path in sums:
            raise ValueError(
                f"duplicate path {relative_path!r} in SHA256SUMS line {line_number}"
            )
        sums[relative_path] = digest
    return sums


def write_sums(sums: dict[str, str], path: Path | None = None) -> None:
    """Write a sorted manifest using a temporary file and atomic replacement."""
    manifest = SUMS if path is None else path
    manifest.parent.mkdir(parents=True, exist_ok=True)
    content = "".join(f"{sums[name]}  {name}\n" for name in sorted(sums))
    temporary = manifest.with_name(manifest.name + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        temporary.replace(manifest)
    finally:
        if temporary.exists():
            temporary.unlink()


class OfficialSheetJSRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Allow HTTPS redirects only when they remain on the official SheetJS host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname != "cdn.sheetjs.com":
            raise urllib.error.URLError(
                "refusing redirect away from https://cdn.sheetjs.com/"
            )
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url: str) -> bytes:
    """Download a bounded archive only from the official SheetJS HTTPS host."""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "cdn.sheetjs.com":
        raise ValueError("only the official https://cdn.sheetjs.com/ host is allowed")

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "vendor-libs-check/1.0"},
    )
    opener = urllib.request.build_opener(OfficialSheetJSRedirectHandler())
    with opener.open(request, timeout=60) as response:
        final_url = urlsplit(response.geturl())
        if final_url.scheme != "https" or final_url.hostname != "cdn.sheetjs.com":
            raise RuntimeError("download ended outside the official SheetJS host")
        data = response.read(MAX_BYTES + 1)

    if len(data) > MAX_BYTES:
        raise RuntimeError(f"download exceeds the {MAX_BYTES // (1024 * 1024)} MiB limit")
    return data


def extract_wanted(tgz: bytes) -> dict[str, bytes]:
    """Read only the two expected regular files; never extract archive paths."""
    found: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(tgz), mode="r:gz") as archive:
        for member in archive.getmembers():
            output_name = WANTED.get(member.name)
            if output_name is None or not member.isfile():
                continue
            if member.size < 0 or member.size > MAX_BYTES:
                raise RuntimeError(f"unexpected size for tarball member {member.name!r}")
            handle = archive.extractfile(member)
            if handle is None:
                continue
            data = handle.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES or len(data) != member.size:
                raise RuntimeError(f"invalid size while reading {member.name!r}")
            if output_name in found:
                raise RuntimeError(f"duplicate tarball member: {member.name!r}")
            found[output_name] = data

    missing = set(WANTED.values()) - set(found)
    if missing:
        raise RuntimeError(f"tarball is missing required files: {sorted(missing)}")
    return found


def _verify_recorded_files_before_fetch(sums: dict[str, str]) -> None:
    """Do not fetch over files that already disagree with their recorded hashes."""
    for relative_path, expected_digest in sums.items():
        path = safe_repo_path(relative_path)
        if path.is_symlink():
            raise RuntimeError(f"refusing to follow symlink: {relative_path}")
        if path.exists():
            if not path.is_file():
                raise RuntimeError(f"recorded path is not a regular file: {relative_path}")
            actual_digest = sha256_file(path)
            if actual_digest != expected_digest:
                raise RuntimeError(
                    f"refusing to continue: recorded file has changed: {relative_path}\n"
                    f"  expected {expected_digest}\n"
                    f"  actual   {actual_digest}"
                )


def fetch_sheetjs() -> None:
    """Fetch SheetJS, validate it against recorded hashes, then save its two files."""
    sums = read_sums()
    _verify_recorded_files_before_fetch(sums)

    print(f"Downloading {SHEETJS_URL}")
    tarball = download(SHEETJS_URL)
    print(f"  tarball SHA-256: {sha256_bytes(tarball)}")
    files = extract_wanted(tarball)

    new_hashes: dict[str, str] = {}
    targets: list[tuple[Path, bytes]] = []
    for name, data in files.items():
        relative_path = (SHEETJS_DIR / name).relative_to(ROOT).as_posix()
        digest = sha256_bytes(data)
        recorded = sums.get(relative_path)
        if recorded is not None and recorded != digest:
            raise RuntimeError(
                f"STOP: downloaded {relative_path} does not match SHA256SUMS.\n"
                f"  recorded   {recorded}\n"
                f"  downloaded {digest}"
            )

        target = safe_repo_path(relative_path)
        if target.is_symlink():
            raise RuntimeError(f"refusing to overwrite symlink: {relative_path}")
        if target.exists():
            if not target.is_file():
                raise RuntimeError(f"target is not a regular file: {relative_path}")
            existing_digest = sha256_file(target)
            if recorded is None and existing_digest != digest:
                raise RuntimeError(
                    f"refusing to overwrite unverified existing file {relative_path};\n"
                    "review its source and remove or verify it before retrying"
                )
        new_hashes[relative_path] = digest
        targets.append((target, data))

    # Stage all downloaded files before replacing any destination.
    staged: list[tuple[Path, Path]] = []
    try:
        for target, data in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".tmp")
            if temporary.exists():
                temporary.unlink()
            temporary.write_bytes(data)
            staged.append((temporary, target))
        for temporary, target in staged:
            temporary.replace(target)
    finally:
        for temporary, _target in staged:
            if temporary.exists():
                temporary.unlink()

    sums.update(new_hashes)
    write_sums(sums)
    size_kb = round(len(files["xlsx.mini.min.js"]) / 1024)
    print(f"  xlsx.mini.min.js is {size_kb} KB. Set kb: {size_kb} for sheetjs in js/converters/libs.js")
    print("  SheetJS JavaScript and LICENSE hashes recorded/verified.")


def initialize_missing_vendor_hashes() -> list[str]:
    """Record hashes for unlisted vendor files, without changing existing hashes."""
    if not VENDOR.exists():
        return []

    sums = read_sums()
    added: list[str] = []
    for path in sorted(VENDOR.rglob("*")):
        if path == SUMS or (not path.is_file() and not path.is_symlink()):
            continue
        relative_path = path.relative_to(ROOT).as_posix()
        if path.is_symlink():
            raise RuntimeError(f"symlink not allowed in vendor directory: {relative_path}")
        if relative_path not in sums:
            sums[relative_path] = sha256_file(path)
            added.append(relative_path)

    if added:
        write_sums(sums)
    return added


def check_all(sums: dict[str, str]) -> list[str]:
    """Return all integrity problems; an empty list means every vendor file is covered."""
    problems: set[str] = set()
    if not sums:
        problems.add(f"missing or empty checksum manifest: {SUMS.relative_to(ROOT).as_posix()}")

    for relative_path in REQUIRED_FILES:
        if relative_path not in sums:
            problems.add(f"missing checksum: {relative_path}")
        if not (ROOT / relative_path).is_file():
            problems.add(f"missing: {relative_path}")

    for relative_path, expected_digest in sums.items():
        path = safe_repo_path(relative_path)
        if path.is_symlink():
            problems.add(f"symlink not allowed: {relative_path}")
            continue
        if not path.is_file():
            problems.add(f"missing: {relative_path}")
            continue
        try:
            actual_digest = sha256_file(path)
        except OSError as exc:
            problems.add(f"cannot read {relative_path}: {exc}")
        else:
            if actual_digest != expected_digest:
                problems.add(f"CHANGED: {relative_path}")

    if VENDOR.exists():
        for path in VENDOR.rglob("*"):
            if path == SUMS or (not path.is_file() and not path.is_symlink()):
                continue
            relative_path = path.relative_to(ROOT).as_posix()
            if path.is_symlink():
                problems.add(f"symlink not allowed: {relative_path}")
            elif relative_path not in sums:
                problems.add(f"missing checksum: {relative_path}")

    return sorted(problems)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify checksums only; do not download or modify anything",
    )
    args = parser.parse_args(argv)

    try:
        sums = read_sums()
        needs_sheetjs = any(
            not (ROOT / relative_path).is_file() or relative_path not in sums
            for relative_path in REQUIRED_FILES
        )

        if not args.check:
            if needs_sheetjs:
                fetch_sheetjs()
            added = initialize_missing_vendor_hashes()
            if added:
                print(f"Initialized checksums for {len(added)} existing vendored file(s):")
                for relative_path in added:
                    print(f"  {relative_path}")
                print(
                    "WARNING: these hashes record the current local files; they do not "
                    "independently verify upstream authenticity. Review sources before committing."
                )

        problems = check_all(read_sums())
    except (OSError, RuntimeError, ValueError, tarfile.TarError, urllib.error.URLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if problems:
        for problem in problems:
            print(problem)
        print("Problems found.")
        return 1

    print("All vendored files match SHA256SUMS.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
