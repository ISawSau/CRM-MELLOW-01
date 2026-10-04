package cc.yellowmellow.crm;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Canal con el motor (D-101): el motor pide cosas que solo puede hacer Android (guardar un
 * archivo donde elija el usuario, copiar al portapapeles, abrir un enlace) por
 * /native/events, y la app responde por /native/reply. También avisa al motor de que la
 * pantalla se ha apagado o la app ha pasado a segundo plano.
 */
final class NativeChannel {
    interface Handler {
        /** Atiende una petición; tiene que acabar llamando a `reply(id, valor)`. */
        void onRequest(JSONObject request);
    }

    private static final String TAG = "CRM-Mellow";
    /** La actividad visible; las peticiones que llegan sin ninguna se responden con null. */
    private static volatile Handler handler;
    private static boolean listening = false;

    /** Un solo canal por proceso (como el motor); la actividad se engancha y se suelta. */
    static synchronized void attach(Handler h) {
        handler = h;
        if (listening) return;
        listening = true;
        Thread t = new Thread(NativeChannel::listen, "canal-nativo");
        t.setDaemon(true);
        t.start();
    }

    static void detach(Handler h) {
        if (handler == h) handler = null;
    }

    private static HttpURLConnection open(String path) throws IOException {
        URL url = new URL("http://127.0.0.1:" + NodeRunner.port() + path);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setRequestProperty("Cookie", "crm=" + NodeRunner.token());
        return c;
    }

    private static void listen() {
        while (true) {
            HttpURLConnection c = null;
            try {
                c = open("/native/events");
                c.setReadTimeout(0);
                BufferedReader in = new BufferedReader(
                        new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                String line;
                while ((line = in.readLine()) != null) {
                    if (!line.startsWith("data: ")) continue;
                    try {
                        JSONObject request = new JSONObject(line.substring(6));
                        Handler h = handler;
                        if (h != null) h.onRequest(request);
                        else reply(request.optString("id"), null);
                    } catch (Exception e) {
                        Log.w(TAG, "Petición del motor no válida");
                    }
                }
            } catch (IOException e) {
                // El motor aún no escucha o se ha cortado: se reintenta.
            } finally {
                if (c != null) c.disconnect();
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    static void reply(String id, Object value) {
        try {
            JSONObject body = new JSONObject();
            body.put("id", id);
            body.put("value", value == null ? JSONObject.NULL : value);
            post("/native/reply", body.toString());
        } catch (Exception e) {
            Log.w(TAG, "No se ha podido responder al motor");
        }
    }

    /** POST sin esperar nada (se llama fuera del hilo principal). */
    static void post(String path, String json) throws IOException {
        HttpURLConnection c = open(path);
        try {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    static void notifyAsync(String path) {
        new Thread(() -> {
            try {
                post(path, "{}");
            } catch (IOException ignored) {
                // Sin motor no hay nada que bloquear ni subir.
            }
        }, "aviso-motor").start();
    }
}
