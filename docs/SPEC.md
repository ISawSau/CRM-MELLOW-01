# Especificación del CRM personal

Versión 0.4.1 · 4 de octubre de 2026

Este documento recoge todas las decisiones de diseño tomadas antes de escribir código. Es la referencia para construir el proyecto fase a fase. Lo que aparece marcado como **verificar** depende de APIs o normativa externa que cambian con el tiempo y debe comprobarse en la documentación oficial antes de implementarlo.

---

## 1. Visión y principios

Una app de escritorio personal para llevar todo el trabajo de media buying en un solo sitio: clientes, cuentas publicitarias, métricas de Meta, tareas, briefs, biblioteca de creatividades y copies, facturación, informes y archivos.

Principios que guían cualquier decisión:

1. **Un solo usuario.** No hay cuentas, roles ni permisos multiusuario.
2. **Local-first.** La app funciona sin internet; internet solo se usa para sincronizar con Meta, Google y otras plataformas.
3. **Gratis.** Ningún componente puede requerir pago.
4. **Portable.** Todos los datos viven en una sola carpeta (la bóveda). Llevar esa carpeta a otro ordenador es llevarse el CRM entero.
5. **Igual en Windows y Linux.** Mismo aspecto, mismas funciones, mismo rendimiento.
6. **Personalizable desde la interfaz.** Campos, etiquetas, estados, pipelines, vistas, columnas, métricas calculadas, dashboards y alertas se configuran sin tocar código.
7. **Fácil de editar.** Añadir, modificar y borrar cualquier cosa debe ser inmediato: edición en línea, deshacer, papelera.
8. **Construcción lenta y sólida.** Primero la base, luego cada módulo completo antes del siguiente.

### Fuera de alcance (por decisión explícita)

- Colaboradores o acceso de terceros.
- Automatizaciones que actúen solas (mover registros, crear tareas automáticamente). Las alertas solo avisan.
- Escritura en Meta (pausar anuncios, cambiar presupuestos).
- Otras plataformas de anuncios (X, LinkedIn): retiradas en la 0.13.3 (D-091).
- Detección de leads duplicados y valor económico de oportunidades (no aplica de momento).
- Notificaciones fuera de la app: los avisos se ven al abrirla.
- En el móvil (fase 13): las herramientas de vídeo y PDF y la generación de informes PDF (D-101).

---

## 2. Decisiones técnicas

| Capa | Elección | Motivo |
|---|---|---|
| Contenedor de escritorio | Electron + electron-builder | Usa el mismo Chromium en Windows y Linux, así que la app se ve y se comporta igual en ambos. Todo el proyecto en un solo lenguaje. |
| Instaladores | NSIS (Windows); paquete pacman y AppImage (Linux, el sistema del usuario es Arch); APK firmado (Android) | Formatos estándar, gratuitos. El paquete pacman se instala con `sudo pacman -U`; el AppImage funciona sin instalar; el APK se instala desde Releases. |
| Móvil (Android, GrapheneOS) | WebView con la misma interfaz + el mismo motor en Node con nodejs-mobile, servidor local con secreto de sesión | Reutiliza todo el código de escritorio en lugar de reescribirlo; mismo cifrado de la base de datos (D-101). |
| Interfaz | React + TypeScript + Vite (electron-vite) | Ecosistema enorme y bien documentado. |
| Tablas | Tabla propia + TanStack Virtual (solo se pintan las filas visibles) | Tablas tipo Ads Manager con miles de filas y columnas configurables. Filtros y orden los hace el motor de datos (D-028). |
| Estado de datos en la UI | TanStack Query sobre IPC | Caché y recarga sencillas. |
| Kanban | dnd-kit | Arrastrar y soltar accesible. |
| Calendario | Componente propio (vista mensual, semana de lunes a domingo) | Vista calendario de tareas y entregas. FullCalendar inyecta estilos que la CSP bloquea (D-029). |
| Gráficas | Apache ECharts | Rinde bien con muchos datos y permite comparativas. |
| Base de datos | SQLite con cifrado compatible con SQLCipher (better-sqlite3-multiple-ciphers, instalado con el alias `better-sqlite3`) | Un archivo, rápido, sin servidor, cifrado completo. |
| ORM y migraciones | Drizzle ORM | Tipado, ligero, migraciones versionadas. |
| Búsqueda global | SQLite FTS5 | Búsqueda instantánea en todo el CRM sin dependencias externas. |
| Derivación de clave | Argon2id (hash-wasm; el Node de Electron no lo incluye) | Estándar actual para derivar claves a partir de contraseñas. |
| Cifrado de archivos | AES-256-GCM por bloques (crypto de Node) | Cifra creatividades y documentos de la bóveda sin cargar archivos enteros en memoria. |
| Fechas y zonas | date-fns + @date-fns/tz, locale es | Formato español y zonas horarias por cliente. |
| Recurrencias | Cálculo propio sobre fechas de calendario (diaria, semanal en días concretos, mensual, anual, cada N) | Tareas recurrentes; sin dependencia (D-041). |
| Fórmulas | Parser propio, sin dependencias, con funciones en español (SI, Y, O, REDONDEAR…) | Métricas calculadas sin riesgo de ejecutar código (D-027). |
| Texto con formato | Tiptap (ProseMirror), sin estilos inyectados | Notas, briefs y descripciones con formato; enlaces solo https y mailto (D-030). |
| Imágenes | Miniaturas, compresión, cambio de tamaño y conversión con el canvas de Chromium | Sin dependencias nativas (D-046, D-074). |
| Vídeo | Miniaturas y duración con Chromium (fase 4); FFmpeg empaquetado y verificado por huella para comprimir y convertir (fase 9) | Sin binarios extra hasta que hagan falta (D-073). |
| PDF | pdf-lib (unir, dividir), pdf.js (comprimir pintando las páginas y vista previa), printToPDF de Electron (informes) | Cubre generación y compresión de PDF gratis, sin binarios (D-075, D-076). |
| Tipos de cambio | Tasas de referencia del BCE descargadas de sus XML oficiales (diario, 90 días e histórico), gratis y sin clave (D-056). | Conversión de divisas sin coste y desde la fuente. |
| Tests | Vitest (lógica) + Playwright para Electron (interfaz) | |
| CI de builds | GitHub Actions (gratis en repos públicos o con minutos gratuitos en privados; **verificar** límites) | Compilar en Windows y Linux reales, necesario por los módulos nativos (SQLite). |

