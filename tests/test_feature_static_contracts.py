from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
# Only the files of this feature. The engines in js/vendor and js/converters may fetch their own
# pinned engine files, which is allowed by AGENTS.md.
FEATURE_FILES = ["js/presets.js", "js/ui/proof.js", "js/ui/presets-page.js", "js/ui/receipt.js", "js/ui/settings.js"]
JS_FILES = [ROOT / name for name in FEATURE_FILES]


def test_feature_modules_do_not_use_unsafe_html_insertion():
    for path in JS_FILES:
        source = path.read_text(encoding="utf-8")
        assert not re.search(r"\.innerHTML\s*=", source), f"Unsafe innerHTML assignment in {path.relative_to(ROOT)}"


def test_feature_modules_do_not_send_requests_or_file_contents():
    # The request viewer observes timing entries; it does not initiate requests.
    forbidden_patterns = [
        r"\bfetch\s*\(",
        r"\bXMLHttpRequest\b",
        r"\bsendBeacon\s*\(",
        r"\bWebSocket\s*\(",
    ]
    for path in JS_FILES:
        source = path.read_text(encoding="utf-8")
        for pattern in forbidden_patterns:
            assert not re.search(pattern, source), f"Network API pattern {pattern!r} found in {path.relative_to(ROOT)}"


def test_only_one_gradient_primary_button_in_presets_page():
    # BRIEF: exactly one gradient primary button per screen; a card list must not repeat it.
    source = (ROOT / "js" / "ui" / "presets-page.js").read_text(encoding="utf-8")
    assert "lc-button-primary" not in source
