// El «worker» de pdf.js se carga como módulo en el hilo principal (tools/pdf.ts).
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
