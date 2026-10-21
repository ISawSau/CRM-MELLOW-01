## Novedades de la 0.19.2 · La sincronización vuelve a funcionar en el móvil

- **Arreglado: en el móvil, sincronizar daba «qualified table names are not allowed…».** El móvil usa una versión de la base de datos algo más antigua que el ordenador y no aceptaba la forma en que la 0.19 apunta los cambios. Ya funciona.
- **Al actualizar el móvil**, la primera sincronización baja lo de la nube y lo junta con lo que tengas en el móvil: no se pierde nada de lo que hiciste en él mientras fallaba.
- **Arreglado también:** en el móvil, cambiar la clave maestra (Ajustes → Seguridad) fallaba.
- A partir de ahora, cada versión se prueba también con la base de datos del móvil antes de publicarse.

## Novedades de la 0.19.1 · La sincronización ya nunca borra lo de otro equipo

- **Arreglado: se podían perder libros y progreso de lectura.**
  - Con la 0.19.0, si un equipo empezaba de nuevo la copia de la nube sin haber bajado antes lo que el otro ya había subido, eso se perdía en los dos. Pasaba al elegir «Quedarme con la de este equipo» o al actualizar los dos equipos a la vez.
  - Ahora, antes de ponerse al día, cada equipo guarda todo lo suyo y luego lo junta con lo de la nube: entra lo que falta y, si algo está en los dos, gana lo último que editaste.
  - Ya no hay avisos para elegir una versión: siempre se juntan.
- **El lector guarda la página al cerrar.** Antes, si cerrabas la app justo después de pasar página, se perdía la última posición. Ahora se guarda al momento al cerrar o al pasar la app a segundo plano, y se sube enseguida.
- **Si perdiste algo con la 0.19.0:** en el equipo donde ocurrió se guardan las 3 últimas copias «antes de sincronizar». En Ajustes → Copias de seguridad, restaura la de justo antes. Lo restaurado llega a los demás equipos.

## Novedades de la 0.19.0 · Sincronización por cambios: rápida, sola y sin conflictos

- **Solo viaja lo que cambia.**
  - Antes, cada sincronización subía y bajaba la base de datos entera.
  - Ahora cada equipo sube sus cambios en paquetes pequeños y cifrados, y los demás bajan solo los nuevos. Pasar una página del libro, crear una tarea o editar un cliente son unos pocos KB.
  - La base de datos entera solo se sube de vez en cuando, desde el ordenador.
- **Sin avisos de conflicto.**
  - Si cambias cosas en el móvil y en el ordenador a la vez, se juntan solas.
  - Si es exactamente el mismo dato, gana el último cambio.
  - Un equipo que lleva días sin conectarse se pone al día sin perder lo que tenía sin subir.
- **Sola y sin que se note:**
  - unos segundos después de cada cambio;
  - al abrir la app o volver a ella;
  - cada minuto mientras está abierta;
  - al cerrarla o pasarla a segundo plano.
  - No enseña «sincronizando» ni da error sin red. Solo verás la barra de progreso si mueve algo grande, como un libro nuevo.
- **Libros y progreso en los dos sitios:**
  - un libro que añades en el ordenador aparece en el móvil (también con datos móviles) y al revés;
  - por dónde vas, en el otro equipo a los pocos segundos.
- **Menos espacio en el móvil:** de las copias «antes de sincronizar» se guardan solo las 3 últimas (antes se guardaban todas).
- **Al actualizar:**
  - La primera sincronización pasa la nube al formato nuevo: una última subida completa y luego ya solo cambios.
  - Actualiza el móvil y el ordenador, porque la versión anterior no entiende el formato nuevo.
  - Si un equipo tenía cambios sin subir de la versión anterior, te pregunta una única vez con cuál te quedas.

## Novedades de la 0.18.1 · La sincronización ya no se queda pillada y letra a tu gusto en el lector

