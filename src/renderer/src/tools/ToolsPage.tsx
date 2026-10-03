import { useState } from 'react'
import { t } from '@shared/i18n'
import { ImageTool } from './ImageTool'
import { PdfTool } from './PdfTool'
import { VideoTool } from './VideoTool'

type Tab = 'imagenes' | 'pdf' | 'video'

/** Herramientas de archivos (SPEC §7.11, fase 9). */
export function ToolsPage({ num }: { num: string }) {
  const [tab, setTab] = useState<Tab>('imagenes')
  return (
    <div className="page" data-testid="page-herramientas">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> {t('negocio')}
        </span>
        <h1 className="title">{t('Herramientas')}</h1>
        <p className="muted">
          {t(
            'Comprime y convierte imágenes, PDF y vídeos sin salir de la app. Todo se procesa en tu ordenador: el resultado se guarda cifrado en Documentos o se exporta a la carpeta que elijas.',
          )}
        </p>
      </div>
      <div className="tabs" role="tablist" aria-label={t('Herramientas')}>
        {(
          [
            ['imagenes', 'Imágenes'],
            ['pdf', 'PDF'],
            ['video', 'Vídeo'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`tools-tab-${id}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'imagenes' && <ImageTool />}
      {tab === 'pdf' && <PdfTool />}
      {tab === 'video' && <VideoTool />}
    </div>
  )
}
