"""Local-only API fixture: python3 video-delivery-server.py /path/to/video.mp4.

POST /_mode with {"mode":"complete"|"stall"|"fail"} selects delivery behavior.
GET /_requests exposes counts so refresh/retry tests can assert no new POST.
This fixture never contacts a generation provider.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

video = Path(sys.argv[1]).read_bytes()
mode = "complete"
requests = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204, b"")

    def do_POST(self):
        global mode
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        if self.path == "/_mode":
            mode = json.loads(body)["mode"]
            self.reply(200, b"{}")
        elif self.path == "/v1/videos":
            requests.append(["POST", self.path])
            self.reply(200, b'{"id":"task_canvas_delivery_test","status":"queued"}')
        else:
            self.reply(404, b"{}")

    def do_GET(self):
        if self.path == "/_requests":
            self.reply(200, json.dumps(requests).encode())
            return
        requests.append(["GET", self.path])
        if self.path.endswith("/content"):
            if mode == "fail":
                self.reply(503, b'{"error":{"message":"Fixture download unavailable"}}')
            elif mode == "stall":
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(video)))
                self.end_headers()
                self.wfile.write(video[:1024])
                self.wfile.flush()
                threading.Event().wait(180)
            else:
                self.reply(200, video, "video/mp4")
        elif self.path.startswith("/v1/videos/"):
            self.reply(200, b'{"id":"task_canvas_delivery_test","status":"completed","progress":100}')
        else:
            self.reply(404, b"{}")


print("Video delivery fixture listening on http://127.0.0.1:3078", flush=True)
ThreadingHTTPServer(("127.0.0.1", 3078), Handler).serve_forever()
