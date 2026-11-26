#!/usr/bin/env python3
"""
RetroAmp · Servidor de YouTube con yt-dlp (para Termux en Android o para tu PC).

Endpoints
  GET /ping                      -> estado y versión de yt-dlp
  GET /search?q=texto&n=20       -> resultados de búsqueda en JSON
  GET /stream/<id>?fmt=opus|m4a  -> audio con soporte de Range y CORS (reproducir o descargar)
  GET /radio?u=<url>             -> radio en vivo reenviada con CORS (versión web)

Uso
  python retroamp_server.py              # solo este dispositivo (127.0.0.1:8765)
  python retroamp_server.py --lan        # visible en tu red Wi-Fi (0.0.0.0:8765)
  python retroamp_server.py --port 9000

Requisitos
  pip install -U "yt-dlp[default]"
  y un motor JavaScript para YouTube: Deno (recomendado) o Node.js
"""
import argparse
import json
import shutil
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import yt_dlp
except ImportError:
    print('Falta yt-dlp. Instálalo con:  pip install -U "yt-dlp[default]"')
    sys.exit(1)

CHUNK = 10 * 1024 * 1024        # YouTube limita la velocidad de rangos grandes: se pide por tramos de 10 MB
CACHE_TTL = 60 * 60 * 4         # las URL de googlevideo duran ~6 h
_cache = {}
_lock = threading.Lock()


def js_runtimes():
    found = {}
    for name, exe in (('deno', 'deno'), ('node', 'node'), ('bun', 'bun'), ('quickjs', 'qjs')):
        path = shutil.which(exe)
        if path:
            found[name] = {'path': path}
    return found


RUNTIMES = js_runtimes()


def ydl_opts(**extra):
    opts = {'quiet': True, 'no_warnings': True, 'noplaylist': True, 'skip_download': True}
    if RUNTIMES:
        opts['js_runtimes'] = RUNTIMES
    opts.update(extra)
    return opts


def resolve(video_id, fmt):
    key = (video_id, fmt)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit['t'] < CACHE_TTL:
            return hit
    if fmt == 'm4a':
        selector = 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio'
    else:
        selector = 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio'
    with yt_dlp.YoutubeDL(ydl_opts(format=selector)) as ydl:
        info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
    if 'requested_formats' in info:
        f = info['requested_formats'][0]
    else:
        f = info
    ext = f.get('ext') or 'webm'
    mime = 'audio/webm' if ext in ('webm', 'weba') else 'audio/mp4' if ext in ('m4a', 'mp4') else f'audio/{ext}'
    data = {
        't': time.time(),
        'url': f['url'],
        'headers': f.get('http_headers') or info.get('http_headers') or {},
        'mime': mime,
        'size': f.get('filesize') or f.get('filesize_approx') or 0,
        'title': info.get('title') or video_id,
        'abr': f.get('abr') or 0,
    }
    with _lock:
        _cache[key] = data
    return data


def upstream(data, start, end):
    headers = dict(data['headers'])
    headers['Range'] = f'bytes={start}-{end}'
    req = urllib.request.Request(data['url'], headers=headers)
    return urllib.request.urlopen(req, timeout=30)


def total_size(data):
    if data.get('size_exact'):
        return data['size_exact']
    with upstream(data, 0, 0) as r:
        cr = r.headers.get('Content-Range', '')
        total = int(cr.split('/')[-1]) if '/' in cr and cr.split('/')[-1].isdigit() else 0
    if total:
        data['size_exact'] = total
    return total