- **Sincronizar con Google Drive desde el móvil:**
  - Si la conexión se corta o Google tarda, lo vuelve a intentar sola. Una subida o descarga grande sigue por donde iba, sin empezar de cero. Ya no se queda en «sincronizando» para siempre: termina o te dice qué ha fallado.
  - Ves lo que hace: «subiendo · 3 de 12 archivos · 4,5 MB de 20 MB». Aparece con una barra en Ajustes, en Perfil y, en el móvil, como una línea fina bajo la barra de arriba.
  - Mientras sincroniza, el móvil no apaga la pantalla. Si cambias de app o la bloqueas, sigue en segundo plano (verás un aviso de Android).
- **Letra del lector (EPUB, MOBI, AZW3, FB2):**
  - Tres letras nuevas pensadas para leer:
    - **Literata**, hecha para leer en pantalla;
    - **Atkinson Hyperlegible**, con letras que no se confunden;
    - **OpenDyslexic**, para dislexia o vista cansada.
  - Cada botón enseña cómo se ve su letra.
  - Tamaño hasta el **400 %**.
  - **Grosor:** normal, más gruesa o negrita, para letra fina o gastada.
  - **Espaciado:** más aire entre letras y palabras.
- **PDF escaneados (libros antiguos):** en un PDF la letra es una imagen y no se puede cambiar, pero ahora puedes:
  - **realzar el texto** (más nítido o alto contraste): aclara el papel amarillento y oscurece la tinta gastada;
  - **recortar márgenes**, para que el texto salga más grande en el móvil.
- En los ajustes del lector ya se marca qué opción tienes elegida.

## Novedades de la 0.18.0 · Biblioteca: lee tus libros en la app (sobre todo en el móvil)

- **Biblioteca nueva** (en el menú, grupo «personal»): añade libros en PDF, EPUB, MOBI, AZW3, FB2 o CBZ, sin DRM. Se guardan cifrados en la bóveda y se sincronizan con tus otros equipos, también el móvil, aunque sean grandes. El título, el autor y la portada salen del propio libro.
- **Lector a pantalla completa:**
  - En el móvil: toca a la derecha o a la izquierda para pasar página (o desliza). El centro muestra u oculta los controles. Opcionalmente pasas página con los botones de volumen, y la pantalla no se apaga mientras lees.
  - En el ordenador: flechas, y dos páginas si caben.
- **A tu gusto:**
  - temas (como la app, papel, sepia, noche y negro);
  - tipo y tamaño de letra, interlineado, márgenes, justificado, atenuar;
  - página a página o continuo;
  - el móvil y el ordenador guardan cada uno su apariencia.
  - En PDF: ajuste a la pantalla, pellizco para ampliar y colores invertidos con los temas oscuros.
- **Seguimiento:**
  - vuelves donde lo dejaste, también en otro equipo;
  - página o posición, porcentaje y cuánto te queda del capítulo y del libro con tu ritmo;
  - racha de días, tiempo de hoy y de la semana, objetivo de libros al año;
  - tarjeta «Lectura» en Inicio para seguir con un toque.
- **Seguro:** el libro se abre aislado de la app, sin poder ejecutar código ni conectarse a internet.

## Novedades de la 0.17.1 · El móvil, sin cosas montadas ni cortadas

- **Perfil:** al desplazarte, la foto y tus datos se mueven con la página, sin montarse sobre las cifras. La foto ocupa menos.
- **Tablas (Clientes, Tareas…):** el nombre ya no se queda fijo tapando las demás columnas. Toda la fila se desplaza a lo ancho.
- **Ajustes de sección, confirmaciones y menús:** los ajustes de cada sección, «Vaciar la papelera» y los demás diálogos salen enteros, abajo y a lo ancho. Filtrar, Ordenar, Columnas y Vista se abren igual, sin salirse por la derecha. Los campos, las opciones y los filtros se reparten en dos líneas.
- **Campañas:** estadísticas de dos en dos y más pequeñas. «Campañas › conjunto › anuncio» va debajo de ellas, justo encima de la tabla (también en el ordenador).
- **Análisis:** los widgets ya no se montan unos encima de otros: cifras de dos en dos y gráficos a lo ancho.
- **Papelera y cuentas de Meta:** cada elemento en su bloque, con el nombre arriba y los botones debajo.

## Novedades de la 0.17.0 · Actualizar desde la app

