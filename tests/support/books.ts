import { deflateRawSync, deflateSync } from 'node:zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * Libros de prueba hechos en el propio test (D-123): un EPUB con portada, índice, dos
 * capítulos y contenido hostil (scripts, manejadores, enlace externo), y un PDF de tres
 * páginas con título y autor. Nada de libros reales en el repositorio.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** ZIP mínimo (el primer archivo sin comprimir: así lo pide EPUB para `mimetype`). */
export function zip(files: [name: string, content: string | Buffer, store?: boolean][]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content, store] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const n = Buffer.from(name)
    const body = store ? data : deflateRawSync(data)
    const method = store ? 0 : 8
    const crc = crc32(data)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(20, 4)
    h.writeUInt16LE(method, 8)
    h.writeUInt32LE(crc, 14)
    h.writeUInt32LE(body.length, 18)
    h.writeUInt32LE(data.length, 22)
    h.writeUInt16LE(n.length, 26)
    parts.push(h, n, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(method, 10)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += 30 + n.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

/** PNG de un color (la portada). */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'

function chapter(i: number): string {
  const ps = Array.from(
    { length: 40 },
    (_, k) =>
      `<p onclick="parent.parent.__pwned = 'click'">Párrafo ${k + 1} del capítulo ${i}. ${LOREM}</p>`,
  ).join('')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo ${i}</title>
<style>h1 { color: blue }</style>
<script>try { parent.parent.postMessage({ type: 'pwned' }, '*') } catch (e) {}</script>
</head><body><h1>Capítulo ${i}</h1>
<p><a href="https://example.com/autora">Web de la autora</a></p>
${ps}
<img src="x" onerror="parent.parent.postMessage({ type: 'pwned' }, '*')"/>
</body></html>`
}

export function makeEpub(title = 'Libro de prueba', author = 'Autora Inventada'): Buffer {
  return zip([
    ['mimetype', 'application/epub+zip', true],
    [
      'META-INF/container.xml',
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ],
    [
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:5d8f0f0e-crm</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    ],
    [
      'OEBPS/nav.xhtml',
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Capítulo 1</a></li><li><a href="c2.xhtml">Capítulo 2</a></li></ol></nav></body></html>`,
    ],
    ['OEBPS/cover.png', png(60, 90, [200, 80, 40])],
    ['OEBPS/c1.xhtml', chapter(1)],
    ['OEBPS/c2.xhtml', chapter(2)],
  ])
}

export async function makePdf(title = 'Manual en PDF', author = 'Autor del PDF'): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  doc.setAuthor(author)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([420, 595])
    page.drawText(`Pagina ${i}`, { x: 40, y: 540, size: 32, font })
    for (let l = 0; l < 20; l++)
      page.drawText(`Linea ${l + 1} de la pagina ${i}`, { x: 40, y: 480 - l * 20, size: 12, font })
  }
  return Buffer.from(await doc.save())
}
