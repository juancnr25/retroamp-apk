package com.jc.retroamp;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * RetroAmp: lectura de la biblioteca de música del teléfono (MediaStore)
 * y servicio en primer plano para que el audio siga sonando con la pantalla apagada.
 */
@CapacitorPlugin(
    name = "RetroNative",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio33"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "audioLegacy"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class RetroNativePlugin extends Plugin {

    private boolean askedNotifications = false;

    private String audioAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audio33" : "audioLegacy";
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(audioAlias(), call, "audioPermCallback");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void audioPermCallback(PluginCall call) {
        if (getPermissionState(audioAlias()) == PermissionState.GRANTED) {
            doScan(call);
        } else {
            call.reject("Permiso de música denegado. Actívalo en Ajustes > Apps > RetroAmp > Permisos.");
        }
    }

    private void doScan(final PluginCall call) {
        new Thread(() -> {
            JSArray list = new JSArray();
            Cursor c = null;
            try {
                Uri collection = Build.VERSION.SDK_INT >= 29
                    ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                    : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                String[] projection = new String[] {
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.MIME_TYPE,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.DATE_ADDED
                };
                String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0 OR " + MediaStore.Audio.Media.DURATION + " >= 30000";
                c = getContext().getContentResolver().query(collection, projection, selection, null, MediaStore.Audio.Media.TITLE + " ASC");
                if (c != null) {
                    int iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                    int iTitle = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int iArtist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int iAlbum = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int iDur = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int iMime = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    int iSize = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                    int iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                    int iAdded = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                    while (c.moveToNext()) {
                        long id = c.getLong(iId);
                        Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                        JSObject o = new JSObject();
                        o.put("id", String.valueOf(id));
                        o.put("uri", uri.toString());
                        o.put("title", c.getString(iTitle));
                        o.put("artist", c.getString(iArtist));
                        o.put("album", c.getString(iAlbum));
                        o.put("duration", c.getLong(iDur));
                        o.put("mime", c.getString(iMime));
                        o.put("size", c.getLong(iSize));
                        o.put("name", c.getString(iName));
                        o.put("dateAdded", c.getLong(iAdded));
                        list.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("tracks", list);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error leyendo la música: " + e.getMessage());
            } finally {
                if (c != null) c.close();
            }
        }).start();
    }

    @PluginMethod
    public void startService(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !askedNotifications && getPermissionState("notifications") != PermissionState.GRANTED) {
            askedNotifications = true;
            requestPermissionForAlias("notifications", call, "notifPermCallback");
            return;
        }
        doStartService(call);
    }

    @PermissionCallback
    private void notifPermCallback(PluginCall call) {
        doStartService(call);
    }

    private void doStartService(PluginCall call) {
        String title = call.getString("title", "RetroAmp");
        Context ctx = getContext();
        Intent i = new Intent(ctx, PlaybackService.class);
        i.putExtra("title", title);
        try {
            if (PlaybackService.running) {
                ctx.startService(i);
            } else {
                ContextCompat.startForegroundService(ctx, i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo iniciar el servicio: " + e.getMessage());
        }
    }

    /** Título de la canción que suena en la radio actual (metadatos ICY). */
    @PluginMethod
    public void radioMeta(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("title", RadioProxy.currentTitle);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, PlaybackService.class));
        call.resolve();
    }
}
