"""Tests for tools/serve.py (run with: pytest)."""
import sys
import threading
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import serve  # noqa: E402


def _get(port: int, path: str):
    return urllib.request.urlopen(f"http://127.0.0.1:{port}{path}")


def test_javascript_is_served_as_javascript():
    server, port = serve.open_server(8700)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        res = _get(port, "/js/app.js")
        assert res.headers["Content-Type"].startswith("text/javascript")
        assert b"startConvertPage" in res.read()
    finally:
        server.shutdown()
        server.server_close()


def test_binds_to_localhost_only():
    server, _ = serve.open_server(8720)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_busy_port_moves_to_the_next_one():
    first, port = serve.open_server(8740)
    second, other = serve.open_server(port)
    try:
        assert other != port
    finally:
        first.server_close()
        second.server_close()
