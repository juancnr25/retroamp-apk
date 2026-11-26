package com.jc.retroamp;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Proxy de radios en vivo.
 * Sirve el stream desde el mismo origen de la app (sin bloqueos CORS ni de contenido mixto http/https),
 * sigue redirecciones http→https y separa los metadatos ICY para mostrar la canción que suena.
 */
public final class RadioProxy {
    public static volatile String currentTitle = "";
    public static volatile String currentUrl = "";
    private static final String UA = "Mozilla/5.0 (Linux; Android 14; 2201123G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

    private RadioProxy() {}

    public static WebResourceResponse handle(WebResourceRequest request) {
        Uri u = request.getUrl();
        String target = null;
        String path = u.getEncodedPath();
        // Forma de ruta: /_radio/h/<esquema>/<host>/<ruta original>?<consulta>
        // Conserva la ruta para que las listas HLS resuelvan bien sus segmentos relativos.
        if (path != null && path.startsWith("/_radio/h/")) {
            String rest = path.substring("/_radio/h/".length());
            int a = rest.indexOf('/');
            if (a > 0) {
                String scheme = rest.substring(0, a);
                String hostAndPath = rest.substring(a + 1);
                if (scheme.equals("http") || scheme.equals("https")) {
                    String q = u.getEncodedQuery();
                    target = scheme + "://" + hostAndPath + (q != null && !q.isEmpty() ? "?" + q : "");
                }
            }
        } else {
            target = u.getQueryParameter("u");
        }
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) return error(400, "url inválida");
        try {
            HttpURLConnection c = null;
            String url = target;
            for (int hop = 0; hop < 6; hop++) {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(false);
                // Agente de navegador: algunos servidores de radio rechazan agentes desconocidos
                c.setRequestProperty("User-Agent", UA);
                boolean segment = url.contains(".m3u8") || url.contains(".ts") || url.contains(".m4s");
                if (!segment) c.setRequestProperty("Icy-MetaData", "1");
                c.setRequestProperty("Accept", "*/*");
                c.setRequestProperty("Accept-Language", "es-PE,es;q=0.9");
                c.setConnectTimeout(12000);
                c.setReadTimeout(30000);
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    if (loc == null) return error(502, "redirección sin destino");
                    url = new URL(new URL(url), loc).toString();
                    continue;
                }
                if (code != 200) {
                    c.disconnect();
                    return error(502, "radio HTTP " + code);
                }
                break;
            }
            if (c == null) return error(502, "demasiadas redirecciones");

            String type = c.getContentType();
            if (type == null || type.isEmpty() || type.startsWith("text/html")) type = "audio/mpeg";
            String mime = type.split(";")[0].trim();
            if (mime.equals("audio/aacp") || mime.equals("audio/x-aac")) mime = "audio/aac";

            int metaint = 0;
            try {
                String mi = c.getHeaderField("icy-metaint");
                if (mi != null) metaint = Integer.parseInt(mi.trim());
            } catch (NumberFormatException ignored) {
            }
            if (metaint > 0 || !target.equals(currentUrl) && !(target.contains(".ts") || target.contains(".m4s"))) {
                currentTitle = "";
                currentUrl = target;
            }
            InputStream raw = c.getInputStream();
            InputStream body = metaint > 0 ? new IcyStream(raw, metaint, target) : raw;

            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime, null, 200, "OK", headers, body);
        } catch (Exception e) {
            return error(502, e.getMessage() == null ? "error" : e.getMessage());
        }
    }

    private static WebResourceResponse error(int code, String msg) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, "Error", headers, new ByteArrayInputStream(msg.getBytes(StandardCharsets.UTF_8)));
    }

    /** Quita los bloques de metadatos ICY del audio y guarda el título actual. */
    static final class IcyStream extends InputStream {
        private final InputStream in;
        private final int metaint;
        private final String owner;
        private int left;

        IcyStream(InputStream in, int metaint, String owner) {
            this.in = in;
            this.metaint = metaint;
            this.left = metaint;
            this.owner = owner;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n < 0 ? -1 : (one[0] & 0xff);
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left == 0) {
                readMeta();
                left = metaint;
            }
            int n = in.read(b, off, Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        private void readMeta() throws IOException {
            int lenByte = in.read();
            if (lenByte < 0) return;
            int len = lenByte * 16;
            if (len == 0) return;
            byte[] meta = new byte[len];
            int got = 0;
            while (got < len) {
                int n = in.read(meta, got, len - got);
                if (n < 0) break;
                got += n;
            }
            String s = decode(meta, got);
            int i = s.indexOf("StreamTitle='");
            if (i >= 0) {
                int start = i + 13;
                int end = s.indexOf("';", start);
                if (end < 0) end = s.lastIndexOf('\'');
                if (end > start && owner.equals(currentUrl)) currentTitle = s.substring(start, end).trim();
            }
        }

        private static String decode(byte[] b, int len) {
            String utf = new String(b, 0, len, StandardCharsets.UTF_8);
            if (utf.indexOf('�') >= 0) return new String(b, 0, len, StandardCharsets.ISO_8859_1);
            return utf;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
