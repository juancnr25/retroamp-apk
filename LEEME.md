# RetroAmp 1.1 · APK con Capacitor (compilada en GitHub Actions)

Misma app que la PWA, más funciones nativas:

- **YouTube directo**: la app pide el audio a YouTube desde tu teléfono, sin servidores intermedios. Un proxy interno (`YtProxy.java`) entrega el audio con soporte de adelantar y retroceder.
- **Escanear música**: lee toda la música del teléfono (MediaStore) sin copiarla.
- **Servicio en primer plano**: la música sigue sonando con la pantalla apagada.
- **Firma fija** (`signing/debug.keystore`): cada APK nueva se instala encima de la anterior y conservas tu biblioteca.

## Cambios de la 1.2

**Audio fluido**
- La reverb y el expansor estéreo dejan de consumir CPU cuando están apagados. Antes la reverb trabajaba aunque estuviera en 0 %.
- Pausar, reanudar, cambiar de canción y activar efectos ahora usan fundidos de 15 a 60 ms: se acabaron los clics.
- YouTube prepara la canción completa antes de sonar y descarga la siguiente mientras escuchas. Un bajón de internet ya no corta la música. Se puede desactivar en Ajustes.
- El visualizador corre a 30 cuadros por segundo y sin sombras: libera CPU para el audio.
- El proceso que reproduce el audio tiene prioridad alta frente al ahorro de energía de MIUI, y el audio se reanuda solo si el sistema lo suspende.

**Radios del Perú**
- Pestaña Radio con las emisoras peruanas del directorio Radio Browser. Ritmo Romántica, La Zona, Moda, Oxígeno, RPP, Exitosa y otras conocidas aparecen primero.
- Muestra la canción que suena en la radio (cuando la emisora la envía), favoritas con estrella y búsqueda por nombre.
- Si la señal se cae, la app se reconecta sola hasta 4 veces.
- El ecualizador y los efectos también funcionan con la radio.

## Cambios de la 1.1.1

- La app cabe completa en pantalla en teléfonos con letra grande o tamaño de pantalla ampliado (MIUI/HyperOS). Antes el reloj del display empujaba el diseño hacia los costados.
- El texto del sistema se limita a 115 % dentro de la app para conservar el diseño.
- Al elegir una canción que tarda en cargar (YouTube o formato raro), la anterior se detiene. Antes su final podía saltar a otra pista y descartar tu elección.
- Los avisos de abajo ya no bloquean los toques sobre la lista.

## Cambios de la 1.1

- YouTube funciona sin configurar nada. Si YouTube cambia su sistema, editas `yt-clients.json` en tu repositorio y la app lo descarga sola (una vez al día o con Ajustes > Actualizar clientes). No necesitas recompilar.
- Ajustes > Probar YouTube directo muestra qué cliente funcionó o el motivo exacto del fallo.
- Interfaz nueva: el ecualizador, los efectos y el volumen viven en paneles que abres con los botones Sonido y Volumen. Los deslizadores solo cambian si arrastras, un toque accidental no los mueve. El candado de arriba bloquea toda la pantalla (para el bolsillo); se desbloquea manteniendo presionado.

**Importante si ya instalaste la 1.0:** la 1.0 se firmó con una llave temporal. Desinstálala una sola vez antes de instalar la 1.1. Desde la 1.1 las actualizaciones se instalan encima.

**Repositorio público o privado:** `yt-clients.json` se descarga desde `raw.githubusercontent.com`, y eso solo funciona si el repositorio es público. Si lo prefieres privado, la app usa la configuración incluida y puedes pegar otra dirección en Ajustes. La llave de `signing/` es de depuración: sirve para tus equipos, no la uses para publicar en Play Store.

## Compilar la APK en GitHub (desde el celular o la PC)

1. Crea un repositorio nuevo en github.com, por ejemplo `retroamp-apk`.
2. Sube el contenido de esta carpeta a la raíz del repo: `www/`, `native/`, `scripts/`, `android-res/`, `signing/`, `server/`, `package.json`, `capacitor.config.json`, `yt-clients.json`.
3. La carpeta `.github` empieza con punto y muchos exploradores de Android la ocultan. Si no la ves, créala desde GitHub:
   Add file → Create new file → nombre `.github/workflows/build-apk.yml` → pega el contenido del archivo `build-apk.yml` incluido (copia en `workflow-build-apk.yml`) → Commit.
4. Ve a la pestaña **Actions** → "Compilar APK de RetroAmp". Arranca solo con cada commit; también puedes lanzarlo con **Run workflow**.
5. Cuando termine (5 a 8 minutos), entra al run → sección **Artifacts** → descarga `RetroAmp-APK` (zip con `RetroAmp.apk`).
6. Instala la APK en el Xiaomi (permite "instalar apps desconocidas" para el navegador o el gestor de archivos).

Con Termux y git también puedes subirlo así:

```bash
cd retroamp-apk
git init && git add -A && git commit -m "RetroAmp 1.1.0"
git branch -M main
git remote add origin https://github.com/juancnr25/retroamp-apk.git
git push -u origin main
```

## Primer uso

1. Abre RetroAmp → **ESCANEAR MÚSICA** → acepta el permiso de música.
2. Al reproducir por primera vez, Android 13+ pide permiso de notificaciones: acéptalo para que el audio no se corte en segundo plano.
3. MIUI/HyperOS: Ajustes → Apps → RetroAmp → Ahorro de batería → **Sin restricciones**. Sin esto, MIUI puede cerrar la app con la pantalla apagada.

## Actualizar la app

Cambia lo que necesites en `www/`, sube el cambio y GitHub compila una APK nueva. Instálala encima de la anterior: conserva tu biblioteca.

## Detalles técnicos

- Capacitor 6.2.1, Java 17, compileSdk 34, minSdk 22 (Android 5.1+).
- `scripts/patch-android.sh` copia el plugin nativo (`native/*.java`), íconos, splash, permisos y el servicio al proyecto que genera `npx cap add android`.
- La APK que sale es de depuración (debug): sirve para instalar en tus equipos, no para Play Store.

## Si YouTube deja de funcionar

1. Abre Ajustes > Probar YouTube directo y lee el resultado.
2. Si todos los clientes fallan, revisa qué clientes usa la última versión de yt-dlp (archivo `yt_dlp/extractor/youtube/_base.py`, sección `INNERTUBE_CLIENTS`) y copia nombre, versión y userAgent en `yt-clients.json`.
3. Sube el cambio a GitHub y toca Actualizar clientes en la app.
4. Mientras tanto, el servidor yt-dlp en Termux (`server/`) sirve de respaldo.
