import type { ThemeBackground as Bg } from '@shared/themes'
import { fileUrl } from '../data/files'

/**
 * Fondo del tema (imagen o vídeo de la bóveda) detrás de toda la app, con un velo del color
 * de fondo para que el texto se siga leyendo. El vídeo va sin sonido y en bucle.
 */
export function ThemeBackground({ bg }: { bg: Bg }) {
  const src = fileUrl(bg.fileId)
  const style = {
    objectFit: bg.fit,
    filter: bg.blur ? `blur(${bg.blur}px)` : undefined,
  } as const
  return (
    <div className="theme-bg" aria-hidden="true" data-testid="theme-background">
      {bg.kind === 'video' ? (
        <video className="theme-bg-media" src={src} style={style} autoPlay muted loop playsInline />
      ) : (
        <img className="theme-bg-media" src={src} style={style} alt="" draggable={false} />
      )}
      <div className="theme-bg-veil" style={{ opacity: bg.dim }} />
    </div>
  )
}
