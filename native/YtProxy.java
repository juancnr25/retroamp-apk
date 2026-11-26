package com.jc.retroamp;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Proxy de audio para YouTube.
 * Pide el archivo a googlevideo en tramos de 10 MB (evita la limitación de velocidad),
 * respeta las peticiones Range del reproductor y usa el User-Agent del cliente que obtuvo la URL.
 */
public final class YtProxy {
    private static final long CHUNK = 10L * 1024 * 1024;
    private static final Map<String, Long> SIZES = new LinkedHashMap<String, Long>(32, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Long> e) {
            return size() > 64;
        }
    };

    private YtProxy() {}

    public static WebResourceResponse handle(WebResourceRequest request) {
        Uri u = request.getUrl();
        String target = u.getQueryParameter("u");
        String ua = u.getQueryParameter("ua");
        String mime = u.getQueryParameter("mime");
        if (mime == null || mime.isEmpty()) mime = "audio/webm";
        if (target == null || !target.startsWith("https://")) return error(400, "url inválida");
        if (ua == null) ua = "Mozilla/5.0";
        try {
            long total = totalSize(target, ua, parseLong(u.getQueryParameter("clen")));
            if (total <= 0) return error(502, "tamaño desconocido");

            String range = header(request, "Range");
            long start = 0, end = total - 1;
            boolean partial = false;
            if (range != null && range.startsWith("bytes=")) {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                String a = dash >= 0 ? spec.substring(0, dash).trim() : spec;
                String b = dash >= 0 ? spec.substring(dash + 1).trim() : "";
                if (!a.isEmpty()) {
                    start = Long.parseLong(a);
                    if (!b.isEmpty()) end = Math.min(Long.parseLong(b), total - 1);
                } else if (!b.isEmpty()) {
                    start = Math.max(0, total - Long.parseLong(b));
                }
                if (start >= total) return error(416, "rango fuera de límites");
                partial = true;
            }

            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", String.valueOf(end - start + 1));
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            if (partial) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + total);

            InputStream body = new ChunkedStream(target, ua, start, end);
            return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", headers, body);
        } catch (Exception e) {
            return error(502, e.getMessage() == null ? "error" : e.getMessage());
        }
    }

    private static String header(WebResourceRequest r, String name) {
        Map<String, String> h = r.getRequestHeaders();
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static long parseLong(String s) {
        try {
            return s == null ? 0 : Long.parseLong(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static long totalSize(String target, String ua, long hint) throws IOException {
        if (hint > 0) return hint;
        synchronized (SIZES) {
            Long cached = SIZES.get(target);
            if (cached != null) return cached;
        }
        HttpURLConnection c = open(target, ua, 0, 0);
        try {
            int code = c.getResponseCode();
            if (code != 206 && code != 200) throw new IOException("HTTP " + code);
            String cr = c.getHeaderField("Content-Range");
            long total = 0;
            if (cr != null && cr.contains("/")) total = parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
            if (total <= 0 && code == 200) total = c.getContentLengthLong();
            if (total > 0) {
                synchronized (SIZES) {
                    SIZES.put(target, total);
                }
            }
            return total;
        } finally {
            c.disconnect();
        }
    }

    static HttpURLConnection open(String target, String ua, long from, long to) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(target).openConnection();
        c.setRequestProperty("User-Agent", ua);
        c.setRequestProperty("Range", "bytes=" + from + "-" + to);
        c.setRequestProperty("Accept", "*/*");
        c.setConnectTimeout(15000);
        c.setReadTimeout(25000);
        c.setInstanceFollowRedirects(true);
        return c;
    }

    private static WebResourceResponse error(int code, String msg) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        byte[] b = msg.getBytes();
        return new WebResourceResponse("text/plain", "utf-8", code, "Error", headers, new ByteArrayInputStream(b));
    }

    /** Flujo que se abre por tramos sucesivos contra googlevideo. */
    static final class ChunkedStream extends InputStream {
        private final String url;
        private final String ua;
        private final long end;
        private long pos;
        private long chunkEnd = -1;
        private HttpURLConnection conn;
        private InputStream cur;

        ChunkedStream(String url, String ua, long start, long end) {
            this.url = url;
            this.ua = ua;
            this.pos = start;
            this.end = end;
        }

        private void openNext() throws IOException {
            chunkEnd = Math.min(end, pos + CHUNK - 1);
            conn = open(url, ua, pos, chunkEnd);
            int code = conn.getResponseCode();
            if (code != 206 && code != 200) throw new IOException("googlevideo HTTP " + code);
            cur = conn.getInputStream();
            if (code == 200 && pos > 0) {
                long skip = pos;
                while (skip > 0) {
                    long s = cur.skip(skip);
                    if (s <= 0) throw new IOException("no se pudo avanzar");
                    skip -= s;
                }
            }
        }

        private void closeCur() {
            try {
                if (cur != null) cur.close();
            } catch (IOException ignored) {
            }
            if (conn != null) conn.disconnect();
            cur = null;
            conn = null;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : (one[0] & 0xff);
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            while (true) {
                if (pos > end) return -1;
                if (cur == null) openNext();
                int want = (int) Math.min(len, chunkEnd - pos + 1);
                int n = cur.read(b, off, want);
                if (n < 0) {
                    closeCur();
                    if (pos <= chunkEnd) throw new IOException("tramo incompleto");
                    continue;
                }
                pos += n;
                if (pos > chunkEnd) closeCur();
                return n;
            }
        }

        @Override
        public int available() {
            return 0;
        }

        @Override
        public void close() {
            closeCur();
        }
    }
}
