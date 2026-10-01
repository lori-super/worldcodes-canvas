"""Local browser regression fixture. No requests are forwarded to a real generation API."""
import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
state = {'posts': 0, 'gets': [], 'mode': 'hang', 'fail_ids': []}
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def headers_for(self, status, content_type, size):
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(size))
        self.end_headers()

    def reply(self, value, status=200):
        data = json.dumps(value).encode()
        self.headers_for(status, 'application/json', len(data))
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.headers_for(204, 'text/plain', 0)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/control':
            with lock:
                state.update(json.loads(body))
            self.reply(state)
        elif self.path in ['/v1/images/generations', '/v1/images/edits']:
            with lock:
                state['posts'] += 1
                image_id = state['posts']
            self.reply({'data': [{'url': f'http://127.0.0.1:4318/image/{image_id}.png'}]})
        else:
            self.reply({'error': 'Unexpected request'}, 404)

    def do_GET(self):
        if self.path == '/state':
            self.reply(state)
            return
        if not self.path.startswith('/image/'):
            self.reply({'error': 'Unexpected request'}, 404)
            return
        with lock:
            state['gets'].append(self.path)
            mode = state['mode']
            fail = self.path in state['fail_ids']
        if mode == 'fail' or fail:
            self.reply({'error': 'Fixture retrieval unavailable'}, 503)
            return
        self.headers_for(200, 'image/png', len(PNG))
        if mode == 'hang':
            self.wfile.write(PNG[:8])
            self.wfile.flush()
            self.connection.settimeout(70)
            try:
                self.connection.recv(1)
            except (TimeoutError, OSError):
                pass
            return
        self.wfile.write(PNG)

ThreadingHTTPServer(('127.0.0.1', 4318), Handler).serve_forever()