Arquitectura de procesos: el proceso principal de Electron es el único que toca la base de datos, los archivos y las APIs externas. El renderer (la interfaz) se comunica con él mediante IPC tipado. Las sincronizaciones largas (histórico de Meta, subida a Drive) usan E/S asíncrona y escriben por trozos en transacciones cortas para no congelar la interfaz; si algún día no basta, se moverán a un utility process (D-057).

---

## 3. La bóveda (carpeta de datos portable)

Todo lo que el usuario crea vive en una carpeta. La app instalada no guarda datos propios salvo un pequeño archivo de configuración con la ruta de la última bóveda abierta.

```
MiCRM-Boveda/
  vault.json        identificador de la bóveda, versión de esquema, parámetros de Argon2 y ranuras de clave cifradas
  crm.db            base de datos SQLite cifrada
  files/            archivos del usuario, nombrados por hash de contenido y cifrados
    ab/abcdef1234...
  thumbs/           miniaturas cifradas
  backups/          copias locales automáticas (crm.db + vault.json del momento)
  .herramientas/    temporal de las herramientas de vídeo; se vacía al terminar y al bloquear
  .lock             equipo y hora de apertura, con latido mientras está desbloqueada
```

Comportamiento:

- En el primer arranque la app pregunta si crear una bóveda nueva o abrir una existente. Ajustes permite abrir otra o mover la actual.
- Al desbloquear, la app crea `.lock` con el nombre del equipo y la hora, y actualiza un latido cada 30 s. Si ya existe un lock reciente de otro equipo (latido de menos de 2 minutos), avisa de que la bóveda puede estar abierta en otro sitio y permite forzar la apertura. Un lock sin latido se considera abandonado.
- Al cerrar, la app hace un checkpoint del WAL para que `crm.db` quede como un único archivo consistente, sin archivos `-wal` ni `-shm` sueltos, y borra el lock.
- Los archivos se guardan por hash: si subes la misma imagen dos veces, ocupa una sola vez.
- `vault.json` guarda la versión de esquema. Una versión antigua de la app se niega a abrir una bóveda con esquema más nuevo, para evitar corrupción.
- Pasar la carpeta a un USB o disco externo funciona siempre como método manual, aunque no haya sincronización con Drive.
- En un equipo o móvil nuevo, «Traer desde Google Drive» baja la bóveda sincronizada (cifrada) y se desbloquea con la contraseña de siempre. En Android la bóveda vive en la carpeta privada de la app y no se copia en las copias de seguridad de Android (D-101).

---

## 4. Sincronización entre equipos y copias de seguridad

El usuario trabaja en varios ordenadores (Windows y Linux) y algunos pueden estar apagados una semana o más.

Google no ofrece cliente oficial de Google Drive para escritorio en Linux, así que la app sincroniza por su cuenta usando la API de Google Drive. Usará el permiso más restrictivo posible, que solo da acceso a los archivos que crea la propia app (`drive.file`, **verificar**).

### Sincronización

- **Al abrir:** la app consulta en Drive el manifiesto de la bóveda (versión, equipo que la subió, fecha). Si la remota es más nueva que la local, la descarga antes de desbloquear.
- **Al cerrar:** checkpoint, subida de la base de datos y de los archivos nuevos (solo los hashes que no existan ya en Drive).
- **Botón manual** "Sincronizar ahora" en la barra de estado.
- **Conflicto** (los dos lados cambiaron desde la última sincronización común, por ejemplo por cerrar un equipo sin conexión): en la v1 no se fusiona automáticamente. Se muestra un diálogo para elegir qué versión conservar, y la otra se guarda como copia de seguridad.
- Todo se cifra antes de subirse. Google nunca ve datos en claro.

### Copias de seguridad

- Cada 3 días (configurable), una instantánea versionada en una carpeta de copias de Drive y otra en `backups/`.
- Retención por defecto: las 10 últimas más una por mes. Configurable.
- Restaurar una copia desde Ajustes, con vista previa de fecha y tamaño.

### Implementación (fase 5)

- **Destinos:** Google Drive (permiso `drive.file`, verificado como no sensible) o una carpeta del equipo (USB, disco de red o carpeta que ya sincroniza otro programa). Se configura en Ajustes → Sincronización y copias.
- **Al abrir:** como el token de Google vive dentro de la base de datos cifrada, la comprobación se hace justo después de desbloquear (no antes). Si la nube es más nueva y aquí no hay cambios, se descarga y la bóveda se reabre sola; lo de aquí queda como copia en `backups/`.
- **Al cerrar** (bloqueo manual o por inactividad, y al salir de la app, con un minuto de margen) y **cada 30 minutos** si hay cambios, se sube. Al suspender el equipo no hay tiempo de subir: se sube la próxima vez.
- Se suben `crm.db`, `vault.json` y los archivos y miniaturas que falten (por su HMAC). `sync.json` (generación, equipo y fecha) se escribe al final y confirma la subida.
- **Copias:** cada 3 días por defecto, local y en el destino. Retención por defecto: las 10 últimas más la última de cada mes, solo para las automáticas. Las demás (antes de actualizar, de sincronizar, de restaurar…) no se borran solas.
- **Restaurar:** desde Ajustes, con fecha, motivo, tamaño y dónde está la copia. Si es de una contraseña anterior, la bóveda queda bloqueada para entrar con aquella contraseña. Lo restaurado se sube en la próxima sincronización.

