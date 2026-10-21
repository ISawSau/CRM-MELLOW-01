/**
 * El lector de ebooks (D-123) vive en un marco aparte, con su propio origen: en
 * escritorio `crm-reader://reader`, en Android otro puerto del servidor local. Así su
 * CSP puede dejar los estilos inline que necesitan foliate-js y los propios libros sin
 * relajar la de la app, y un libro malicioso no llega a la app (otro origen: ni
 * `window.api` ni el DOM de la interfaz). Los scripts de los libros siguen bloqueados:
 * los marcos `blob:` de cada capítulo heredan esta política.
 *
 * El marco solo recibe los bytes del libro por `postMessage` y contesta por el mismo
 * camino; no puede pedir nada al motor ni salir a la red.
 */

/** Páginas que sirve el origen del lector (y sus scripts y estilos). */
export function isReaderPath(path: string): boolean {
  return path === '/reader.html' || /^\/assets\/[A-Za-z0-9._-]+\.(js|css)$/.test(path)
}

export function readerContentSecurityPolicy(parentOrigin: string, dev = false): string {
  return [
    "default-src 'none'",
    // En desarrollo Vite añade su cliente y el preámbulo inline de React Refresh.
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline' blob:",
    "img-src 'self' blob: data:",
    "font-src 'self' blob: data:",
    "media-src 'self' blob:",
    // fb2 y los cómics leen sus imágenes de blob:; en desarrollo, la recarga de Vite.
    `connect-src blob:${dev ? ' ws: http:' : ''}`,
    // Cada capítulo es un marco blob: (hereda esta política: sin scripts del libro).
    'frame-src blob:',
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // Solo la app puede meter el lector en un marco.
    `frame-ancestors ${parentOrigin}`,
  ].join('; ')
}
