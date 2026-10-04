import { useState } from 'react'
import { formatDateTime } from '@shared/format'
import { GmailSettings } from '../gmail/GmailSettings'
import { useProfile } from '../data/nav'
import { useMetaAccounts, useMetaStatus } from '../meta/meta'
import { ProfileSettings } from './ProfileSettings'
import { ProfileView } from './ProfileView'
import { profileReady } from '@shared/profile'
import { useSyncStatus } from './sync'
import { t, tc, tn } from '@shared/i18n'

type Tab = 'perfil' | 'editar' | 'cuentas'

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
      </ul>
      <GmailSettings />
    </div>
  )
}

/**
 * Perfil (antes de Inicio, D-095). La primera vez es un asistente para configurarlo; después
 * se ve como la página de un usuario de GitHub, con pestañas para editarlo y para las cuentas.
 */
export function ProfilePage({ onNavigate }: { onNavigate: (section: string) => void }) {
  const profile = useProfile().data
  const [tab, setTab] = useState<Tab>('perfil')
  const ready = profile ? profileReady(profile) : true
  const tabs: [Tab, string][] = ready
    ? [
        ['perfil', 'Perfil'],
        ['editar', 'Editar'],
        ['cuentas', 'Cuentas conectadas'],
      ]
    : [
        ['perfil', 'Configurar'],
        ['cuentas', 'Cuentas conectadas'],
      ]
  return (
    <div className="page page-wide" data-testid="page-perfil">
      <div className="tabs" role="tablist" aria-label={t('Perfil')}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`profile-tab-${id}`}
          >
            {tc('perfil', label)}
          </button>
        ))}
      </div>
      {tab === 'cuentas' ? (
        <Accounts onNavigate={onNavigate} />
      ) : tab === 'editar' ? (
        <ProfileSettings onDone={() => setTab('perfil')} />
      ) : !profile ? null : ready ? (
        <ProfileView profile={profile} onEdit={() => setTab('editar')} />
      ) : (
        <ProfileSettings setup onDone={() => setTab('perfil')} />
      )}
    </div>
  )
}
