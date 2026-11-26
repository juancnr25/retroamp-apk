# Servidor YouTube de RetroAmp (yt-dlp)

RetroAmp busca primero en este servidor (si lo configuras) y después en las instancias públicas Piped e Invidious. Con el servidor propio tienes la conexión más estable y la mejor calidad (Opus ~160 kbps).

## Opción A: Termux en tu Xiaomi (mismo teléfono que la app)

```bash
pkg update && pkg install python nodejs
pip install -U "yt-dlp[default]"
termux-wake-lock            # evita que Android duerma Termux
python retroamp_server.py
```

En RetroAmp: Ajustes → YouTube → Mi servidor: `http://127.0.0.1:8765` → PROBAR SERVIDOR.
Funciona en la PWA y en la APK. Chrome puede pedirte permiso de "acceso a la red local": acéptalo.

## Opción B: tu laptop con Windows (para usar desde el celular por Wi-Fi)

```powershell
pip install -U "yt-dlp[default]"
winget install DenoLand.Deno
python retroamp_server.py --lan
```

El servidor muestra una dirección tipo `http://192.168.1.20:8765`. Escríbela en Ajustes de la **APK**.
La PWA alojada en https no puede llamar a una IP de red local por http (el navegador lo bloquea); desde la PWA usa la opción A.

## Mantenimiento

YouTube cambia su sistema seguido. Si deja de funcionar, actualiza:

```bash
pip install -U "yt-dlp[default]"
```

## Aviso

Descargar audio de YouTube va contra sus términos de servicio. Úsalo solo para contenido propio, con licencia libre o para uso personal bajo tu responsabilidad.
