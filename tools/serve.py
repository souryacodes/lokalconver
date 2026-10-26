"""Start a small web server for LokalConver on this computer.

WHY this exists: browsers refuse to run JavaScript modules from a page opened
by double-clicking index.html (a file:// address). The site must come from
http://localhost instead. This script does that with only the Python standard
library, so there is nothing to install.

Run:  python tools/serve.py        (add --port 9000 to pick another port)
"""
from __future__ import annotations

import argparse
import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# WHY: on Windows, Python reads file types from the registry, and some
# computers say ".js" is "text/plain". Browsers refuse modules sent that way.
# We state the right types ourselves so it works on every computer.
TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)  # type: ignore[arg-type]

    def end_headers(self) -> None:
        # No caching while developing, so a reload always shows the newest code.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        # File names are private. The server keeps no request log.
        return


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def open_server(start_port: int, tries: int = 20) -> tuple[Server, int]:
    """Bind to 127.0.0.1 only (never the network). Try the next port if busy."""
    for port in range(start_port, start_port + tries):
        try:
            return Server(("127.0.0.1", port), Handler), port
        except OSError:
            continue
    raise SystemExit(f"Could not find a free port from {start_port} to {start_port + tries - 1}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve LokalConver on this computer.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser tab")
    args = parser.parse_args()

    server, port = open_server(args.port)
    url = f"http://localhost:{port}/index.html"
    print(f"LokalConver is running at {url}")
    print("Press Ctrl+C in this window to stop it.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
