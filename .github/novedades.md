## Novedades de la 0.14.0 · Tema Mellow, plantillas de correo y horas

- **Tema nuevo de serie: Mellow.** Al estilo de los escritorios de Hyprland:
  - paneles flotantes con huecos y esquinas redondeadas, y borde en degradado ámbar→naranja en el panel activo;
  - barras con módulos en píldora, títulos sin mayúsculas y animaciones suaves.
  - El estilo anterior sigue en **Ajustes → Apariencia** como «Clásico oscuro» y «Clásico claro».
- **Todo el estilo se configura** en el editor de temas: disposición (flotante o clásica), huecos, borde, transparencia, opacidad, desenfoque, animaciones y títulos.
  - Transparencia «cristal»: fondo dentro de la app y paneles desenfocados.
  - Transparencia «ventana»: se ve el escritorio; en Hyprland lo desenfoca el compositor y en Windows 11 se usa el efecto acrílico. Se aplica al reabrir la app.
  - De serie, sin transparencia.
- **Plantillas de correo.** En **Ajustes → Plantillas de correo**, con variables como `{nombre}`, `{cliente}` o `{mes}`. En la ficha de un cliente o contacto, «Escribir correo…» la rellena y la abre en Gmail o en tu programa de correo. La app no envía nada.
- **Registro de horas.** Nueva sección **Horas** y un cronómetro en la barra inferior: escribe en qué trabajas, elige el cliente y páralo al acabar. Facturación muestra las horas de cada cliente y lo facturado por hora.
- **Arreglado:** la animación de gravedad de la pantalla de contraseña podía dar un error interno en el primer fotograma (no se veía nada raro, pero quedaba registrado).