- **Actualizar con un botón:** cuando hay versión nueva, pulsa **Actualizar** en el aviso (o en Ajustes → Actualizaciones). La app baja el archivo de tu sistema desde GitHub, comprueba su huella SHA-256 y lo instala:
  - en Windows abre el instalador y se cierra;
  - con el AppImage se sustituye y se vuelve a abrir;
  - en Arch (.pacman) lo deja en Descargas y te da el comando `sudo pacman -U` para copiar;
  - en Android abre el instalador del sistema (la primera vez pide permitir a CRM Mellow instalar apps).
- **El aviso sale antes:** la app mira si hay versión nueva al abrir la bóveda y cada hora (antes, una vez al día). En Ajustes → Actualizaciones hay un botón **Buscar ahora** y se ve cuándo se comprobó por última vez.
- **Pantalla de contraseña en el móvil:** ya no se corta al abrir el teclado. La animación va encima del formulario sin taparlo, el botón ocupa todo el ancho y no sale la ruta interna de la bóveda.
- **Animación aleatoria por defecto:** la pantalla de contraseña muestra una animación distinta cada vez. Si eliges una en Ajustes, se queda la tuya.
- **Tablas como en Meta:** en Campañas, Creatividades, Facturación y Comparar, la tabla no pasa del alto de la ventana. La barra para desplazarte en horizontal está siempre a la vista y la cabecera se queda fija.

## Novedades de la 0.16.9

