package cc.yellowmellow.crm;

/**
 * Qué hace la WebView con cada navegación (D-128). Sin nada de Android, para probarlo con un
 * test de Java normal (tests/android).
 *
 * Android también pregunta por los marcos internos, incluidos los «blob:» (lo dice su
 * documentación). El lector de ebooks es un marco en otro puerto local y cada capítulo es un
 * marco blob: dentro de él; si se tratan como enlaces externos, no se cargan y el libro sale
 * en blanco. Esos marcos ya los limita la CSP de la app y la del lector.
 */
final class Navigation {
    enum Action { LOAD, EXTERNAL, BLOCK }

    private Navigation() {}

    static Action decide(String url, String appOrigin, boolean mainFrame) {
        if (url.startsWith(appOrigin + "/")) return Action.LOAD;
        if (mainFrame) return Action.EXTERNAL;
        if (url.startsWith("http://127.0.0.1:") || url.startsWith("blob:http://127.0.0.1:")
                || url.equals("about:blank") || url.equals("about:srcdoc")) return Action.LOAD;
        return Action.BLOCK;
    }
}
