// El «worker» de pdf.js se carga como módulo en el hilo principal (tools/pdf.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
