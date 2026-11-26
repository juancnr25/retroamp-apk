package com.jc.retroamp;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** Intercepta /_ytproxy para servir el audio de YouTube desde el mismo origen de la app. */
public class RetroWebViewClient extends BridgeWebViewClient {

    public RetroWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String path = u.getPath();
        if (path != null && path.startsWith("/_ytproxy")) {
            return YtProxy.handle(request);
        }
        return super.shouldInterceptRequest(view, request);
    }
}
