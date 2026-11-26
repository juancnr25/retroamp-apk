#!/usr/bin/env bash
# Inyecta el código nativo de RetroAmp en el proyecto Android que genera "npx cap add android"
set -euo pipefail
cd "$(dirname "$0")/.."

PKG_DIR=android/app/src/main/java/com/jc/retroamp
RES=android/app/src/main/res
MANIFEST=android/app/src/main/AndroidManifest.xml

mkdir -p "$PKG_DIR"
cp native/*.java "$PKG_DIR/"

# Íconos y splash propios (se quita el ícono adaptativo por defecto de Capacitor)
rm -rf "$RES/mipmap-anydpi-v26"
for d in android-res/*/; do d="${d%/}"
  mkdir -p "$RES/$(basename "$d")"
  cp "$d"/*.png "$RES/$(basename "$d")/"
done

python3 - "$MANIFEST" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
perms = [
    '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
    '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
]
add = '\n    '.join(x for x in perms if x.split('"')[1] not in s)
if add:
    s = s.replace('</manifest>', '    ' + add + '\n</manifest>')
if 'usesCleartextTraffic' not in s:
    s = re.sub(r'<application\b', '<application\n        android:usesCleartextTraffic="true"', s, count=1)
if '.PlaybackService' not in s:
    svc = ('        <service android:name=".PlaybackService" android:exported="false" '
           'android:foregroundServiceType="mediaPlayback" />\n    </application>')
    s = s.replace('</application>', svc, 1)
open(p, 'w', encoding='utf-8').write(s)
print('AndroidManifest.xml listo')
PY
echo "Parche nativo aplicado"