### Riesgos a verificar

- Las apps de Google en modo "pruebas" pueden tener tokens de actualización que caducan a los pocos días, lo que obligaría a reconectar Drive y Gmail cada semana. **Verificado (fase 5):** en modo de pruebas con usuarios externos el token caduca a los 7 días; publicando la app (en producción) y pidiendo solo permisos no sensibles como `drive.file`, Google no exige verificación y el token no caduca así. Ajustes explica cómo hacerlo paso a paso.
- Los permisos de Gmail son restringidos: es probable que Google muestre un aviso de "app no verificada" al conectar. Aceptable para uso personal, pero **verificar** límites.

---

## 5. Seguridad

- **Contraseña maestra** al abrir la app. Todo se cifra con una clave maestra aleatoria; en `vault.json` se guarda esa clave cifrada dos veces (dos "ranuras"): con una clave derivada de la contraseña con Argon2id y con otra derivada de la clave de recuperación. La clave maestra nunca se guarda en claro en disco y solo está en memoria mientras la bóveda está desbloqueada.
- **Clave de recuperación**: se genera una vez al crear la bóveda y se muestra para imprimir o guardar. Sirve para poner una contraseña nueva si se olvida la actual. Sin contraseña ni clave de recuperación los datos son irrecuperables, y la interfaz debe decirlo claramente en ese momento.
- **Bloqueo automático** tras un tiempo de inactividad configurable (15 minutos por defecto), y también al suspender el equipo o bloquear la sesión del sistema.
- **Cambiar contraseña** vuelve a cifrar solo la ranura de la contraseña: es instantáneo y no hace falta re-cifrar la base de datos ni los archivos.
- **Rotar la clave** (opcional, desde Ajustes): genera una clave maestra nueva, re-cifra la base de datos y las claves de archivos, y genera una clave de recuperación nueva. Antes hace una copia de seguridad, y está diseñado para completarse aunque se corte a medias.
- Tokens de Meta, Google y otras plataformas se guardan solo dentro de la base de datos cifrada.
- Endurecimiento de Electron según CLAUDE.md.

---

## 6. Motor de datos personalizable (núcleo)

Es la pieza más importante: todo lo demás se construye encima. Inspirado en Notion y Airtable.

### Entidades

Entidades de sistema: perfil, cliente, contacto, pipeline y etapa, oportunidad, tarea, brief, creatividad, copy, factura, nota, archivo, cuenta publicitaria, campaña, ad set y anuncio (estas cuatro últimas sincronizadas desde las plataformas).

En la fase 1 el motor se activa con **Notas** (título, contenido con formato, tipo, etiquetas, fecha y fijada), elegida por el usuario para probarlo con algo real. El resto de entidades se activan en su fase (clientes y contactos en la 2, tareas y briefs en la 3…).

Más adelante (fase 12), colecciones personalizadas: el usuario crea sus propias tablas con los campos que quiera.

*Fase 12:*
- Las colecciones se crean en Ajustes → Colecciones con nombre en plural y en singular, género y letra. Aparecen en la barra lateral, en el grupo «04 colecciones».
- Nacen con los campos «Nombre» y «Notas» y la vista «Todos». Después admiten cualquier campo, vista, relación (también con las entidades de sistema), fórmula, búsqueda, papelera e historial.
- Solo se borran vacías y cuando ninguna otra entidad las enlaza (D-084).

### Campos personalizados

*Arreglos tras la 0.13:* los campos de cada sección se editan desde la propia sección (botón «⚙ Ajustes»), no desde Ajustes generales (D-088).

- Tabla de definiciones: entidad, clave, etiqueta, tipo, configuración, orden, visible, obligatorio.
- Tipos: texto, texto largo con formato, número, moneda, porcentaje, fecha, fecha y hora, casilla, selección, selección múltiple (opciones con color, editables), URL, email, teléfono, archivos, relación con otra entidad, valoración, lista de comprobación, repetición, fórmula y resumen (agregado sobre una relación, p. ej. "gasto total de las campañas de este cliente").
- Filtros de fecha relativos a hoy: es hoy, antes de hoy, próximos 7 días, últimos 7 días y este mes.
- Los valores se guardan en una columna JSON por registro, con el id del campo como clave (así renombrar un campo no toca los datos). Cuando una vista filtra por un campo numérico, de fecha, de selección o casilla, se le crea un índice sobre la expresión JSON.
- Fórmulas: usan la clave del campo (p. ej. `SI(gasto > 0; valor / gasto; 0)`), argumentos separados por «;» como en Excel en español y decimales con punto. Se detectan los errores de sintaxis, los campos inexistentes y las referencias circulares al guardar.
- Eliminar un campo es reversible: los valores se conservan y el campo se puede restaurar.
- Los campos de sistema también se pueden renombrar, ocultar y reordenar.

### Relaciones

Tabla genérica de vínculos (campo de relación, id de origen, id de destino, posición). Cada campo de tipo relación indica a qué entidad apunta y si admite uno o varios registros. Así una tarea puede estar vinculada a un cliente, a una campaña, a una creatividad, a varias cosas a la vez o a nada.

