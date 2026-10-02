# Especificación del CRM personal

Versión 0.2 · 2 de octubre de 2026

Este documento recoge todas las decisiones de diseño tomadas antes de escribir código. Es la referencia para construir el proyecto fase a fase. Lo que aparece marcado como **verificar** depende de APIs o normativa externa que cambian con el tiempo y debe comprobarse en la documentación oficial antes de implementarlo.

---

## 1. Visión y principios

Una app de escritorio personal para llevar todo el trabajo de media buying en un solo sitio: clientes, cuentas publicitarias, métricas de Meta (y más adelante X y LinkedIn), tareas, briefs, biblioteca de creatividades y copies, facturación, informes y archivos.

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
- Detección de leads duplicados y valor económico de oportunidades (no aplica de momento).
- Notificaciones fuera de la app: los avisos se ven al abrirla.
- App móvil, hasta que la versión de escritorio esté completa (fase 13).

---

## 2. Decisiones técnicas

| Capa | Elección | Motivo |
|---|---|---|
| Contenedor de escritorio | Electron + electron-builder | Usa el mismo Chromium en Windows y Linux, así que la app se ve y se comporta igual en ambos. Todo el proyecto en un solo lenguaje. |
| Instaladores | NSIS (Windows); paquete pacman y AppImage (Linux, el sistema del usuario es Arch) | Formatos estándar, gratuitos. El paquete pacman se instala con `sudo pacman -U`; el AppImage funciona sin instalar. |
| Interfaz | React + TypeScript + Vite (electron-vite) | Ecosistema enorme y bien documentado. |
| Tablas | TanStack Table + virtualización | Tablas tipo Ads Manager con miles de filas y columnas configurables. |
| Estado de datos en la UI | TanStack Query sobre IPC | Caché y recarga sencillas. |
| Kanban | dnd-kit | Arrastrar y soltar accesible. |
| Calendario | FullCalendar (núcleo MIT) o componente propio | Vista calendario de tareas y entregas. |
| Gráficas | Apache ECharts | Rinde bien con muchos datos y permite comparativas. |
| Base de datos | SQLite con cifrado compatible con SQLCipher (better-sqlite3-multiple-ciphers, instalado con el alias `better-sqlite3`) | Un archivo, rápido, sin servidor, cifrado completo. |
| ORM y migraciones | Drizzle ORM | Tipado, ligero, migraciones versionadas. |
| Búsqueda global | SQLite FTS5 | Búsqueda instantánea en todo el CRM sin dependencias externas. |
| Derivación de clave | Argon2id (hash-wasm; el Node de Electron no lo incluye) | Estándar actual para derivar claves a partir de contraseñas. |
| Cifrado de archivos | AES-256-GCM por bloques (crypto de Node) | Cifra creatividades y documentos de la bóveda sin cargar archivos enteros en memoria. |
| Fechas y zonas | date-fns + date-fns-tz, locale es | Formato español y zonas horarias por cliente. |
| Recurrencias | rrule | Tareas recurrentes con reglas estándar. |
| Fórmulas | Parser de expresiones seguro (p. ej. expr-eval) | Métricas calculadas sin riesgo de ejecutar código. |
| Imágenes | sharp | Miniaturas y compresión. |
| Vídeo | ffmpeg y ffprobe empaquetados | Miniaturas, metadatos y compresión de vídeo. |
| PDF | pdf-lib (unir, dividir), Ghostscript empaquetado (comprimir), printToPDF de Electron (informes) | Cubre generación y compresión de PDF gratis. |
| Tipos de cambio | Tasas de referencia del BCE vía un servicio gratuito sin clave (p. ej. Frankfurter). **Verificar** disponibilidad. | Conversión de divisas sin coste. |
| Tests | Vitest (lógica) + Playwright para Electron (interfaz) | |
| CI de builds | GitHub Actions (gratis en repos públicos o con minutos gratuitos en privados; **verificar** límites) | Compilar en Windows y Linux reales, necesario por los módulos nativos (SQLite, sharp). |

