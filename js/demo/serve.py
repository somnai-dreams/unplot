"""Dev server for the demo with caching disabled, so a rebuilt bundle is always picked up on reload.
Plain `python -m http.server` lets the browser cache app.js, which serves a stale bundle after a rebuild."""
import functools
import http.server
from pathlib import Path

DIST = str(Path(__file__).parent / "dist")
PORT = 8099


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


handler = functools.partial(NoCache, directory=DIST)
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"serving {DIST} at http://localhost:{PORT} (no-cache)")
    httpd.serve_forever()