### Vistas

- Cada entidad admite varias vistas guardadas: tabla, lista, kanban, calendario y galería.
- Cada vista guarda filtros, orden, agrupación, columnas visibles, anchos y densidad.
- Cambiar entre vistas es un clic.

### Edición fácil

- Edición en línea en tablas y panel lateral de detalle para cada registro.
- Crear desde cualquier vista (fila nueva, tarjeta nueva en una columna del kanban, clic en un día del calendario).
- Duplicar registros.
- Borrar envía a una papelera; restaurable durante 30 días (configurable).
- Deshacer y rehacer (Ctrl+Z, Ctrl+Mayús+Z) para las acciones recientes.
- Paleta de comandos (Ctrl+K) y búsqueda global.
- Historial de cambios por registro.
- Exportar cualquier vista a CSV (separador «;», coma decimal y BOM, para abrirlo con Excel en español; protegido contra la inyección de fórmulas).
- Ctrl+Z deshace las acciones de la sesión (hasta 100). Mientras se escribe en un campo de texto, Ctrl+Z deshace el texto, como en cualquier programa.

---

## 7. Módulos

### 7.1 Desbloqueo, perfil e inicio

- Pantalla de contraseña. Desde la 0.13.4, con una animación ASCII a la derecha (gravedad como en yellowmellow.cc, el ojo o la cerradura; elegible en Ajustes, D-096).
- Perfil: nombre, foto, datos fiscales y de empresa, moneda y zona horaria por defecto.
- *Arreglos tras la 0.13:* Perfil es una sección propia antes de Inicio, con Datos y Cuentas conectadas (Meta, sincronización y Gmail) (D-087). X y LinkedIn se quitaron después (D-091).
- *Perfil tipo GitHub (0.14, D-095):* la primera vez, un asistente para configurarlo (o «Saltar por ahora»). Después se ve como la página de un usuario de GitHub:
  - a la izquierda: foto, nombre, cargo y empresa, bio, ubicación, email, web y los iconos de las redes (Instagram, TikTok, X, LinkedIn, Facebook, YouTube, Threads, Bluesky, GitHub, Behance, Dribbble, Pinterest, Twitch, Medium, Telegram, WhatsApp y Discord), con el usuario o el enlace;
  - a la derecha: cifras clave (clientes activos, inversión y ROAS del mes en Meta, facturado en el año), hasta 6 clientes destacados y el mapa de actividad del último año (cambios en registros por día).
  - Pestañas: Perfil, Editar y Cuentas conectadas.
- Inicio: visión general con gasto de hoy, 7 y 30 días, ROAS, alertas activas, tareas de hoy y atrasadas, estado de la última sincronización. En una fase posterior, widgets configurables.
- *Fase 12:* Inicio configurable con «Personalizar»:
  - quitar, ordenar y volver a añadir las tarjetas (cifras clave, clientes por etapa, notas, gasto y ROAS, tareas y alertas);
  - añadir widgets de Análisis (cifra, líneas, barras, tabla o ranking) de todas las cuentas;
  - «Restablecer Inicio» vuelve al diseño de serie.
- *Fase 2:* perfil en Ajustes (foto reducida a 256 px dentro de la base de datos cifrada; su zona horaria decide qué es «hoy»). Inicio con clientes activos, fees mensuales, clientes por etapa y notas recientes y fijadas; cada bloque futuro indica en qué fase llega.

### 7.2 Clientes

- Ficha completa: datos generales y campos personalizados, contactos, cuentas publicitarias asignadas, zona horaria y moneda propias, notas, archivos y documentos, tareas, briefs, creatividades, facturación, informes y correos de Gmail.
- Pipeline por defecto "Clientes" con etapas editables: Prospecto, Propuesta enviada, Negociación, Onboarding, Activo, En pausa, Finalizado. Se pueden crear pipelines adicionales con sus propias etapas.
- *Implementación (fase 2):* un pipeline es un campo de selección marcado como pipeline; sus opciones son las etapas y cada pipeline tiene su vista kanban. Los contactos se enlazan con un campo de relación cuyo otro lado («Contactos» del cliente) es un campo inverso: el vínculo se guarda una vez y se ve desde las dos fichas. Desde la ficha se puede crear un contacto nuevo y saltar a su ficha. Lo que llega en fases posteriores (cuentas publicitarias, archivos, tareas, briefs, creatividades, facturación, informes, correos) se irá añadiendo a la ficha.

### 7.3 Media buying en Meta

**Conexión.** Token de un usuario del sistema del Business Manager, con permisos solo de lectura (**verificar** los permisos exactos necesarios). Las cuentas publicitarias están compartidas en el BM del usuario. Tras conectar, el usuario elige qué cuentas sincronizar y asigna cada una a un cliente.

**Estructura sincronizada.** Campañas, ad sets, anuncios y creatividades de anuncio (con miniatura), con sus campos de configuración y estado.

**Métricas solicitadas.** Mapeo orientativo; **verificar** nombres exactos en la versión vigente de la API.

