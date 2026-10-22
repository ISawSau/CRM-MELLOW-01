package cc.yellowmellow.crm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Servicio en primer plano mientras el usuario conecta con Google o trae la bóveda (D-118).
 *
 * Al pasar al navegador para iniciar sesión, la app queda en segundo plano y Android la
 * congela a los 10 s (Android 14 o posterior) y le corta la red (Android 15 o posterior): la
 * dirección local a la que vuelve Google no contesta y el canje del código falla. Con este
 * servicio el proceso sigue vivo y con red, que es lo que recomienda la documentación de
 * Android para una tarea que ha empezado el usuario y tiene que seguir en segundo plano.
 *
 * Tipo dataSync (descargar la bóveda de Google Drive, sincronizar). Se para cuando el motor
 * termina y, por si acaso, a la hora.
 *
 * También mientras la bóveda sigue desbloqueada tras salir de la app (D-130): sin él, Android
 * cierra el proceso al quitar la app de Recientes y la clave (que solo está en memoria) se
 * pierde. El aviso lo dice y tiene un botón «Bloquear».
 */
public class BusyService extends Service {
    private static final String TAG = "CRM-Mellow";
    private static final String CHANNEL = "trabajo";
    private static final int NOTIFICATION_ID = 7001;
    private static final long MAX_MS = 65 * 60_000;
    private static final String ACTION_LOCK = "cc.yellowmellow.crm.BLOQUEAR";
    /** Quién lo necesita: «trabajo» (Google, sincronizar) o «fuera» (sigue desbloqueada, D-130). */
    static final String WORK = "trabajo";
    static final String AWAY = "fuera";

    private static final Map<String, String> holders = new LinkedHashMap<>();
    private static final Handler timers = new Handler(Looper.getMainLooper());
    private static final Map<String, Runnable> expiries = new HashMap<>();
    private static String lockLabel = null;
    /** Ya ha llamado a startForeground (pararlo antes haría que Android cerrase la app). */
    private static boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable stop = this::stopSelf;

    /** Pide el servicio por un motivo (con un plazo, si se da: luego se suelta solo). */
    static synchronized void hold(Context context, String reason, String text, long forMs) {
        holders.put(reason, text != null ? text : "");
        Runnable old = expiries.remove(reason);
        if (old != null) timers.removeCallbacks(old);
        if (forMs > 0) {
            Context app = context.getApplicationContext();
            Runnable r = () -> release(app, reason);
            expiries.put(reason, r);
            timers.postDelayed(r, forMs);
        }
        start(context);
    }

    /** Ya no hace falta por ese motivo; si nadie más lo necesita, se para. */
    static synchronized void release(Context context, String reason) {
        Runnable old = expiries.remove(reason);
        if (old != null) timers.removeCallbacks(old);
        if (holders.remove(reason) == null) return;
        // Si aún no ha arrancado, se para él solo al arrancar (ver onStartCommand).
        if (holders.isEmpty()) {
            if (running) context.stopService(new Intent(context, BusyService.class));
        } else start(context);
    }

    /** Texto del botón «Bloquear» del aviso mientras sigue desbloqueada. */
    static synchronized void setLockLabel(String label) {
        lockLabel = label;
    }

    private static synchronized String currentText() {
        String text = null;
        for (String t : holders.values()) if (!t.isEmpty()) text = t;
        return text;
    }

    private static synchronized boolean away() {
        return holders.containsKey(AWAY);
    }

    private static void start(Context context) {
        try {
            context.startForegroundService(new Intent(context, BusyService.class));
        } catch (Exception e) {
            // Android no deja empezarlo (la app ya no está a la vista): se sigue sin él.
            Log.w(TAG, "No se ha podido iniciar el servicio en primer plano", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_LOCK.equals(intent.getAction())) {
            // Botón «Bloquear» del aviso: el motor bloquea ya y el aviso se va.
            NativeChannel.notifyAsync("/native/lock-now");
            release(this, AWAY);
            return START_NOT_STICKY;
        }
        String text = currentText();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, getString(R.string.busy_channel), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_aviso)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text != null ? text : getString(R.string.busy_text))
                .setContentIntent(open)
                .setOngoing(true);
        String label;
        synchronized (BusyService.class) {
            label = lockLabel;
        }
        if (away() && label != null && !label.isEmpty()) {
            PendingIntent lock = PendingIntent.getService(this, 1,
                    new Intent(this, BusyService.class).setAction(ACTION_LOCK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, label, lock).build());
        }
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else
                startForeground(NOTIFICATION_ID, n);
        } catch (Exception e) {
            Log.w(TAG, "No se ha podido pasar a primer plano", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        synchronized (BusyService.class) {
            running = true;
            if (holders.isEmpty()) {
                // Lo han soltado mientras arrancaba (se volvió a la app enseguida).
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        Log.i(TAG, "Servicio en primer plano activo");
        handler.removeCallbacks(stop);
        handler.postDelayed(stop, MAX_MS);
        return START_NOT_STICKY;
    }

    /** Android 15: se ha agotado el tiempo de este tipo de servicio. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(stop);
        // Parado (por tiempo o porque nadie lo necesita): se olvidan los motivos.
        synchronized (BusyService.class) {
            running = false;
            holders.clear();
            for (Runnable r : expiries.values()) timers.removeCallbacks(r);
            expiries.clear();
        }
        Log.i(TAG, "Servicio en primer plano parado");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
