import { useEffect, useState } from 'react'
import { renderPages } from '../tools/pdf'

/** Vista previa de un PDF: cada página pintada con pdf.js como imagen. */
export function PdfPreview({ data, maxPages = 12 }: { data: Uint8Array; maxPages?: number }) {
  const [pages, setPages] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const urls: string[] = []
    void renderPages(
      data,
      1.25,
      async (canvas) => {
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        const url = URL.createObjectURL(blob)
        urls.push(url)
        if (alive) setPages([...urls])
      },
      maxPages,
    )
      .then((n) => alive && setTotal(n))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [data, maxPages])

  if (failed) return <p className="danger-text">No se ha podido mostrar la vista previa.</p>
  return (
    <div className="pdf-preview" data-testid="pdf-preview">
      {pages.map((src, i) => (
        <img key={src} src={src} alt={`Página ${i + 1}`} />
      ))}
      {total > maxPages && (
        <p className="faint">
          Y {total - maxPages} páginas más: abre el documento para verlas todas.
        </p>
      )}
    </div>
  )
}
