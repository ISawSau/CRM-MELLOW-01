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