| Métrica | Origen | Notas |
|---|---|---|
| Nombre de campaña, ad set y anuncio | Estructura | |
| Entrega (delivery) | Estado efectivo de la entidad | Mostrar también el estado configurado. |
| Configuración de atribución | Ad set e Insights | |
| Estrategia de puja | Campaña o ad set | |
| Presupuesto | Campaña (si es CBO) o ad set | Diario o total. |
| Programación y fin | Fechas de inicio y fin del ad set o campaña | |
| Última edición significativa | Columna de Ads Manager sin equivalente directo conocido en la API | Investigar el historial de actividad de la cuenta; si no es posible, aproximar con la fecha de última actualización y explicarlo en la interfaz. |
| Impresiones, alcance, frecuencia | Insights | |
| Importe gastado | Insights | |
| CPM, CPC | Insights | |
| CTR de enlace y CTR único de enlace | Insights | |
| Resultados y valor de resultados | Insights | El "resultado" depende del objetivo de optimización; usar el campo de resultados si la versión de la API lo ofrece, o derivarlo del tipo de acción correspondiente. |
| ROAS de compra | Insights | |
| Añadidos al carrito, pagos iniciados | Acciones de Insights | |
| Clasificación de calidad, de tasa de interacción y de tasa de conversión | Insights a nivel de anuncio | Solo existen a nivel de anuncio y con un mínimo de impresiones. |
| AOV | Calculada | Valor de compras / compras. |
| Hook rate | Calculada | Reproducciones de 3 segundos / impresiones. |
| Hold rate | Calculada | Por defecto el estándar: reproducciones de 15 s (ThruPlays) / reproducciones de 3 s. Configurable, porque cada media buyer lo define a su manera (D-102). |

**Almacenamiento.**
- Métricas diarias por nivel (campaña, ad set, anuncio), entidad y fecha.
- Se guarda también la respuesta cruda de acciones y valores de acciones en JSON, y una tabla normalizada de tipos de acción, para que cualquier acción pueda usarse en métricas calculadas aunque hoy no se muestre.
- Desgloses opcionales (edad, género, país, plataforma y ubicación, dispositivo) activables por cuenta y nivel, en tabla aparte. La interfaz avisa de que multiplican el volumen de datos y el tiempo de sincronización.

**Sincronización.**
- Solo con la app abierta, cada hora por defecto (configurable).
- Al abrir la app, rellena todo el hueco desde la última sincronización (puede ser de más de una semana).
- En cada sincronización vuelve a descargar los últimos días de la ventana de atribución (7 días por defecto, configurable hasta 28), porque Meta sigue atribuyendo conversiones a días pasados.
- Importación histórica inicial con el máximo que permita Meta (la documentación ha indicado 37 meses; **verificar**), mediante informes asíncronos, por bloques, reanudable si se cierra la app, en segundo plano y con barra de progreso.
- Respeta los límites de uso leyendo las cabeceras de consumo que devuelve la API, con reintentos y espera exponencial.

**Interfaz.**
- Tabla tipo Ads Manager con navegación campaña, ad set, anuncio; selector de rango de fechas; comparación con el periodo anterior; totales; formato condicional.
- Columnas configurables con presets guardables (p. ej. "Ecom rendimiento", "Creatividades").
- Métricas calculadas propias con editor de fórmulas sobre cualquier métrica o acción (p. ej. beneficio = valor de compras − gasto − fee), con formato de moneda, porcentaje o número. Usables en tablas, dashboards, informes y alertas.

**Divisas y zonas horarias.**
- Los importes se guardan en la moneda de cada cuenta publicitaria y se convierten al mostrar.
- Monedas: EUR, USD, GBP, CHF, CAD, AUD, MXN, SEK, NOK, DKK, PLN, JPY y BRL como mínimo (lista editable). Selector global y por cliente.
- Tipos de cambio diarios del BCE guardados en local, de modo que una fecha antigua siempre usa su tipo histórico.
- Meta entrega los datos en la zona horaria de cada cuenta; la app muestra por defecto Europe/Madrid, configurable globalmente y por cliente.

**Implementación (fase 6).**
- Graph API **v26.0**, token de usuario del sistema con **`ads_read`** (verificado). Se pega en Campañas; se guarda solo en la base de datos cifrada. Clave secreta de la app opcional para `appsecret_proof` (D-054).
- Cuentas en Campañas → Cuentas: activar la sincronización y asignar un cliente. La ficha del cliente muestra sus cuentas.
- Estructura: campañas, conjuntos y anuncios con estado configurado y efectivo, objetivo u objetivo de optimización, estrategia de puja, presupuestos, fechas y atribución (en el JSON del conjunto); creatividades con título, texto, tipo, llamada a la acción, enlace, vídeo y miniatura descargada y cifrada.
- Métricas diarias en cuatro niveles (cuenta, campaña, conjunto, anuncio) con acciones crudas, acciones normalizadas y catálogo de tipos (D-055). «Última edición significativa» se aproxima con `updated_time` hasta investigar el historial de actividad (fase 7).
- Sincronización: al abrir (tras desbloquear) y cada hora por defecto (30 min, 1, 2 o 4 h), con la ventana de atribución configurable (1–28 días). Histórico asíncrono por meses hasta 37 meses o la creación de la cuenta, reanudable, con progreso en Campañas y en la barra de estado (D-057).
- Divisas: moneda de visualización y lista editable en Campañas → Ajustes; conversión diaria con el BCE (D-056). Fechas de las métricas en la zona de cada cuenta (D-058). La selección de moneda por cliente llega con la tabla de la fase 7.
- Interfaz de la fase 6: KPIs del periodo con comparación con el periodo anterior y tabla campaña → conjunto → anuncio con totales. Columnas configurables, presets, métricas calculadas, desgloses y formato condicional: fase 7.

