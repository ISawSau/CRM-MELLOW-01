# CRM personal de media buying

App de escritorio personal (un solo usuario) para gestionar clientes, media buying en Meta (y más adelante X y LinkedIn), tareas, briefs, creatividades, facturación e informes. Local-first, 100 % gratuita, funciona igual en Windows y Linux, y guarda todos los datos en una única carpeta portable ("bóveda").

La especificación completa está en `docs/SPEC.md`. Léela antes de cualquier tarea y respétala. Si algo de lo que te pido la contradice, avísame antes de hacerlo.

## Forma de trabajar

- Construimos fase por fase, en el orden de `docs/SPEC.md` sección 9. No adelantes trabajo de fases futuras.
- Al empezar una fase: resume qué vas a hacer, qué archivos crearás y qué dependencias añadirás, y espera mi confirmación.
- Al terminar una fase: la app debe arrancar, la funcionalidad debe ser usable, los tests deben pasar y el empaquetado debe funcionar en Windows y Linux.
- Registra cada decisión técnica relevante (y su motivo) en `docs/DECISIONS.md`.
- Si cambia el alcance o el diseño, actualiza `docs/SPEC.md` en el mismo cambio.
- Commits pequeños y descriptivos, en español.

## Reglas fijas

- Cero costes: nada de servicios de pago, servidores propios ni dependencias con licencia comercial obligatoria.
- Toda la interfaz en español de España: fechas dd/mm/aaaa, números 1.234,56, semana empieza en lunes, zona horaria por defecto Europe/Madrid.
- Los datos solo viven en la bóveda. Nunca escribas datos de usuario fuera de ella (salvo la configuración mínima que indica qué bóveda abrir).
- La base de datos va siempre cifrada. Tokens y credenciales solo dentro de la base de datos cifrada, nunca en archivos de texto ni en variables de entorno.
- Conexión con Meta en solo lectura. No implementes ninguna acción que modifique campañas.
- Antes de usar cualquier API externa (Meta Graph/Marketing API, Google Drive, Gmail, X, LinkedIn), comprueba en la documentación oficial actual la versión vigente, los nombres exactos de campos, permisos y límites. No te fíes de nombres de memoria.
- Las migraciones de base de datos nunca destruyen datos sin crear antes una copia de seguridad automática.
- Seguridad de Electron: contextIsolation activado, sandbox, sin nodeIntegration en el renderer, CSP estricta, enlaces externos en el navegador del sistema.
- Fórmulas de usuario evaluadas con un parser seguro, nunca con eval.

## Entorno de trabajo (Claude Code en la nube)

- Trabajas en una máquina Linux en la nube, sin pantalla. No puedes ver la ventana de la app, así que verifica con tests (Vitest y, si el entorno lo permite, Playwright con Electron en modo sin pantalla). En cada entrega dime los comandos exactos para probarla en mi ordenador con Windows y con Linux, y qué debería ver.
- En la fase 0 crea un workflow de GitHub Actions que ejecute los tests y genere los instaladores en Windows y Linux reales en cada push a main. Los instaladores se descargan desde la pestaña Actions.
- El repositorio nunca contiene datos reales: añade a `.gitignore` cualquier bóveda, base de datos, archivo `.env`, credenciales y carpetas de build. Ningún token ni credencial en el repositorio ni en las variables del entorno de la nube.
- Si una tarea necesita un dominio bloqueado por la red del entorno, dime cuál para que lo añada en lugar de buscar rodeos.
- Al terminar una fase, resumen de cambios y pull request hacia main.

## Comandos

(Rellenar en la fase 0: instalar, desarrollo, tests, build Windows, build Linux.)
