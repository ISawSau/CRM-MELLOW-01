package cc.yellowmellow.crm;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.SecureRandom;

/**
 * El motor de la app (el mismo de escritorio) corre en Node, dentro de este proceso, con
 * nodejs-mobile (D-101). Node solo se puede arrancar una vez por proceso: si la actividad se
 * recrea, se reutiliza el que ya está en marcha.
 */
final class NodeRunner {
    private static final String TAG = "CRM-Mellow";

    static {
        System.loadLibrary("node");
        System.loadLibrary("crmnode");
    }

    private static native int startNode(String[] arguments, String stderrPath);

    private static boolean started = false;
    private static int port;
    private static String token;

    static synchronized boolean isStarted() {
        return started;
    }

    static int port() {
        return port;
    }

    static String token() {
        return token;
    }

    /** Arranca el motor (si no lo está ya) y devuelve cuando escucha en su puerto. */
    static synchronized void start(Context context, boolean selfTest) throws IOException {
        if (started) return;
        Context app = context.getApplicationContext();
        File project = copyProject(app);
        File datos = new File(app.getFilesDir(), "datos");
        //noinspection ResultOfMethodCallIgnored
        datos.mkdirs();
        logPreviousStart(new File(datos, "arranque.txt"));
        final File stderr = new File(datos, "errores-motor.txt");
        logPreviousStart(stderr);
        port = freePort();
        token = randomToken();
        java.util.List<String> list = new java.util.ArrayList<>(java.util.Arrays.asList(
            "node",
            new File(project, "backend/main.js").getAbsolutePath(),
            "--port", Integer.toString(port),
            "--token", token,
            "--data", new File(app.getFilesDir(), "datos").getAbsolutePath(),
            "--cache", app.getCacheDir().getAbsolutePath(),
            "--native", app.getApplicationInfo().nativeLibraryDir,
            "--version", BuildConfig.VERSION_NAME));
        if (selfTest) list.add("--autoprueba");
        final String[] args = list.toArray(new String[0]);
        Thread node = new Thread(() -> {
            int code = startNode(args, stderr.getAbsolutePath());
            Log.e(TAG, "El motor se ha detenido (código " + code + ")");
        }, "node");
        node.setDaemon(true);
        node.start();
        started = true;
        waitUntilListening(port);
    }

    /**
     * El motor apunta su arranque en arranque.txt. Si la vez anterior se cayó, lo que escribió
     * queda ahí: se pasa al registro de Android y se empieza de cero.
     */
    private static void logPreviousStart(File file) {
        if (!file.exists()) return;
        for (String line : read(file).split("\n"))
            if (!line.isEmpty()) Log.i(TAG + "-Anterior", file.getName() + ": " + line);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private static String randomToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            return s.getLocalPort();
        }
    }

    private static void waitUntilListening(int port) throws IOException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress("127.0.0.1", port), 500);
                return;
            } catch (IOException e) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException(ie);
                }
            }
        }
        throw new IOException("El motor no ha arrancado");
    }

    /**
     * Node lee archivos del disco, no del APK: el proyecto (motor + interfaz) se copia a la
     * carpeta privada de la app la primera vez y en cada actualización.
     */
    private static File copyProject(Context app) throws IOException {
        File dir = new File(app.getFilesDir(), "nodejs-project");
        File stamp = new File(dir, ".version");
        String version = BuildConfig.VERSION_NAME + "-" + BuildConfig.VERSION_CODE + "-" + lastUpdate(app);
        if (stamp.exists() && version.equals(read(stamp))) return dir;
        deleteRecursively(dir);
        copyAssets(app.getAssets(), "nodejs-project", dir);
        try (OutputStream out = new FileOutputStream(stamp)) {
            out.write(version.getBytes("UTF-8"));
        }
        return dir;
    }

    private static long lastUpdate(Context app) {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).lastUpdateTime;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String read(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int n = in.read(b);
            return new String(b, 0, Math.max(n, 0), "UTF-8");
        } catch (IOException e) {
            return "";
        }
    }

    private static void copyAssets(AssetManager assets, String path, File target) throws IOException {
        String[] children = assets.list(path);
        if (children == null || children.length == 0) {
            target.getParentFile().mkdirs();
            try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        target.mkdirs();
        for (String child : children) copyAssets(assets, path + "/" + child, new File(target, child));
    }

    private static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private NodeRunner() {}
}