**Implementación (fase 7).**
- Tabla tipo Ads Manager con navegación campaña → conjunto → anuncio, orden por columnas, totales, comparación por fila con el periodo anterior y desglose en subfilas.
- Presets de columnas (cuatro de serie y los propios) con formato condicional (D-060).
- Métricas propias con fórmula sobre cualquier métrica o acción, con formato moneda, porcentaje o número (D-059). Hold rate configurable.
- Alcance, frecuencia y únicos del periodo pedidos a Meta (D-061). Desgloses activables por cuenta y nivel (D-062).
- Última edición significativa con el historial de actividad (D-063). Moneda por cliente (D-065).
- Vínculo creatividad-anuncio manual y automático (código o convención de nombres), rendimiento por creatividad y ranking por etiqueta (D-064).
- Clic en un anuncio (tabla y anuncios vinculados de una creatividad): abre su vista previa pública de Meta en el navegador (D-103).

### 7.4 X y LinkedIn (retirado)

Se construyó en la fase 11 (LinkedIn por API y CSV, X por CSV) y se quitó después a petición del usuario: no los usa. La versión 0.13.3 borra el código, la sección y, con una migración precedida de copia de seguridad automática, las cuentas, métricas y ajustes que hubiera de estas plataformas (D-091). La app trabaja solo con Meta.

### 7.5 Leads de Meta (opcional, baja prioridad)

El negocio actual es ecommerce y no usa formularios de leads. Si en el futuro se usan, la app consultará los nuevos leads cada X minutos mientras esté abierta (sin URL pública ni webhooks) y los creará como tarjetas en un pipeline de leads.

### 7.6 Tareas

- Estados por defecto: Pendiente, En curso, En revisión, Hecha. Editables (nombre, color, orden).
- Campos: título, descripción con formato, fecha límite, prioridad, etiquetas, checklist o subtareas, adjuntos, estimación de tiempo, vínculos (ninguno, uno o varios).
- Vistas intercambiables: kanban, lista, tabla y calendario.
- Recurrentes: diaria, semanal en días concretos, mensual o regla personalizada. La siguiente se genera al completar la actual o según calendario (elegible por tarea).
- Avisos solo dentro de la app: secciones "Hoy" y "Atrasadas" e indicadores en la barra lateral.
- *Fase 3:* el estado es un pipeline (opciones con color y la marca «Fin» para las que cuentan como terminadas). Checklist y repetición son tipos de campo propios del motor. Los adjuntos llegan con los archivos (fase 4). Vistas iniciales: Tablero, Hoy, Atrasadas, Todas y Calendario. La barra lateral muestra cuántas tareas hay para hoy o atrasadas (en rojo si hay atrasadas) y el inicio las lista. Desde la ficha de un cliente o de un brief, «+ Tarea» crea una tarea ya enlazada.

### 7.7 Briefs

- La estructura definitiva de los briefs está pendiente. En la v1: brief libre con texto con formato, archivos y vínculos.
- Sistema de plantillas preparado para cuando el usuario defina la suya: secciones con tipo (texto, lista, archivos, enlaces a creatividades), editables desde la interfaz.
- Un brief se vincula a un cliente y desde él se pueden crear tareas y creatividades ya vinculadas. Estados editables.
- *Fase 3:* brief con título, contenido con formato, estado, cliente, fecha de entrega y tareas. «Desde plantilla» crea el contenido con un título por sección y su indicación; las plantillas (nombre y secciones con tipo: texto, lista, enlaces a creatividades, archivos) se editan en Ajustes. Archivos y enlaces a creatividades se completan en la fase 4.
- *Fase 12:*
  - Cada plantilla puede llevar fecha de entrega (a N días) y tareas que se crean enlazadas al brief, cada una con su fecha límite relativa.
  - Las secciones de enlaces y de archivos indican que se completan en los campos «Creatividades» y «Archivos» del brief.
  - Las plantillas se pueden duplicar, y un brief ya escrito se guarda como plantilla («Como plantilla» en su ficha): cada título del contenido es una sección (D-083).

### 7.8 Biblioteca de creatividades y copies

- Tipos: imagen, vídeo, carrusel, primary text, headline, descripción, hook, guion y otros archivos.
- Los archivos se guardan dentro de la bóveda (cifrados, deduplicados por hash) con miniatura y metadatos: resolución, proporción, duración, peso.
- Etiquetas por defecto, todas editables y ampliables: ángulo, hook, formato, proporción, nivel de consciencia, avatar, oferta, producto, cliente y estado (Borrador, Aprobada, Activa, Pausada, Quemada).
- Versiones: cada creatividad y cada copy guarda su historial (v1, v2...) con comparación de cambios y rendimiento por versión.
- Vínculo con anuncios: manual (buscar y elegir el anuncio) y automático opcional mediante una convención de nombres configurable, por ejemplo `{cliente}_{angulo}_{formato}_v{version}`. Explorar también la coincidencia automática por hash de imagen.
- Rendimiento: métricas agregadas de todos los anuncios vinculados a cada creatividad y ranking por etiqueta (qué ángulos, hooks o formatos rinden mejor).
- Archivo de referencias (swipe file) opcional: anuncios propios o de la competencia guardados como referencia, con captura o vídeo, enlace a la biblioteca de anuncios, notas y etiquetas. Se distingue del material propio con un filtro.
- Vista galería con previsualización grande y reproducción de vídeo.
- *Fase 4:* creatividades con tipo, archivos, copy o guion con formato, estado (Borrador, Aprobada, Activa, Pausada, Quemada), cliente, brief, enlace y las etiquetas de la lista (ángulo, hook, formato, proporción, nivel de consciencia, avatar, oferta y producto; todas editables). Vistas Biblioteca, Todas, Por estado y Swipe file. Versiones manuales («Guardar versión» con nota) con comparación de cambios respecto a la actual y restaurar. *Fase 7:* vínculo con anuncios (manual, por código o por convención de nombres), rendimiento por creatividad en su ficha y ranking por etiqueta en Campañas → Creatividades (D-064). Pendiente: rendimiento por versión y coincidencia por hash de imagen.

