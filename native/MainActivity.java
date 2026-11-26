package com.jc.retroamp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RetroNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Proxy de audio de YouTube (/_ytproxy) servido desde el mismo origen de la app
        if (this.bridge != null) {
            this.bridge.setWebViewClient(new RetroWebViewClient(this.bridge));
            // MIUI agranda el texto de las apps según el tamaño de letra del sistema.
            // Se limita a 115 % para que el reproductor quepa completo en pantalla.
            android.webkit.WebSettings ws = this.bridge.getWebView().getSettings();
            if (ws.getTextZoom() > 115) ws.setTextZoom(115);
        }
    }
}
