import io
import sys
import tarfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import vendor_libs as v  # noqa: E402


def make_tgz(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_sha256_known_value() -> None:
    assert v.sha256_hex(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_sums_round_trip(tmp_path: Path) -> None:
    f = tmp_path / "SHA256SUMS"
    v.write_sums({"js/vendor/b.js": "2" * 64, "js/vendor/a.js": "1" * 64}, f)
    assert v.read_sums(f) == {"js/vendor/a.js": "1" * 64, "js/vendor/b.js": "2" * 64}


def test_extract_only_wanted_files() -> None:
    tgz = make_tgz({"package/dist/xlsx.mini.min.js": b"JS", "package/LICENSE": b"LIC", "package/../evil": b"x"})
    assert v.extract_wanted(tgz) == {"xlsx.mini.min.js": b"JS", "LICENSE": b"LIC"}


def test_extract_fails_when_a_file_is_missing() -> None:
    with pytest.raises(RuntimeError):
        v.extract_wanted(make_tgz({"package/LICENSE": b"LIC"}))


def test_download_refuses_other_hosts() -> None:
    with pytest.raises(ValueError):
        v.download("https://example.com/xlsx.tgz")


def test_check_all_finds_changed_and_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "js" / "vendor").mkdir(parents=True)
    (tmp_path / "js" / "vendor" / "a.js").write_bytes(b"one")
    monkeypatch.setattr(v, "ROOT", tmp_path)
    ok = {"js/vendor/a.js": v.sha256_hex(b"one")}
    assert v.check_all(ok) == []
    bad = {"js/vendor/a.js": "0" * 64, "js/vendor/gone.js": "1" * 64}
    assert sorted(v.check_all(bad)) == ["CHANGED: js/vendor/a.js", "missing: js/vendor/gone.js"]
