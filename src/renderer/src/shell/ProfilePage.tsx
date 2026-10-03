import { useState } from 'react'
import { formatDateTime } from '@shared/format'
import { GmailSettings } from '../gmail/GmailSettings'
import { useProfile } from '../data/nav'
import { useMetaAccounts, useMetaStatus } from '../meta/meta'
import { LinkedInToggle } from '../platforms/LinkedInToggle'
import { useLinkedInStatus, usePlatformAccounts } from '../platforms/platforms'
import { ProfileSettings } from './ProfileSettings'
import { useSyncStatus } from './sync'
import { t, tn } from '@shared/i18n'

type Tab = 'datos' | 'cuentas'

/** Una cuenta conectada: estado y dónde se gestiona. */
function AccountCard({
  name,
  state,
  tone,
  detail,
  action,
  onAction,
  testId,
}: {
  name: string
  state: string
  tone: 'ok' | 'off' | 'error' | 'warn'
  detail?: string | null
  action?: string
  onAction?: () => void
  testId: string
}) {
  return (
    <li className="account-card" data-testid={testId}>
      <span className={`marker marker-${tone}`} aria-hidden="true" />
      <div className="account-card-body">
        <strong>{name}</strong>
        <span className="muted">{state}</span>
        {detail && <span className="faint">{detail}</span>}
      </div>
      {action && onAction && (
        <button type="button" className="btn" onClick={onAction}>
          {action}
        </button>
      )}
    </li>
  )
}

const when = (iso: string | null) =>
  iso ? t('Última vez: {date}', { date: formatDateTime(new Date(iso)) }) : null

/** Resumen de todas las cuentas y servicios conectados. */
function Accounts({ onNavigate }: { onNavigate: (section: string) => void }) {
  const meta = useMetaStatus()
  const metaAccounts = (useMetaAccounts().data ?? []).filter((a) => a.enabled)
  const sync = useSyncStatus()
  const linkedin = useLinkedInStatus().data
  const other = usePlatformAccounts().data ?? []
  const xAccounts = other.filter((a) => a.platform === 'x')
  const liAccounts = other.filter((a) => a.platform === 'linkedin' && a.enabled)
  return (
    <div className="profile-accounts">
      <ul className="account-cards">
        <AccountCard
          testId="account-meta"
          name="Meta Ads"
          tone={!meta?.connected ? 'off' : meta.phase === 'error' ? 'error' : 'ok'}
          state={
            meta?.connected
              ? t(
                  meta.user
                    ? 'Conectado como {user} (solo lectura) · {accounts}'
                    : 'Conectado (solo lectura) · {accounts}',
                  {
                    user: meta.user ?? '',
                    accounts: tn(
                      metaAccounts.length,
                      '{n} cuenta activada',
                      '{n} cuentas activadas',
                    ),
                  },
                )
              : t('Sin conectar')
          }
          detail={meta?.error ?? when(meta?.lastSyncAt ?? null)}
          action={meta?.connected ? t('Gestionar') : t('Conectar')}
          onAction={() => onNavigate('campanas')}
        />
        <AccountCard
          testId="account-sync"
          name={t('Sincronización y copias')}
          tone={!sync?.kind ? 'off' : sync.phase === 'error' ? 'error' : 'ok'}
          state={
            sync?.kind
              ? `${sync.kind === 'drive' ? 'Google Drive' : t('Carpeta')}${sync.label ? ` · ${t(sync.label)}` : ''}`
              : t('Sin configurar: la bóveda solo está en este equipo')
          }
          detail={sync?.error ?? when(sync?.lastSyncAt ?? null)}
          action={t('Configurar')}
          onAction={() => onNavigate('ajustes')}
        />
        <AccountCard
          testId="account-x"
          name="X Ads"
          tone={xAccounts.length ? 'ok' : 'off'}
          state={
            xAccounts.length
              ? t('{accounts} por CSV', {
                  accounts: tn(xAccounts.length, '{n} cuenta', '{n} cuentas'),
                })
              : t('Sin cuentas: se importan con los CSV de X Ads')
          }
          action={t('Abrir')}
          onAction={() => onNavigate('plataformas')}
        />
        {linkedin?.enabled && (
          <AccountCard
            testId="account-linkedin"
            name="LinkedIn Ads"
            tone={!linkedin.connected ? 'off' : linkedin.error ? 'error' : 'ok'}
            state={
              linkedin.connected
                ? t('Conectado (solo lectura) · {accounts}', {
                    accounts: tn(liAccounts.length, '{n} cuenta activada', '{n} cuentas activadas'),
                  })
                : t('Activado, sin conectar')
            }
            detail={linkedin.error ?? when(linkedin.lastSyncAt)}
            action={t('Gestionar')}
            onAction={() => onNavigate('plataformas')}
          />
        )}
      </ul>
      <GmailSettings />
      <LinkedInToggle />
    </div>
  )
}

/**
 * Perfil (antes de Inicio): tus datos y los de tu empresa, y las cuentas y servicios
 * conectados, con sus ajustes.
 */
export function ProfilePage({ onNavigate }: { onNavigate: (section: string) => void }) {
  const profile = useProfile().data
  const [tab, setTab] = useState<Tab>('datos')
  return (
    <div className="page page-wide" data-testid="page-perfil">
      <div className="section-head section-head-profile">
        {profile?.photo && <img className="profile-photo" src={profile.photo} alt="" />}
        <div>
          <span className="eyebrow">
            <span className="num">00</span> {t('perfil')}
          </span>
          <h1 className="title">{profile?.name.trim() || t('Perfil')}</h1>
          {profile?.company && <p className="muted">{profile.company}</p>}
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label={t('Perfil')}>
        {(
          [
            ['datos', 'Datos'],
            ['cuentas', 'Cuentas conectadas'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`profile-tab-${id}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'datos' ? <ProfileSettings /> : <Accounts onNavigate={onNavigate} />}
    </div>
  )
}