Arquitectura de procesos: el proceso principal de Electron es el único que toca la base de datos, los archivos y las APIs externas. El renderer (la interfaz) se comunica con él mediante IPC tipado. Las sincronizaciones largas (histórico de Meta, subida a Drive) corren en un utility process o worker para no congelar la interfaz.

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
  .lock             equipo y hora de apertura, con latido mientras está desbloqueada
```

Comportamiento:

- En el primer arranque la app pregunta si crear una bóveda nueva o abrir una existente. Ajustes permite abrir otra o mover la actual.
- Al desbloquear, la app crea `.lock` con el nombre del equipo y la hora, y actualiza un latido cada 30 s. Si ya existe un lock reciente de otro equipo (latido de menos de 2 minutos), avisa de que la bóveda puede estar abierta en otro sitio y permite forzar la apertura. Un lock sin latido se considera abandonado.
- Al cerrar, la app hace un checkpoint del WAL para que `crm.db` quede como un único archivo consistente, sin archivos `-wal` ni `-shm` sueltos, y borra el lock.
- Los archivos se guardan por hash: si subes la misma imagen dos veces, ocupa una sola vez.
- `vault.json` guarda la versión de esquema. Una versión antigua de la app se niega a abrir una bóveda con esquema más nuevo, para evitar corrupción.
- Pasar la carpeta a un USB o disco externo funciona siempre como método manual, aunque no haya sincronización con Drive.

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

### Riesgos a verificar

- Las apps de Google en modo "pruebas" pueden tener tokens de actualización que caducan a los pocos días, lo que obligaría a reconectar Drive y Gmail cada semana. **Verificar** la política actual y cómo dejar la app personal en producción sin coste.
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

Más adelante (fase 12), colecciones personalizadas: el usuario crea sus propias tablas con los campos que quiera.

### Campos personalizados

- Tabla de definiciones: entidad, clave, etiqueta, tipo, configuración, orden, visible, obligatorio.
- Tipos: texto, texto largo con formato, número, moneda, porcentaje, fecha, fecha y hora, casilla, selección, selección múltiple (opciones con color, editables), URL, email, teléfono, archivos, relación con otra entidad, valoración, fórmula y resumen (agregado sobre una relación, p. ej. "gasto total de las campañas de este cliente").
- Los valores se guardan en una columna JSON por registro. Si un campo se usa mucho para filtrar u ordenar, se le crea un índice sobre la expresión JSON.
- Los campos de sistema también se pueden renombrar, ocultar y reordenar.

### Relaciones

Tabla genérica de vínculos (tipo y id de origen, tipo y id de destino, tipo de relación). Así una tarea puede estar vinculada a un cliente, a una campaña, a una creatividad, a varias cosas a la vez o a nada.

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
- Exportar cualquier vista a CSV. Importar CSV con mapeo de columnas (necesario más adelante para X y LinkedIn).

---

## 7. Módulos

### 7.1 Desbloqueo, perfil e inicio

- Pantalla de contraseña.
- Perfil: nombre, foto, datos fiscales y de empresa, moneda y zona horaria por defecto.
- Inicio: visión general con gasto de hoy, 7 y 30 días, ROAS, alertas activas, tareas de hoy y atrasadas, estado de la última sincronización. En una fase posterior, widgets configurables.

### 7.2 Clientes

- Ficha completa: datos generales y campos personalizados, contactos, cuentas publicitarias asignadas, zona horaria y moneda propias, notas, archivos y documentos, tareas, briefs, creatividades, facturación, informes y correos de Gmail.
- Pipeline por defecto "Clientes" con etapas editables: Prospecto, Propuesta enviada, Negociación, Onboarding, Activo, En pausa, Finalizado. Se pueden crear pipelines adicionales con sus propias etapas.

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
| Hold rate | Calculada | La definición varía según el media buyer; dejarla configurable (p. ej. ThruPlays / impresiones o reproducciones de 15 s / reproducciones de 3 s). |

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

### 7.4 X y LinkedIn

- Los conectores de plataformas comparten una interfaz común (listar cuentas, estructura, métricas diarias), de forma que añadir una plataforma nueva no cambia el resto de la app. Las métricas se normalizan (gasto, impresiones, clics, conversiones, valor) y además se guardan las específicas de cada plataforma.
- **Aviso sobre "gratis":** el acceso de lectura a la API de X ha sido de pago en los últimos años, y la API de publicidad de LinkedIn es gratuita pero requiere solicitar y obtener aprobación. **Verificar** el estado actual antes de implementar.
- Alternativa gratuita garantizada: importar los CSV que exportan X Ads y LinkedIn Campaign Manager, con un mapeo de columnas que se guarda para reutilizarlo cada semana.

### 7.5 Leads de Meta (opcional, baja prioridad)

El negocio actual es ecommerce y no usa formularios de leads. Si en el futuro se usan, la app consultará los nuevos leads cada X minutos mientras esté abierta (sin URL pública ni webhooks) y los creará como tarjetas en un pipeline de leads.

### 7.6 Tareas

- Estados por defecto: Pendiente, En curso, En revisión, Hecha. Editables (nombre, color, orden).
- Campos: título, descripción con formato, fecha límite, prioridad, etiquetas, checklist o subtareas, adjuntos, estimación de tiempo, vínculos (ninguno, uno o varios).
- Vistas intercambiables: kanban, lista, tabla y calendario.
- Recurrentes: diaria, semanal en días concretos, mensual o regla personalizada. La siguiente se genera al completar la actual o según calendario (elegible por tarea).
- Avisos solo dentro de la app: secciones "Hoy" y "Atrasadas" e indicadores en la barra lateral.

### 7.7 Briefs

- La estructura definitiva de los briefs está pendiente. En la v1: brief libre con texto con formato, archivos y vínculos.
- Sistema de plantillas preparado para cuando el usuario defina la suya: secciones con tipo (texto, lista, archivos, enlaces a creatividades), editables desde la interfaz.
- Un brief se vincula a un cliente y desde él se pueden crear tareas y creatividades ya vinculadas. Estados editables.

### 7.8 Biblioteca de creatividades y copies

- Tipos: imagen, vídeo, carrusel, primary text, headline, descripción, hook, guion y otros archivos.
- Los archivos se guardan dentro de la bóveda (cifrados, deduplicados por hash) con miniatura y metadatos: resolución, proporción, duración, peso.
- Etiquetas por defecto, todas editables y ampliables: ángulo, hook, formato, proporción, nivel de consciencia, avatar, oferta, producto, cliente y estado (Borrador, Aprobada, Activa, Pausada, Quemada).
- Versiones: cada creatividad y cada copy guarda su historial (v1, v2...) con comparación de cambios y rendimiento por versión.
- Vínculo con anuncios: manual (buscar y elegir el anuncio) y automático opcional mediante una convención de nombres configurable, por ejemplo `{cliente}_{angulo}_{formato}_v{version}`. Explorar también la coincidencia automática por hash de imagen.
- Rendimiento: métricas agregadas de todos los anuncios vinculados a cada creatividad y ranking por etiqueta (qué ángulos, hooks o formatos rinden mejor).
- Archivo de referencias (swipe file) opcional: anuncios propios o de la competencia guardados como referencia, con captura o vídeo, enlace a la biblioteca de anuncios, notas y etiquetas. Se distingue del material propio con un filtro.
- Vista galería con previsualización grande y reproducción de vídeo.

### 7.9 Facturación y cobros

- Acuerdo por cliente: fee fijo mensual, porcentaje del gasto, por proyecto o combinación.
- Registro de facturas emitidas con PDF adjunto, importe, moneda, fechas y estado (Pendiente, Cobrada, Vencida).
- Beneficio por cliente combinando cobros, gastos asociados y fees.
- **Nota legal:** en España el software que emite facturas debe cumplir requisitos específicos (normativa Verifactu). En la v1 el CRM registra facturas emitidas con una herramienta que cumpla la normativa; no las emite. **Verificar** antes de ampliar este módulo.

### 7.10 Informes para clientes

- Plantillas de informe editables: portada, KPIs, gráficas, tablas, comparativas y comentarios.
- Generación por cliente y periodo, en la moneda elegida, exportada a PDF y guardada en los archivos del cliente.

### 7.11 Herramientas de archivos

- Comprimir PDF con varios niveles de calidad.
- Comprimir, redimensionar y convertir imágenes (JPEG, PNG, WebP).
- Comprimir y convertir vídeo, con presets para formatos de Meta (9:16, 1:1, 4:5).
- Unir y dividir PDF.
- Funcionamiento por arrastrar y soltar; el resultado se guarda en la bóveda o se exporta a una carpeta.

### 7.12 Gmail

- Conexión mediante el mismo proyecto de Google que Drive.
- Muestra en la ficha de cada cliente y contacto los hilos asociados a sus direcciones de email.
- Envío de correos desde el CRM como función opcional posterior.

### 7.13 Dashboards, comparativas y alertas

- Comparativas: periodo frente a periodo anterior, frente al mismo periodo del año anterior, cliente frente a cliente, campaña frente a campaña, creatividad frente a creatividad, etiqueta frente a etiqueta.
- Dashboards de widgets configurables (KPI, línea, barras, tabla, ranking), global y por cliente.
- Alertas configurables por cliente o cuenta: métrica, condición, umbral y ventana (p. ej. "CPA superior a 30 € en los últimos 3 días"). Solo avisan dentro de la app.

### 7.14 Ajustes

Perfil · bóveda · seguridad (contraseña, autobloqueo, clave de recuperación) · sincronización y copias · conexiones (Meta, Google, X, LinkedIn) · monedas y zonas horarias · formato regional · apariencia (selector de temas con los predefinidos claro y oscuro, temas propios creados y editados desde la app, densidad compacta o cómoda) · campos, etiquetas, estados y pipelines · presets de columnas · atajos de teclado.

---

## 8. Diseño visual

- Debe parecerse al portfolio del usuario: https://yellowmellow.cc
- **Primera tarea de diseño (fase 0):** abrir la web, extraer colores, tipografías, radios, espaciados, tono de los textos y elementos característicos, y documentarlos como tokens en `docs/DESIGN.md`. Si la web no se puede leer, pedir capturas al usuario. No construir pantallas antes de que el usuario apruebe esos tokens.
- Adaptación a una app con mucha densidad de datos: cifras con números tabulares, dos densidades (compacta por defecto y cómoda), tema oscuro por defecto y tema claro, contraste accesible.
- **Temas:** el diseño se define con tokens. Cada tema da un valor a cada token y la app tiene un selector de temas. Más adelante (fase 12) el usuario podrá crear temas propios y editarlos desde la propia app. Si el color de marca es claro (p. ej. un amarillo), usarlo como fondo de acento o en superficies con texto oscuro, nunca como color de texto sobre blanco.
- Evitar el aspecto genérico de SaaS (todo en tarjetas iguales con sombra gris y degradados). La identidad del portfolio manda.
- Textos de interfaz en español, en minúscula inicial, con verbos claros en los botones ("Guardar cambios", no "Enviar"). Los estados vacíos indican qué hacer a continuación.

---

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
| 11. X y LinkedIn | Conectores por API si son gratuitos; si no, importación de CSV con mapeo guardado. |
| 12. Personalización avanzada | Colecciones personalizadas, plantillas de brief definitivas, widgets de inicio configurables, editor de temas (crear y modificar temas desde la app). |
| 13. Móvil | Se decide el enfoque cuando el escritorio esté completo. |

Hasta la fase 5, el traslado entre ordenadores se hace copiando la carpeta de la bóveda manualmente.

---

## 10. Cuestiones abiertas

- Estructura de los briefs (cuando el usuario la defina).
- Definición exacta de hold rate.
- Convención de nombres de anuncios para el vínculo automático.
- Lista final de monedas.
- Enfoque de la versión móvil.
- Viabilidad gratuita de las APIs de X y LinkedIn.
