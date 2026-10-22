package cc.yellowmellow.crm;

/**
 * Test de Navigation (D-128) sin Android ni dependencias: `npm run test:android`.
 */
public final class NavigationTest {
    private static int failures = 0;

    private static void check(String what, Navigation.Action got, Navigation.Action want) {
        if (got != want) {
            failures++;
            System.out.println("MAL " + what + ": " + got + " en vez de " + want);
        } else {
            System.out.println("ok  " + what);
        }
    }

    public static void main(String[] args) {
        String app = "http://127.0.0.1:41234";
        check("la propia app", Navigation.decide(app + "/", app, true), Navigation.Action.LOAD);
        check("un enlace https se abre fuera",
                Navigation.decide("https://example.com/", app, true), Navigation.Action.EXTERNAL);
        check("otro puerto local en la ventana principal no se carga ahí",
                Navigation.decide("http://127.0.0.1:5555/reader.html", app, true),
                Navigation.Action.EXTERNAL);
        check("el marco del lector (otro puerto local)",
                Navigation.decide("http://127.0.0.1:5555/reader.html", app, false),
                Navigation.Action.LOAD);
        check("un capítulo del libro (marco blob:)",
                Navigation.decide("blob:http://127.0.0.1:5555/0b6f3c1e-1111-2222-3333-444455556666",
                        app, false),
                Navigation.Action.LOAD);
        check("un marco vacío", Navigation.decide("about:blank", app, false), Navigation.Action.LOAD);
        check("un marco de internet no se carga",
                Navigation.decide("https://example.com/", app, false), Navigation.Action.BLOCK);
        check("un marco de otro host local no se carga",
                Navigation.decide("http://localhost:5555/", app, false), Navigation.Action.BLOCK);
        if (failures > 0) {
            System.out.println(failures + " fallo(s)");
            System.exit(1);
        }
    }
}
