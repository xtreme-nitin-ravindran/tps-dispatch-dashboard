"""Serve the SirenTO app locally with the public dispatch feed proxied.

The public feed at https://data-sirento.nitin.run/data/ does not send an
Access-Control-Allow-Origin header that permits a localhost origin, so a plain
static server cannot load live data in a browser. This development-only server
serves the repository statically and proxies only the two public JSON feeds
through the same origin, rewriting the served app module so its snapshot URL
points at the local proxy.

This is a supported local preview path, not a production CORS fix. It binds to
loopback only and never changes deployed configuration.
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTE = "https://data-sirento.nitin.run/data/"
PUBLIC_FILES = {"current.json", "ttc-diversions.json"}
APP_MODULE = "/src/app/app.js"
PROXY_PREFIX = "/__local_feed/"
SNAPSHOT_URL = b'"https://data-sirento.nitin.run/data/current.json"'
PROXY_URL = b'"/__local_feed/current.json"'
DEFAULT_PORT = 8766


def rewrite_app_module(source):
    """Point the served app module's snapshot URL at the local proxy."""
    if source.count(SNAPSHOT_URL) != 1:
        raise ValueError("Preview snapshot URL did not match exactly once")
    return source.replace(SNAPSHOT_URL, PROXY_URL, 1)


def proxy_name(path):
    """Return the allow-listed public file for a proxy path, or None."""
    if not path.startswith(PROXY_PREFIX):
        return None
    name = path[len(PROXY_PREFIX):]
    return name if name in PUBLIC_FILES else None


def fetch_public(name):
    """Fetch one public feed file; raise RuntimeError on failure."""
    result = subprocess.run(
        ["curl", "-q", "--fail", "--silent", "--show-error", "--max-time", "15", REMOTE + name],
        capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError("Public feed could not be fetched")
    return result.stdout


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == APP_MODULE:
            try:
                payload = rewrite_app_module((ROOT / "src/app/app.js").read_bytes())
            except ValueError as error:
                self.send_error(500, str(error))
                return
            self.send_payload(payload, "text/javascript")
        elif path.startswith(PROXY_PREFIX):
            name = proxy_name(path)
            if name is None:
                self.send_error(404)
                return
            try:
                payload = fetch_public(name)
            except RuntimeError as error:
                self.send_error(502, str(error))
                return
            self.send_payload(payload, "application/json")
        else:
            super().do_GET()

    def send_payload(self, payload, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main(argv=None):
    parser = argparse.ArgumentParser(description="SirenTO local preview server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    print(f"SirenTO local preview: http://localhost:{args.port} (public-feed proxy enabled)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler).serve_forever()


if __name__ == "__main__":
    main()