### 7.9 Facturación y cobros

- Acuerdo por cliente: fee fijo mensual, porcentaje del gasto, por proyecto o combinación.
- Registro de facturas emitidas con PDF adjunto, importe, moneda, fechas y estado (Pendiente, Cobrada, Vencida).
- Beneficio por cliente combinando cobros, gastos asociados y fees.
- **Nota legal:** en España el software que emite facturas debe cumplir requisitos específicos (normativa Verifactu). En la v1 el CRM registra facturas emitidas con una herramienta que cumpla la normativa; no las emite. **Verificar** antes de ampliar este módulo.
- *Implementación (fase 9):* entidades Facturas y Gastos, acuerdo por cliente (fee, porcentaje, proyecto) y sección Facturación con lo facturado, cobrado, pendiente, vencido, gastos, inversión en Meta, lo previsto por el acuerdo y el beneficio por cliente en el periodo, más la lista de facturas vencidas. Verifactu es obligatorio desde 2027 (D-071).
- *Registro de horas (0.14, D-099):* sección Horas con cronómetro en la barra inferior; Facturación muestra las horas de cada cliente y lo facturado por hora.

### 7.10 Informes para clientes

- Plantillas de informe editables: portada, KPIs, gráficas, tablas, comparativas y comentarios.
- Generación por cliente y periodo, en la moneda elegida, exportada a PDF y guardada en los archivos del cliente.
- *Implementación (fase 9):* sección Informes con plantillas de bloques editables (portada, cifras clave, evolución diaria, barras, tabla, comparativa, texto fijo y comentarios). El PDF A4 se genera en el proceso principal, sin red ni JavaScript. Se guarda en Documentos con el cliente, con vista previa y exportación (D-076). Los Documentos son una sección nueva para los archivos sueltos (D-072).

### 7.11 Herramientas de archivos

- Comprimir PDF con varios niveles de calidad.
- Comprimir, redimensionar y convertir imágenes a JPEG, PNG o WebP. Se leen JPEG, PNG, WebP, HEIC/HEIF (iPhone), GIF, AVIF, TIFF, BMP, ICO y SVG (D-093).
- Comprimir y convertir vídeo, con presets para formatos de Meta (9:16, 1:1, 4:5).
- Unir y dividir PDF.
- Funcionamiento por arrastrar y soltar; el resultado se guarda en la bóveda o se exporta a una carpeta.
- *Implementación (fase 9):* sección Herramientas con tres pestañas, y el resultado se guarda en Documentos (con cliente) o se exporta.
  - **Imágenes:** canvas de Chromium (D-074); TIFF con UTIF y HEIC con libheif en un hilo del proceso principal (D-093).
  - **PDF:** unir, dividir por rangos y comprimir en tres niveles, con pdf-lib y pdf.js (D-075).
  - **Vídeo:** FFmpeg con presets para Meta, recorte o bandas, calidad, sin sonido, avance y cancelar (D-073).

### 7.12 Gmail

- Conexión mediante el mismo proyecto de Google que Drive.
- Muestra en la ficha de cada cliente y contacto los hilos asociados a sus direcciones de email.
- Envío de correos desde el CRM como función opcional posterior.
- *Plantillas de correo (0.14, D-098):* en Ajustes, con variables. «Escribir correo…» en la ficha de un cliente o contacto las rellena y las abre en Gmail (navegador) o en el programa de correo, sin enviar nada desde la app.
- *Implementación (fase 10):* Ajustes → Gmail conecta en solo lectura (`gmail.readonly`) con el mismo proyecto de Google que Drive. La ficha de cada cliente (con las direcciones de sus contactos) y de cada contacto muestra sus hilos: asunto, participantes, fecha, extractos y enlace para abrirlos en Gmail. El correo no se guarda en la bóveda (D-078). El envío sigue pendiente.

### 7.13 Dashboards, comparativas y alertas

- Comparativas: periodo frente a periodo anterior, frente al mismo periodo del año anterior, cliente frente a cliente, campaña frente a campaña, creatividad frente a creatividad, etiqueta frente a etiqueta.
- Dashboards de widgets configurables (KPI, línea, barras, tabla, ranking), global y por cliente.
- Alertas configurables por cliente o cuenta: métrica, condición, umbral y ventana (p. ej. "CPA superior a 30 € en los últimos 3 días"). Solo avisan dentro de la app.

- *Implementación (fase 8):* sección Análisis con tres pestañas. **Dashboards** de widgets (cifra, líneas, barras, tabla y ranking), global y por cliente, editables. **Comparar** periodo frente al anterior o al mismo del año anterior, y cliente, cuenta, campaña, creatividad o etiqueta frente a otra, con tabla de diferencias y gráfica. **Alertas** por métrica, condición, umbral y ventana, con avisos en Análisis, la barra lateral e Inicio (D-066 a D-070).

### 7.14 Ajustes

Perfil · bóveda · seguridad (contraseña, autobloqueo, clave de recuperación) · sincronización y copias · conexiones (Meta, Google) · monedas y zonas horarias · formato regional · apariencia (selector de temas con los predefinidos claro y oscuro, temas propios creados y editados desde la app, densidad compacta o cómoda) · campos, etiquetas, estados y pipelines · presets de columnas · atajos de teclado.

---

## 8. Diseño visual

- **Idiomas (arreglos tras la 0.13, D-090):** español de España (por defecto) e inglés británico. El idioma se elige en la pantalla de contraseña (ES/EN) y en Ajustes → Apariencia; la ventana se recarga en el nuevo idioma. En inglés los números son 1,234.56, las fechas siguen dd/mm/aaaa y la semana empieza en lunes. Los textos que crea la app de serie (campos, vistas, etapas, plantillas) se ven traducidos; los que escribe el usuario no se tocan.

