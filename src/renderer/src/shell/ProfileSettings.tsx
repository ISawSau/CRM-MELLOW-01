import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { CURRENCIES, DEFAULT_PROFILE, type Profile } from '@shared/profile'
import { useProfile } from '../data/nav'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'

const PHOTO_SIZE = 256

/** Reduce la foto a 256×256 (recorte centrado) y la devuelve como JPEG en data URL. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_SIZE
    canvas.height = PHOTO_SIZE
    canvas
      .getContext('2d')!
      .drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        PHOTO_SIZE,
        PHOTO_SIZE,
      )
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function zones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return ['Europe/Madrid', 'Atlantic/Canary', 'UTC']
  }
}

const TEXT_FIELDS: { key: keyof Profile; label: string; type?: string; wide?: boolean }[] = [
  { key: 'name', label: 'Tu nombre' },
  { key: 'company', label: 'Empresa o nombre comercial' },
  { key: 'nif', label: 'NIF / CIF' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Teléfono', type: 'tel' },
  { key: 'website', label: 'Web', type: 'url' },
  { key: 'address', label: 'Dirección fiscal', wide: true },
  { key: 'iban', label: 'IBAN (para tus facturas)', wide: true },
]

function ProfileForm({ initial }: { initial: Profile }) {
  const [draft, setDraft] = useState<Profile>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await call('profile:set', draft)
      qc.setQueryData(['data', 'profile'], saved)
      toast.show('Perfil guardado.')
    } catch (err) {
      setError(err instanceof IpcCallError ? err.message : 'No se pudo guardar el perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)} data-testid="profile-form">
      <div className="profile-photo">
        {draft.photo ? (
          <img src={draft.photo} alt="Tu foto" className="avatar avatar-large" />
        ) : (
          <span className="avatar avatar-large avatar-empty" aria-hidden="true">
            {(draft.name || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="form-actions">
          <label className="btn">
            Elegir foto
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f)
                  void shrinkPhoto(f)
                    .then((photo) => set({ photo }))
                    .catch(() => setError('No se pudo leer la imagen.'))
                e.target.value = ''
              }}
            />
          </label>
          {draft.photo && (
            <button type="button" className="btn-link" onClick={() => set({ photo: null })}>
              Quitar
            </button>
          )}
        </div>
      </div>
      <div className="field-grid">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? 'field field-wide' : 'field'}>
            <label htmlFor={`profile-${f.key}`}>{f.label}</label>
            <input
              id={`profile-${f.key}`}
              className="input"
              type={f.type ?? 'text'}
              value={String(draft[f.key] ?? '')}
              onChange={(e) => set({ [f.key]: e.target.value } as Partial<Profile>)}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="profile-currency">Moneda por defecto</label>
          <select
            id="profile-currency"
            className="input"
            value={draft.currency}
            onChange={(e) => set({ currency: e.target.value })}
          >
            {[...new Set([...CURRENCIES, draft.currency])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="profile-tz">Zona horaria</label>
          <select
            id="profile-tz"
            className="input"
            value={draft.timeZone}
            onChange={(e) => set({ timeZone: e.target.value })}
          >
            {zones().map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          Guardar perfil
        </button>
      </div>
    </form>
  )
}

/** Ajustes → Perfil (SPEC §7.1). Los datos fiscales se usarán en las facturas (fase 9). */
export function ProfileSettings() {
  const profile = useProfile()
  return (
    <section className="settings-block" data-testid="profile-settings">
      <div>
        <h2>Perfil</h2>
        <p className="desc">
          Tus datos y los de tu empresa. La zona horaria decide qué es «hoy» en filtros y
          calendarios; los datos fiscales se usarán en las facturas.
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        {profile.data ? (
          <ProfileForm key={JSON.stringify(profile.data)} initial={profile.data} />
        ) : (
          <ProfileForm initial={DEFAULT_PROFILE} />
        )}
      </div>
    </section>
  )
}
