## Novedades de la 0.7.0 · Meta (solo lectura)

- **Nueva sección Campañas.** Conecta tus cuentas publicitarias de Meta pegando el token de un usuario del sistema del Business Manager con el permiso `ads_read`. La pantalla explica cómo crearlo paso a paso. La app **solo lee**: nunca pausa anuncios ni cambia presupuestos.
- **Elige qué cuentas sincronizar y asígnalas a un cliente.** La ficha del cliente muestra sus cuentas publicitarias.
- Al activar una cuenta se descargan los **últimos 30 días** y después, en segundo plano, **todo el histórico que permite Meta (37 meses)**. Si cierras la app, sigue donde lo dejó. El progreso se ve en Campañas y en la barra de abajo.
- Se sincroniza al abrir la app y **cada hora** (configurable). En cada sincronización se vuelven a descargar los últimos 7 días (configurable hasta 28), porque Meta sigue atribuyendo conversiones a días pasados.
- **Rendimiento:** importe gastado, compras, valor, ROAS, coste por compra, CTR de enlace y CPM del periodo elegido, comparados con el periodo anterior, y una tabla campaña → conjunto → anuncio (con miniatura) con totales.
- **Divisas:** cada cuenta guarda sus importes en su moneda y la app los convierte a la que elijas (EUR por defecto) con el tipo oficial del Banco Central Europeo de cada día.
- La tabla completa tipo Ads Manager (columnas configurables, métricas propias, desgloses) llega en la próxima versión.