class Handler(BaseHTTPRequestHandler):
    server_version = 'RetroAmpYT/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), fmt % args))

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Range, Content-Type')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        try:
            if u.path == '/ping':
                return self.send_json({'ok': True, 'yt_dlp': yt_dlp.version.__version__,
                                       'js_runtime': ', '.join(RUNTIMES) or None})
            if u.path == '/search':
                return self.search(qs)
            if u.path == '/radio':
                return self.radio((qs.get('u') or [''])[0], head)
            if u.path.startswith('/radio/h/'):
                # Forma de ruta (HLS): /radio/h/<esquema>/<host>/<ruta>?<consulta>
                scheme, _, rest = u.path[len('/radio/h/'):].partition('/')
                return self.radio(f'{scheme}://{rest}' + (f'?{u.query}' if u.query else ''), head)
            if u.path.startswith('/stream/'):
                vid = u.path.split('/')[2]
                fmt = (qs.get('fmt') or ['opus'])[0]
                return self.stream(vid, 'm4a' if fmt == 'm4a' else 'opus', head)
            return self.send_json({'error': 'ruta no encontrada'}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa
            try:
                self.send_json({'error': str(e)}, 502)
            except Exception:
                pass

    def search(self, qs):
        q = (qs.get('q') or [''])[0].strip()
        n = max(1, min(40, int((qs.get('n') or ['20'])[0])))
        if not q:
            return self.send_json({'items': []})
        with yt_dlp.YoutubeDL(ydl_opts(extract_flat='in_playlist')) as ydl:
            info = ydl.extract_info(f'ytsearch{n}:{q}', download=False)
        items = []
        for e in info.get('entries') or []:
            vid = e.get('id')
            if not vid or len(vid) != 11:
                continue
            items.append({
                'id': vid,
                'title': e.get('title') or vid,
                'author': e.get('channel') or e.get('uploader') or '',
                'duration': int(e.get('duration') or 0),
                'thumb': f'https://i.ytimg.com/vi/{vid}/mqdefault.jpg',
            })
        return self.send_json({'items': items})

    def radio(self, url, head):
        """Reenvía una radio en vivo con CORS (para la versión web: evita bloqueos http/https)."""
        if not url.startswith(('http://', 'https://')):
            return self.send_json({'error': 'url inválida'}, 400)
        req = urllib.request.Request(url, headers={'User-Agent': 'RetroAmp/1.2', 'Icy-MetaData': '0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            ctype = (r.headers.get('Content-Type') or 'audio/mpeg').split(';')[0]
            if ctype.startswith('text/html'):
                ctype = 'audio/mpeg'
            self.send_response(200)
            self.cors()
            self.send_header('Content-Type', ctype)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            self.end_headers()
            if head:
                return
            self.close_connection = True
            while True:
                buf = r.read(16 * 1024)
                if not buf:
                    break
                self.wfile.write(buf)

    def stream(self, vid, fmt, head):
        if len(vid) != 11:
            return self.send_json({'error': 'id inválido'}, 400)
        data = resolve(vid, fmt)
        try:
            total = total_size(data)
        except urllib.error.HTTPError:
            # URL expirada: se resuelve de nuevo
            with _lock:
                _cache.pop((vid, fmt), None)
            data = resolve(vid, fmt)
            total = total_size(data)
        if not total:
            return self.send_json({'error': 'tamaño desconocido'}, 502)

        rng = self.headers.get('Range')
        start, end = 0, total - 1
        status = 200
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].split(',')[0].partition('-')
            if a.strip():
                start = int(a)
                if b.strip():
                    end = min(int(b), total - 1)
            elif b.strip():
                start = max(0, total - int(b))
            if start >= total:
                self.send_response(416)
                self.cors()
                self.send_header('Content-Range', f'bytes */{total}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            status = 206

        self.send_response(status)
        self.cors()
        self.send_header('Content-Type', data['mime'])
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{total}')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if head:
            return
        pos = start
        while pos <= end:
            stop = min(end, pos + CHUNK - 1)
            with upstream(data, pos, stop) as r:
                while True:
                    buf = r.read(64 * 1024)
                    if not buf:
                        break
                    self.wfile.write(buf)
                    pos += len(buf)
            if pos <= stop:  # tramo incompleto: evita bucle infinito
                break


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def main():
    ap = argparse.ArgumentParser(description='Servidor YouTube para RetroAmp')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--lan', action='store_true', help='escuchar en toda la red local (0.0.0.0)')
    args = ap.parse_args()
    host = '0.0.0.0' if args.lan else '127.0.0.1'
    srv = ThreadingHTTPServer((host, args.port), Handler)
    srv.daemon_threads = True
    print('RetroAmp · servidor YouTube')
    print(f'  yt-dlp {yt_dlp.version.__version__}')
    print(f'  motor JS: {", ".join(RUNTIMES) if RUNTIMES else "NINGUNO (instala deno o nodejs)"}')
    print(f'  En este dispositivo:  http://127.0.0.1:{args.port}')
    if args.lan:
        print(f'  En tu red Wi-Fi:      http://{lan_ip()}:{args.port}')
    print('  Ctrl+C para detener')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nDetenido.')


if __name__ == '__main__':
    main()
