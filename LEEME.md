# RetroAmp · APK con Capacitor (compilada en GitHub Actions)

Misma app que la PWA, más tres funciones nativas:

- **ESCANEAR MÚSICA**: lee toda la música del teléfono (MediaStore) sin copiarla.
- **Servicio en primer plano**: la música sigue sonando con la pantalla apagada (notificación "RetroAmp").
- **Servidor yt-dlp por Wi-Fi**: la APK puede usar tu laptop (`http://192.168.x.x:8765`), cosa que la PWA no permite.

## Compilar la APK en GitHub (desde el celular o la PC)

1. Crea un repositorio nuevo en github.com, por ejemplo `retroamp-apk`.
2. Sube el contenido de esta carpeta a la raíz del repo: `www/`, `native/`, `scripts/`, `android-res/`, `server/`, `package.json`, `capacitor.config.json`.
3. La carpeta `.github` empieza con punto y muchos exploradores de Android la ocultan. Si no la ves, créala desde GitHub:
   Add file → Create new file → nombre `.github/workflows/build-apk.yml` → pega el contenido del archivo `build-apk.yml` incluido (copia en `workflow-build-apk.yml`) → Commit.
4. Ve a la pestaña **Actions** → "Compilar APK de RetroAmp". Arranca solo con cada commit; también puedes lanzarlo con **Run workflow**.
5. Cuando termine (5 a 8 minutos), entra al run → sección **Artifacts** → descarga `RetroAmp-APK` (zip con `RetroAmp.apk`).
6. Instala la APK en el Xiaomi (permite "instalar apps desconocidas" para el navegador o el gestor de archivos).

Con Termux y git también puedes subirlo así:

```bash
cd retroamp-apk
git init && git add -A && git commit -m "RetroAmp 1.0.0"
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