- Debe parecerse al portfolio del usuario: https://yellowmellow.cc
- **Primera tarea de diseño (fase 0):** abrir la web, extraer colores, tipografías, radios, espaciados, tono de los textos y elementos característicos, y documentarlos como tokens en `docs/DESIGN.md`. Si la web no se puede leer, pedir capturas al usuario. No construir pantallas antes de que el usuario apruebe esos tokens.
- Adaptación a una app con mucha densidad de datos: cifras con números tabulares, dos densidades (compacta por defecto y cómoda), tema oscuro por defecto y tema claro, contraste accesible.
- **Temas:** el diseño se define con tokens. Cada tema da un valor a cada token y la app tiene un selector de temas. En la fase 12 el usuario crea temas propios y los edita desde la propia app (Ajustes → Apariencia): parte de un tema, cambia cada token con vista previa en directo y la app avisa de las parejas de texto y fondo que no llegan a contraste AA (D-081). Los temas se exportan e importan como archivo JSON, se pueden pedir a cualquier IA y admiten esquinas redondeadas, fondo de imagen o vídeo (D-089) y color propio para los iconos (D-094). Si el color de marca es claro (p. ej. un amarillo), usarlo como fondo de acento o en superficies con texto oscuro, nunca como color de texto sobre blanco.
- Evitar el aspecto genérico de SaaS (todo en tarjetas iguales con sombra gris y degradados). La identidad del portfolio manda.
- Textos de interfaz en español, en minúscula inicial, con verbos claros en los botones ("Guardar cambios", no "Enviar"). Los estados vacíos indican qué hacer a continuación.

---
- **Iconos (D-094):** la barra lateral usa iconos SVG (Lucide). Cada sección trae uno de serie y se puede cambiar en Ajustes → Iconos de las secciones. Su color va en el tema (`icon`, `iconActive`).
- **Ancho y barras de desplazamiento (D-093):** las páginas ocupan todo el ancho de la ventana y las barras de desplazamiento llevan los colores del tema.
- **Tema de serie «Mellow» (D-097):** al estilo de los escritorios de Hyprland, con paneles flotantes separados por huecos, esquinas redondeadas, borde en degradado ámbar→naranja en el panel activo, barras en píldoras, títulos sin mayúsculas y animaciones suaves. Sin transparencia de serie. Cada tema define su estilo (disposición clásica o flotante, huecos, borde, transparencia «cristal» o de ventana, opacidad, desenfoque, animaciones y títulos) y todo se cambia en el editor de temas. Los temas anteriores siguen como «Clásico oscuro» y «Clásico claro».

## 9. Fases de construcción

Cada fase termina con algo que funciona, tests y build verificado en Windows y Linux.

| Fase | Contenido |
|---|---|
| 0. Cimientos | Repositorio, Electron + React + TypeScript, empaquetado Windows y Linux funcionando, IPC tipado, bóveda, contraseña y cifrado, migraciones, tokens de diseño aprobados, estructura de la interfaz (barra lateral, barra de estado, Ctrl+K). |
| 1. Motor de datos | Entidades, campos personalizados, relaciones, vistas (tabla, lista, kanban, calendario, galería), filtros y orden, papelera, deshacer, búsqueda global, historial de cambios, exportar CSV. |
| 2. Clientes e inicio | Perfil, clientes, contactos, pipelines editables, pantalla de inicio básica. |
| 3. Tareas y briefs | Tareas con estados, vistas, recurrencias y vínculos; briefs libres y sistema de plantillas. |
| 4. Archivos y creatividades | Almacenamiento por hash cifrado, miniaturas, biblioteca de creatividades y copies, etiquetas, versiones, swipe file. |
| 5. Google Drive | Sincronización entre equipos, resolución de conflictos, copias cada 3 días, restauración. |
| 6. Meta I | Conexión, cuentas asignadas a clientes, estructura, métricas diarias, importación histórica, sincronización horaria con ventana de atribución, divisas y zonas horarias. |
| 7. Meta II | Tabla tipo Ads Manager, presets de columnas, métricas calculadas, desgloses, vínculo creatividad-anuncio, rendimiento por etiqueta. |
| 8. Análisis | Dashboards, comparativas, alertas. |
| 9. Negocio | Facturación y cobros, informes PDF, herramientas de compresión de archivos. |
| 10. Gmail | Hilos por cliente y contacto. |
| 11. X y LinkedIn | Conectores por API si son gratuitos; si no, importación de CSV con mapeo guardado. Retirado en la 0.13.3 (D-091). |
| 12. Personalización avanzada | Colecciones personalizadas, plantillas de brief definitivas, widgets de inicio configurables, editor de temas (crear y modificar temas desde la app). |
| 13. Móvil | App de Android con el mismo motor e interfaz adaptada a pantalla táctil; la bóveda se trae y sincroniza con Google Drive (D-101). |

Hasta la fase 5, el traslado entre ordenadores se hace copiando la carpeta de la bóveda manualmente.

---

## 10. Cuestiones abiertas

- Estructura de los briefs: de momento se quedan las plantillas de serie (fase 12), editables desde la app.
- Convención de nombres de anuncios para el vínculo automático: opcional. Por defecto el vínculo se hace por el código de la creatividad dentro del nombre del anuncio; la convención se puede fijar en Ajustes si algún día se usa una.

Resueltas en la 0.15.1 (D-102): el hold rate por defecto es el estándar de 15 s y la lista de monedas actual es la definitiva.
