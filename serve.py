#!/usr/bin/env python3
"""
serve.py — static file server with HTTP Range support.

Serves the whole project (index.html, viewer.js/css, catalog, and data/) over
HTTP. Python's stdlib `http.server` ignores the `Range` header and always
returns the whole file (200); the viewer paginates multi-GB JSONL with Range
requests, so this adds `206 Partial Content` support — and nothing else.
(S3 / CloudFront support Range natively, so this is only for local use.)

Usage:  python3 serve.py [port]      # default port 8077
        open http://localhost:8077/
"""

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import build_catalog

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()  # let base handle 404 / directories

        m = RANGE_RE.search(rng)
        if not m:
            return super().send_head()

        size = os.path.getsize(path)
        start_s, end_s = m.group(1), m.group(2)
        if start_s == "":  # suffix range: bytes=-N (last N bytes)
            start = max(0, size - int(end_s))
            end = size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        length = end - start + 1
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        return _LimitedReader(f, length)

    def copyfile(self, source, outputfile):
        if isinstance(source, _LimitedReader):
            remaining = source.remaining
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
            source.close()
        else:
            super().copyfile(source, outputfile)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


class _LimitedReader:
    def __init__(self, fileobj, length):
        self._f = fileobj
        self.remaining = length

    def read(self, n=-1):
        return self._f.read(n)

    def close(self):
        self._f.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    port = int(args[0]) if args else 8077

    if "--no-build" not in sys.argv:
        print("Rebuilding catalog from data/ …")
        try:
            build_catalog.main()
        except Exception as e:  # serve stale catalog.js rather than fail to start
            print(f"  catalog build failed ({e}); serving existing catalog.js")

    srv = ThreadingHTTPServer(("", port), RangeHandler)
    print(f"Serving {os.getcwd()} with Range support at http://localhost:{port}/")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
