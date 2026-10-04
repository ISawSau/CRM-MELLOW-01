import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { rangeFor } from '@shared/analysis'
import { shiftDate } from '@shared/data/dates'
import type { RecordRow } from '@shared/data/records'
import { formatCurrency, formatNumber } from '@shared/format'
import { t, tn } from '@shared/i18n'
import {
  MAX_PINNED_CLIENTS,
  SOCIAL_NETWORKS,
  socialUrl,
  type Profile,
  type SocialNetwork,
} from '@shared/profile'
import { useAnalysis, useMetricKit, useToday } from '../analysis/kit'
import { OptionChip } from '../data/FieldValue'
import { useNav } from '../data/nav'
import { call, IpcCallError } from '../lib/ipc'
import { formatMetric } from '../meta/metrics'
import { isoToEs, useHasAdData, useMetaStatus } from '../meta/meta'
import { Alert } from '../ui/Alert'
import { SectionIcon } from '../ui/section-icons'
import { SocialIcon } from '../ui/social-icons'
import { Kpi, useClientStats } from './Home'

/** Cabecera a la izquierda, como en GitHub: foto, nombre, cargo, bio, datos y redes. */
function ProfileCard({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const socials = SOCIAL_NETWORKS.flatMap((n) => {
    const url = socialUrl(n.id, profile.socials[n.id as SocialNetwork] ?? '')
    return url ? [{ ...n, href: url }] : []
  })
  return (
    <aside className="profile-card" data-testid="profile-card">
      {profile.photo ? (
        <img className="profile-avatar" src={profile.photo} alt="" />
      ) : (
        <span className="profile-avatar profile-avatar-empty" aria-hidden="true">
          {(profile.name || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="profile-names">
        <h1 className="title">{profile.name || t('Perfil')}</h1>
        {(profile.role || profile.company) && (
          <p className="profile-role">
            {[profile.role, profile.company].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {profile.bio && <p className="profile-bio">{profile.bio}</p>}
      <button type="button" className="btn profile-edit" onClick={onEdit}>
        {t('Editar perfil')}
      </button>
      <ul className="profile-facts">
        {profile.location && (
          <li>
            <SectionIcon name="map-pin" />
            {profile.location}
          </li>
        )}
        {profile.email && (
          <li>
            <SectionIcon name="mail" />
            <a href={`mailto:${profile.email}`}>{profile.email}</a>
          </li>
        )}
        {profile.website && (
          <li>
            <SectionIcon name="link" />
            <a href={profile.website} target="_blank" rel="noreferrer">
              {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          </li>
        )}
      </ul>
      {socials.length > 0 && (
        <ul className="profile-socials" aria-label={t('Redes sociales')}>
          {socials.map((s) => (
            <li key={s.id}>
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer"
                title={s.label}
                aria-label={s.label}
              >
                <SocialIcon id={s.id} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/** Cifras clave: clientes activos, inversión y ROAS del mes, y facturado en el año. */
function KeyFigures({ currency }: { currency: string }) {
  const { cl, active } = useClientStats()
  const today = useToday()
  const kit = useMetricKit()
  const status = useMetaStatus()
  const connected = useHasAdData() === true
  const month = useAnalysis(connected ? rangeFor('month', today) : null)
  const year = { since: `${today.slice(0, 4)}-01-01`, until: today }
  const billing = useQuery({
    queryKey: ['data', 'billing', 'profile', year],
    queryFn: () => call('billing:summary', year),
  })
  const c = month.data?.currency ?? status?.settings.displayCurrency ?? currency
  const sums = kit.compute(month.data?.totals ?? {})
  return (
    <div className="kpis" data-testid="profile-kpis">
      <Kpi
        label={t('Clientes activos')}
        value={formatNumber(active.length, 0)}
        hint={t('de {n} en total', { n: formatNumber(cl.length, 0) })}
      />
      <Kpi
        label={t('Inversión gestionada este mes')}
        value={connected ? formatMetric(sums['gasto'], kit.defs.get('gasto'), c) : '—'}
        hint={connected ? t('en Meta') : t('Conecta Meta en Campañas')}
      />
      <Kpi
        label={t('ROAS medio del mes')}
        value={connected ? formatMetric(sums['roas'], kit.defs.get('roas'), c) : '—'}
      />
      <Kpi
        label={t('Facturado este año')}
        value={formatCurrency(
          billing.data?.totals.facturado ?? 0,
          billing.data?.currency ?? currency,
        )}
      />
    </div>
  )
}

/** Tarjeta de un cliente destacado, como los repositorios fijados de GitHub. */
function PinnedCard({
  client,
  stage,
}: {
  client: RecordRow
  stage: ReturnType<typeof useClientStats>['stages'][number] | undefined
}) {
  const nav = useNav()
  const today = useToday()
  const kit = useMetricKit()
  const connected = useHasAdData() === true
  const month = useAnalysis(
    connected ? { ...rangeFor('month', today), filter: { type: 'client', id: client.id } } : null,
  )
  const spend = kit.compute(month.data?.totals ?? {})['gasto']
  return (
    <li className="pinned-card">
      <button
        type="button"
        className="pinned-title"
        onClick={() => nav.openRecord('cliente', client.id)}
      >
        <SectionIcon name="briefcase" />
        {client.title || t('Sin nombre')}
      </button>
      <div className="pinned-meta">
        {stage && <OptionChip option={stage} />}
        {connected && month.data && (
          <span className="faint num">
            {t('{amount} este mes', {
              amount: formatMetric(spend, kit.defs.get('gasto'), month.data.currency),
            })}
          </span>
        )}
      </div>
    </li>
  )
}

function PinnedClients({ profile }: { profile: Profile }) {
  const { cl, stages, stageOf } = useClientStats()
  const [choosing, setChoosing] = useState(false)
  const pinned = profile.pinned.flatMap((id) => cl.filter((c) => c.id === id))
  return (
    <section className="profile-section" data-testid="profile-pinned">
      <div className="profile-section-head">
        <h2>{t('Clientes destacados')}</h2>
        <button type="button" className="btn-link" onClick={() => setChoosing(true)}>
          {t('Personalizar')}
        </button>
      </div>
      {pinned.length === 0 ? (
        <p className="faint">
          {cl.length
            ? t('Elige hasta {n} clientes para tenerlos a mano aquí.', { n: MAX_PINNED_CLIENTS })
            : t('Cuando tengas clientes podrás destacar aquí los más importantes.')}
        </p>
      ) : (
        <ul className="pinned-grid">
          {pinned.map((c) => (
            <PinnedCard key={c.id} client={c} stage={stages.find((s) => s.id === stageOf(c))} />
          ))}
        </ul>
      )}
      {choosing && <PinDialog profile={profile} clients={cl} onClose={() => setChoosing(false)} />}
    </section>
  )
}

function PinDialog({
  profile,
  clients,
  onClose,
}: {
  profile: Profile
  clients: RecordRow[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<string[]>(profile.pinned)
  const [error, setError] = useState<string | null>(null)
  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_PINNED_CLIENTS ? [...p, id] : p,
    )
  const save = async () => {
    try {
      const saved = await call('profile:set', { ...profile, pinned: picked })
      qc.setQueryData(['data', 'profile'], saved)
      onClose()
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : t('No se pudo guardar el perfil.'))
    }
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-label={t('Clientes destacados')}>
        <h2>{t('Clientes destacados')}</h2>
        <p className="muted">
          {t('Elige hasta {n}. Se muestran en este orden.', { n: MAX_PINNED_CLIENTS })}
        </p>
        <ul className="pin-list">
          {clients.map((c) => (
            <li key={c.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  disabled={!picked.includes(c.id) && picked.length >= MAX_PINNED_CLIENTS}
                  onChange={() => toggle(c.id)}
                />
                {c.title || t('Sin nombre')}
              </label>
            </li>
          ))}
        </ul>
        {error && <Alert>{error}</Alert>}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            {t('Guardar')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
        </div>
      </div>
    </>
  )
}

const WEEKS = 53

/** Lunes de la semana de una fecha aaaa-mm-dd. */
function mondayOf(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return shiftDate(iso, -((day + 6) % 7))
}

/** Mapa de actividad del último año, como las contribuciones de GitHub. */
function ActivityMap() {
  const today = useToday()
  const q = useQuery({
    queryKey: ['data', 'profile', 'activity'],
    queryFn: () => call('profile:activity'),
  })
  const { weeks, total, max } = useMemo(() => {
    const counts = new Map((q.data ?? []).map((d) => [d.date, d.count]))
    const start = shiftDate(mondayOf(today), -(WEEKS - 1) * 7)
    const weeks = Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const date = shiftDate(start, w * 7 + d)
        return { date, count: date > today ? null : (counts.get(date) ?? 0) }
      }),
    )
    const all = (q.data ?? []).map((d) => d.count)
    return { weeks, total: all.reduce((a, b) => a + b, 0), max: Math.max(1, ...all) }
  }, [q.data, today])
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  return (
    <section className="profile-section" data-testid="profile-activity">
      <div className="profile-section-head">
        <h2>{tn(total, '{n} cambio en el último año', '{n} cambios en el último año')}</h2>
      </div>
      <div className="activity-scroll">
        <div className="activity-map" role="img" aria-label={t('Mapa de actividad del último año')}>
          {weeks.map((week, w) => (
            <div key={w} className="activity-week">
              {week.map((d) =>
                d.count === null ? (
                  <span key={d.date} className="activity-day" data-empty="true" />
                ) : (
                  <span
                    key={d.date}
                    className="activity-day"
                    data-level={level(d.count)}
                    title={tn(d.count, '{n} cambio el {date}', '{n} cambios el {date}', {
                      date: isoToEs(d.date),
                    })}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="activity-legend faint">
        <span>{t('Menos')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="activity-day" data-level={l} aria-hidden="true" />
        ))}
        <span>{t('Más')}</span>
      </div>
    </section>
  )
}

/** Perfil ya configurado: como la página de un usuario de GitHub. */
export function ProfileView({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  return (
    <div className="profile-layout" data-testid="profile-view">
      <ProfileCard profile={profile} onEdit={onEdit} />
      <div className="profile-main">
        <KeyFigures currency={profile.currency} />
        <PinnedClients profile={profile} />
        <ActivityMap />
      </div>
    </div>
  )
}
