package cc.yellowmellow.crm;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * La app de Android (D-101): una WebView con la misma interfaz que el escritorio, servida por
 * el motor desde 127.0.0.1. La WebView solo carga esa dirección; cualquier otro enlace se abre
 * en el navegador del sistema.
 */
public class MainActivity extends Activity implements NativeChannel.Handler {
    private static final String TAG = "CRM-Mellow";
    private static final int REQ_FILES = 1;
    private static final int REQ_SAVE = 2;
    private static final long CLIPBOARD_CLEAR_MS = 60_000;
    private static final int REQ_NOTIFY = 3;
    private static final String NOTIFY_CHANNEL = "avisos";
    private boolean askedNotify = false;
    private int nextNotifyId = 1;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    /** Guardados pendientes: código de petición del selector → {id, ruta}. */
    private final Map<Integer, String[]> pendingSaves = new HashMap<>();
    private int nextSaveCode = 100;

    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // Como al bloquear la sesión en escritorio: se sube lo pendiente y se bloquea.
            NativeChannel.notifyAsync("/native/lock");
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Sin capturas de pantalla ni miniatura en «Recientes»: la app muestra datos privados.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(0x0b, 0x08, 0x07));
        TextView loading = new TextView(this);
        loading.setText(R.string.loading);
        loading.setTextColor(Color.rgb(0xf2, 0xa6, 0x5a));
        loading.setGravity(android.view.Gravity.CENTER);
        root.addView(loading, new FrameLayout.LayoutParams(-1, -1));
        // De borde a borde: las barras del sistema y el teclado se respetan con relleno.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                            | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        setContentView(root);

        registerReceiver(screenOff, new IntentFilter(Intent.ACTION_SCREEN_OFF));

        // Autoprueba del motor (la usa el CI en el emulador): adb shell am start … --ez autoprueba true
        final boolean selfTest = getIntent().getBooleanExtra("autoprueba", false);
        new Thread(() -> {
            try {
                NodeRunner.start(this, selfTest);
                ui.post(this::showWebView);
            } catch (Exception e) {
                Log.e(TAG, "No se ha podido arrancar el motor", e);
                ui.post(() -> loading.setText(R.string.start_failed));
            }
        }, "arranque").start();
    }

    private void showWebView() {
        if (isFinishing() || isDestroyed()) return;
        String origin = "http://127.0.0.1:" + NodeRunner.port();
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.removeAllCookies(null);
        cookies.setCookie(origin, "crm=" + NodeRunner.token() + "; Path=/; HttpOnly; SameSite=Strict");
        cookies.flush();

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(0x0b, 0x08, 0x07));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setSafeBrowsingEnabled(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (url.toString().startsWith(origin + "/")) return false;
                openExternal(url.toString());
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Si el motor de la WebView se cae, se vuelve a crear en lugar de cerrar la app.
                root.removeView(web);
                web.destroy();
                web = null;
                showWebView();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(intent, REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl(origin + "/");
        NativeChannel.attach(this);
    }

    @Override
    public void onRequest(JSONObject req) {
        String id = req.optString("id");
        String kind = req.optString("kind");
        ui.post(() -> {
            switch (kind) {
                case "open":
                    openExternal(req.optString("url"));
                    background(() -> NativeChannel.reply(id, true));
                    break;
                case "clipboard":
                    copy(req.optString("text"), req.optBoolean("secret"));
                    background(() -> NativeChannel.reply(id, true));
                    break;
                case "save":
                    save(id, req.optString("path"), req.optString("name"));
                    break;
                case "notify":
                    notifyUser(req.optString("title"), req.optString("body"));
                    background(() -> NativeChannel.reply(id, true));
                    break;
                case "busy":
                    // Conectar con Google: la app no se congela ni pierde la red al pasar
                    // al navegador (D-118).
                    if (req.optBoolean("on")) BusyService.start(this, req.optString("text"));
                    else BusyService.stop(this);
                    background(() -> NativeChannel.reply(id, true));
                    break;
                default:
                    background(() -> NativeChannel.reply(id, null));
            }
        });
    }

    /**
     * Aviso del sistema (fase 14): el motor solo manda recuentos («2 avisos nuevos»), así que
     * no se guarda en el sistema nada de la bóveda. En Android 13 o posterior se pide permiso
     * la primera vez; si no se da, no se avisa.
     */
    private void notifyUser(String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            if (!askedNotify) {
                askedNotify = true;
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            }
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(
                NOTIFY_CHANNEL, getString(R.string.notify_channel),
                NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, NOTIFY_CHANNEL)
                .setSmallIcon(R.drawable.ic_aviso)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build();
        nm.notify(nextNotifyId++, n);
    }

    private static void background(Runnable r) {
        new Thread(r, "respuesta").start();
    }

    /** Solo https y mailto, en la app que el sistema tenga para ello. */
    private void openExternal(String raw) {
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (Exception e) {
            Log.w(TAG, "No hay ninguna app para abrir el enlace");
        }
    }

    private void copy(String text, boolean secret) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("CRM Mellow", text);
        if (secret) {
            // Android no lo muestra en la vista previa del portapapeles.
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(Build.VERSION.SDK_INT >= 33
                    ? ClipDescription.EXTRA_IS_SENSITIVE : "android.content.extra.IS_SENSITIVE", true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);
        if (secret) {
            ui.postDelayed(() -> {
                ClipData now = cm.getPrimaryClip();
                if (now != null && now.getItemCount() > 0
                        && text.contentEquals(now.getItemAt(0).coerceToText(this)))
                    cm.clearPrimaryClip();
            }, CLIPBOARD_CLEAR_MS);
        }
    }

    private void save(String id, String path, String name) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(name);
        String mime = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime != null ? mime : "application/octet-stream")
                .putExtra(Intent.EXTRA_TITLE, name);
        int code = nextSaveCode++;
        pendingSaves.put(code, new String[]{id, path});
        try {
            startActivityForResult(intent, code);
        } catch (Exception e) {
            pendingSaves.remove(code);
            background(() -> NativeChannel.reply(id, null));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILES) {
            if (fileCallback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    ClipData c = data.getClipData();
                    result = new Uri[c.getItemCount()];
                    for (int i = 0; i < c.getItemCount(); i++) result[i] = c.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        String[] pending = pendingSaves.remove(requestCode);
        if (pending == null) return;
        final String id = pending[0];
        final File file = new File(pending[1]);
        final Uri target = resultCode == RESULT_OK && data != null ? data.getData() : null;
        background(() -> {
            if (target == null) {
                NativeChannel.reply(id, null);
                return;
            }
            try (InputStream in = new FileInputStream(file);
                 OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                NativeChannel.reply(id, displayName(target));
            } catch (Exception e) {
                Log.w(TAG, "No se ha podido guardar el archivo");
                NativeChannel.reply(id, null);
            }
        });
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            // Sin nombre: se usa la dirección.
        }
        return uri.getLastPathSegment();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        // La interfaz decide: cierra el diálogo o panel abierto; si no hay nada, la app pasa
        // a segundo plano (sin cerrarse: el motor sigue y la bóveda no se cierra a medias).
        web.evaluateJavascript("window.__crmBack ? String(window.__crmBack()) : 'false'", (r) -> {
            if (!"\"true\"".equals(r)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onStop() {
        super.onStop();
        NativeChannel.notifyAsync("/native/background");
    }

    /** El botón «Volver a CRM Mellow» de la página de Google trae la app al frente. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(screenOff);
        NativeChannel.detach(this);
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
