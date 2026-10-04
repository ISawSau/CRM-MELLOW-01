/** ¿La interfaz corre en la app de Android (D-101)? Lo decide el puente instalado al arrancar. */
export const isMobile = (): boolean => window.api.platform === 'android'
