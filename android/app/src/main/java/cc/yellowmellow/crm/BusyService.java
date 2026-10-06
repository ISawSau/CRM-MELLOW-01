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

/**
 * Servicio en primer plano mientras el usuario conecta con Google o trae la bóveda (D-118).
 *
 * Al pasar al navegador para iniciar sesión, la app queda en segundo plano y Android la
 * congela a los 10 s (Android 14 o posterior) y le corta la red (Android 15 o posterior): la
 * dirección local a la que vuelve Google no contesta y el canje del código falla. Con este
 * servicio el proceso sigue vivo y con red, que es lo que recomienda la documentación de
 * Android para una tarea que ha empezado el usuario y tiene que seguir en segundo plano.
 *
 * Tipo dataSync (descargar la bóveda de Google Drive). Se para cuando el motor termina y, por
 * si acaso, a los 20 minutos.
 */
public class BusyService extends Service {
    private static final String TAG = "CRM-Mellow";
    private static final String CHANNEL = "trabajo";
    private static final int NOTIFICATION_ID = 7001;
    private static final long MAX_MS = 20 * 60_000;
    static final String EXTRA_TEXT = "texto";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable stop = this::stopSelf;

    static void start(Context context, String text) {
        Intent intent = new Intent(context, BusyService.class).putExtra(EXTRA_TEXT, text);
        try {
            context.startForegroundService(intent);
        } catch (Exception e) {
            // Android no deja empezarlo (la app ya no está a la vista): se sigue sin él.
            Log.w(TAG, "No se ha podido iniciar el servicio en primer plano", e);
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, BusyService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, getString(R.string.busy_channel), NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_aviso)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text != null && !text.isEmpty() ? text : getString(R.string.busy_text))
                .setContentIntent(open)
                .setOngoing(true)
                .build();
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
        Log.i(TAG, "Servicio en primer plano parado");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