- **Móvil, traer la bóveda desde Google Drive:** arreglado que se quedara en «Esperando a Google…». Android congelaba la app a los pocos segundos de pasar al navegador y la dirección a la que vuelve Google no contestaba. Ahora, mientras conectas con Google, la app sigue activa (verás un aviso «Conectando con Google…») y la página de Google tiene un botón **Volver a CRM Mellow**.
- **Cada paso a la vista:** iniciar sesión, conectar, buscar la bóveda y descargarla (con los MB que lleva). Puedes cancelar, y si sales y vuelves a la app sigue donde estaba.
- **Si el navegador no vuelve a la app:** copia la dirección de la barra del navegador (empieza por http://127.0.0.1) y pégala en «¿El navegador no vuelve a CRM Mellow?». Sirve también al conectar Google Drive o Gmail en Ajustes.
- **Errores claros:** id o secreto no reconocidos, código caducado, la API de Google Drive sin activar en tu proyecto, otra cuenta de Google sin bóveda o sin conexión (con el permiso de red de GrapheneOS), cada uno con lo que hay que hacer.
- **Volver a traerla:** arreglado que, tras traer una bóveda, la pantalla de «Traer desde Google Drive» se cerrara sola la siguiente vez.

## Novedades de la 0.16.8

- **Móvil, conectar con Google:** arreglado el «fetch failed» al traer la bóveda desde Google Drive (o conectar Drive o Gmail) en el móvil. Android 15 corta la red a las apps que no están en pantalla, y la app intentaba terminar la conexión mientras seguías en el navegador. Ahora espera a que vuelvas: tras iniciar sesión en Google, vuelve a CRM Mellow y termina sola.
- **Checklist sin elementos perdidos:** si añadías dos elementos seguidos muy rápido, el primero podía desaparecer. Ya no pasa.

## Novedades de la 0.16.7

- **Móvil, conexión con Google:** arreglos de red en la app de Android para la conexión con Google tras iniciar sesión (prueba IPv4 si el IPv6 de la red falla) y, si aun así falla, el mensaje dice la causa concreta en lugar de «fetch failed».

## Novedades de la 0.16.6

- **Errores de Google claros:** si algo falla al traer la bóveda desde Google Drive o al conectar Drive, la app dice qué ha pasado (tiempo agotado, conexión cancelada, id de cliente no válido…) en lugar de «Ha ocurrido un error inesperado».

## Novedades de la 0.16.5

- **Aviso de versión nueva:** cuando sale una versión, la app te lo dice con un aviso y un botón para descargarla. Lo consulta una vez al día en GitHub, sin enviar ningún dato tuyo, y se apaga en Ajustes → Actualizaciones.
- **Código abierto:** el repositorio es público, con licencia MIT, y el README está en inglés y en español.

## Novedades de la 0.16.4

- **Conectar con Google sin errores de copia:** la app limpia los espacios que el teclado del móvil puede meter en el id y el secreto de cliente, y si el id no es de Google (tiene que terminar en `.apps.googleusercontent.com`) te avisa antes de abrir el navegador. Los campos ya no se autocorrigen.

## Novedades de la 0.16.3

- **Elegir la cuenta de Google:** al conectar Google Drive o Gmail, Google te deja elegir siempre con qué cuenta entrar, aunque el navegador tenga otra abierta. Si no sale la tuya, pulsa «Usar otra cuenta».

## Novedades de la 0.16.2

- **Logo nuevo:** el iris de yellowmellow con su nuevo diseño, en el icono de la app (Windows, Linux y Android), en la barra lateral y en la pantalla de contraseña.

## Novedades de la 0.16.1

- **App de Android publicada:** desde esta versión el APK firmado (`CRM-Mellow-0.16.1-android-arm64.apk`) está aquí, en Assets, junto a los instaladores de escritorio. Mira las instrucciones de Android más abajo.

## Novedades de la 0.16.0 · Rendimiento y negocio

- **Colores según el objetivo:** pon en la ficha del cliente su CPA objetivo (o ROAS objetivo) y, en Campañas, activa «Colores según el objetivo»: cada campaña, conjunto y anuncio sale en verde si lo cumple y de amarillo a rojo cuanto más se pasa.
- **Ritmo de gasto del mes:** pon el presupuesto publicitario mensual del cliente y en Inicio verás cuánto lleva gastado, cuánto gastará a fin de mes a este ritmo y si va bien, se queda corto o se pasa.
- **Fatiga creativa:** la app avisa cuando a un anuncio le cae el CTR y le sube la frecuencia o el coste, para que sepas qué creatividades renovar.
- **Avisos del sistema:** avisos nuevos de Campañas y, una vez al día, las tareas para hoy o atrasadas (solo dicen cuántos hay). Se apagan en Análisis → Alertas.
- **Tests A/B:** nueva sección para apuntar cada test con su hipótesis y sus anuncios A y B; la app calcula el resultado con los datos de Meta y te dice si hay un ganador claro.
- **Rentabilidad y resumen semanal:** beneficio por hora en Facturación y, en la ficha del cliente, un resumen de la semana listo para copiar y pegar.
- **Lista de arranque:** cada cliente nuevo empieza con la lista de lo que hay que dejar listo (accesos, píxel, API de conversiones, dominio…).

## Novedades de la 0.15.1

- **Ver un anuncio con un clic:** en Campañas, al nivel de anuncio, y en los anuncios vinculados a una creatividad, pulsa el nombre del anuncio y se abre en el navegador tal como lo ve la gente (vista previa de Meta). El enlace aparece tras la siguiente sincronización con Meta.
- **Hold rate estándar:** por defecto ahora es el de 15 s: de quienes ven 3 segundos del vídeo, qué porcentaje llega a 15 (ThruPlays / reproducciones de 3 s). Si habías puesto tu propia fórmula, se mantiene. Se cambia en los ajustes de Campañas.

## Novedades de la 0.15.0 · App de Android

- **CRM Mellow en el móvil (Android, pensado para GrapheneOS):** la misma app, con el mismo motor y los mismos datos cifrados, adaptada a pantalla táctil: barra superior con menú, búsqueda, cronómetro y bloqueo; barra inferior con Inicio, Clientes, Tareas y Campañas; fichas a pantalla completa y botón «atrás».
- **Traer desde Google Drive:** en el móvil (o en un ordenador nuevo) bajas tu bóveda sincronizada y la abres con tu contraseña de siempre. A partir de ahí se sincroniza como un ordenador más.
- En el móvil se bloquea al apagar la pantalla, no deja hacer capturas y no entra en las copias de Android. Las herramientas de vídeo y PDF y los informes en PDF siguen siendo solo de escritorio.
- En escritorio, con la ventana muy estrecha, la app también usa la disposición del móvil.
