import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Widget } from '@shared/analysis'
import { parseFieldConfig, type FieldDef } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { formatCurrency, formatNumber } from '@shared/format'
import { OptionChip } from '../data/FieldValue'
import { useFields, useRecords } from '../data/hooks'
import { useNav, useProfile } from '../data/nav'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_CARD_LABELS,
  HOME_CARDS,
  homeItemKey,
  type HomeCard,
  type HomeItem,
} from '@shared/home'
import { AlertsCard, PacingCard, SpendCard } from '../analysis/HomeCards'
import { WidgetDialog, WidgetView } from '../analysis/Widget'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { t } from '@shared/i18n'

const ALL = { filters: [], match: 'all' as const, sorts: [] }
const RECENT = {
  filters: [],
  match: 'all' as const,
  sorts: [{ fieldId: 'updatedAt', dir: 'desc' } as const],
}

const byKey = (fields: FieldDef[] | undefined, key: string) => fields?.find((f) => f.key === key)

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      {hint && <span className="kpi-hint faint">{hint}</span>}
    </div>
  )
}

function RecordList({ rows, empty, entity }: { rows: RecordRow[]; empty: string; entity: string }) {
  const nav = useNav()
  if (rows.length === 0) return <p className="faint">{empty}</p>
  return (
    <ul className="home-list">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="home-item" onClick={() => nav.openRecord(entity, r.id)}>
            {r.title}
          </button>
        </li>
      ))}
    </ul>
  )
}

function TasksCard({ onNavigate }: { onNavigate: (section: string) => void }) {
  const fields = useFields('tarea')
  const due = byKey(fields.data, 'fecha_limite')
  const estado = byKey(fields.data, 'estado')
  const doneIds =
    estado?.type === 'select'
      ? parseFieldConfig('select', estado.config)
          .options.filter((o) => o.done)
          .map((o) => o.id)
      : []
  const base =
    estado && doneIds.length ? [{ fieldId: estado.id, op: 'none_of' as const, value: doneIds }] : []
  const q = (op: 'today' | 'before_today') => ({
    filters: due ? [{ fieldId: due.id, op, value: null }, ...base] : [],
    match: 'all' as const,
    sorts: due ? [{ fieldId: due.id, dir: 'asc' as const }] : [],
  })
  const today = useRecords('tarea', q('today'))
  const overdue = useRecords('tarea', q('before_today'))
  const ready = !!due
  return (
    <section className="home-card" data-testid="home-tasks">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Tareas')}</h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('tareas')}>
          {t('Ver tareas →')}
        </button>
      </div>
      <h3 className="panel-subtitle">
        {t('Atrasadas')} · {ready ? (overdue.data?.length ?? 0) : 0}
      </h3>
      <RecordList
        rows={ready ? (overdue.data ?? []).slice(0, 6) : []}
        empty={t('Nada atrasado.')}
        entity="tarea"
      />
      <h3 className="panel-subtitle">
        {t('Hoy')} · {ready ? (today.data?.length ?? 0) : 0}
      </h3>
      <RecordList
        rows={ready ? (today.data ?? []).slice(0, 6) : []}
        empty={t('Nada para hoy.')}
        entity="tarea"
      />
    </section>
  )
}

export function useClientStats() {
  const cFields = useFields('cliente')
  const clients = useRecords('cliente', ALL)
  const etapa = byKey(cFields.data, 'etapa')
  const fee = byKey(cFields.data, 'fee')
  const stages = etapa?.type === 'select' ? parseFieldConfig('select', etapa.config).options : []
  const cl = clients.data ?? []
  const stageOf = (r: RecordRow) => (etapa ? (r.values[etapa.id] as string | undefined) : undefined)
  const active = cl.filter((r) => stageOf(r) === 'activo')
  const monthly = fee
    ? active.reduce(
        (sum, r) => sum + (typeof r.values[fee.id] === 'number' ? (r.values[fee.id] as number) : 0),
        0,
      )
    : 0
  return { cl, stages, stageOf, active, monthly }
}

function KpisCard() {
  const profile = useProfile()
  const contacts = useRecords('contacto', ALL)
  const notes = useRecords('nota', RECENT)
  const { cl, active, monthly } = useClientStats()
  const currency = profile.data?.currency ?? 'EUR'
  return (
    <div className="kpis" data-testid="home-kpis">
      <Kpi
        label={t('Clientes activos')}
        value={formatNumber(active.length, 0)}
        hint={t('de {n} en total', { n: formatNumber(cl.length, 0) })}
      />
      <Kpi
        label={t('Fees mensuales')}
        value={formatCurrency(monthly, currency)}
        hint={t('clientes activos')}
      />
      <Kpi label={t('Contactos')} value={formatNumber(contacts.data?.length ?? 0, 0)} />
      <Kpi label={t('Notas')} value={formatNumber(notes.data?.length ?? 0, 0)} />
    </div>
  )
}

function StagesCard({ onNavigate }: { onNavigate: (section: string) => void }) {
  const { cl, stages, stageOf } = useClientStats()
  const maxCount = Math.max(1, ...stages.map((s) => cl.filter((r) => stageOf(r) === s.id).length))
  return (
    <section className="home-card" data-testid="home-stages">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Clientes por etapa')}</h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('clientes')}>
          {t('Ver pipeline →')}
        </button>
      </div>
      {stages.length === 0 ? (
        <p className="faint">{t('Sin etapas.')}</p>
      ) : (
        <ul className="stage-bars">
          {stages.map((s) => {
            const n = cl.filter((r) => stageOf(r) === s.id).length
            return (
              <li key={s.id} className="stage-bar">
                <OptionChip option={s} />
                <span className="bar" aria-hidden="true">
                  <span
                    className="bar-fill"
                    data-color={s.color}
                    style={{ width: `${(n / maxCount) * 100}%` }}
                  />
                </span>
                <span className="num">{n}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function NotesCard({ onNavigate }: { onNavigate: (section: string) => void }) {
  const nFields = useFields('nota')
  const notes = useRecords('nota', RECENT)
  const fijada = byKey(nFields.data, 'fijada')
  const nt = notes.data ?? []
  const pinned = fijada ? nt.filter((r) => r.values[fijada.id] === true).slice(0, 6) : []
  return (
    <section className="home-card" data-testid="home-notes">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Notas recientes')}</h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('notas')}>
          {t('Ver notas →')}
        </button>
      </div>
      <RecordList rows={nt.slice(0, 6)} empty={t('Aún no hay notas.')} entity="nota" />
      {pinned.length > 0 && (
        <>
          <h3 className="panel-subtitle">{t('Fijadas')}</h3>
          <RecordList rows={pinned} empty="" entity="nota" />
        </>
      )}
    </section>
  )
}

function HomeCardView({ id, onNavigate }: { id: HomeCard; onNavigate: (s: string) => void }) {
  switch (id) {
    case 'kpis':
      return <KpisCard />
    case 'etapas':
      return <StagesCard onNavigate={onNavigate} />
    case 'notas':
      return <NotesCard onNavigate={onNavigate} />
    case 'gasto':
      return <SpendCard onNavigate={onNavigate} />
    case 'ritmo':
      return <PacingCard onNavigate={onNavigate} />
    case 'tareas':
      return <TasksCard onNavigate={onNavigate} />
    case 'alertas':
      return <AlertsCard onNavigate={onNavigate} />
  }
}

const ALL_ACCOUNTS = { type: 'all' } as const

/** Inicio (SPEC §7.1): visión general con tarjetas y widgets configurables (fase 12). */
export function Home({ onNavigate }: { onNavigate: (section: string) => void }) {
  const profile = useProfile()
  const qc = useQueryClient()
  const toast = useToast()
  const layoutQ = useQuery({
    queryKey: ['data', 'home', 'layout'],
    queryFn: () => call('home:layout'),
  })
  const [editing, setEditing] = useState(false)
  const [widget, setWidget] = useState<Widget | 'new' | null>(null)
  const name = profile.data?.name.trim()
  const items = layoutQ.data?.items ?? DEFAULT_HOME_LAYOUT.items
  const hidden = HOME_CARDS.filter((c) => !items.some((i) => i.kind === 'card' && i.id === c))

  const save = (next: HomeItem[] | null) =>
    call('home:setLayout', { layout: next === null ? null : { items: next } })
      .then((l) => qc.setQueryData(['data', 'home', 'layout'], l))
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : t('No se ha podido guardar.'), 'error'),
      )
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const [it] = next.splice(i, 1)
    next.splice(i + d, 0, it!)
    void save(next)
  }
  const label = (it: HomeItem) =>
    it.kind === 'card'
      ? t(HOME_CARD_LABELS[it.id])
      : t('Widget: {title}', { title: it.widget.title || t('de análisis') })

  return (
    <div className="page page-wide" data-testid="page-inicio">
      <div className="section-head section-head-actions">
        <div>
          <span className="eyebrow">
            <span className="num">00</span> {t('inicio')}
          </span>
          <h1 className="title">
            {name ? t('Hola, {name}', { name: name.split(' ')[0] ?? '' }) : t('Inicio')}
          </h1>
        </div>
        <button
          type="button"
          className={editing ? 'btn btn-primary' : 'btn'}
          onClick={() => setEditing(!editing)}
          data-testid="home-customize"
        >
          {editing ? t('Listo') : t('Personalizar')}
        </button>
      </div>

      {editing && (
        <div className="home-editor" data-testid="home-editor">
          <p className="muted">
            {t(
              'Ordena o quita tarjetas con los botones de cada una, y añade las que faltan o widgets de Análisis (de todas las cuentas).',
            )}
          </p>
          <div className="form-actions">
            {hidden.map((c) => (
              <button
                key={c}
                type="button"
                className="btn"
                onClick={() => void save([...items, { kind: 'card', id: c }])}
              >
                + {t(HOME_CARD_LABELS[c])}
              </button>
            ))}
            <button type="button" className="btn" onClick={() => setWidget('new')}>
              + {t('Widget de análisis')}
            </button>
            <button type="button" className="btn-link" onClick={() => void save(null)}>
              {t('Restablecer Inicio')}
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty">
          <h2>{t('Inicio vacío')}</h2>
          <p className="muted">{t('Pulsa «Personalizar» para añadir tarjetas o widgets.')}</p>
        </div>
      )}
      <div className="home-grid">
        {items.map((it, i) => (
          <div
            key={homeItemKey(it)}
            className="home-item-cell"
            data-wide={
              it.kind === 'card' ? it.id === 'kpis' : it.widget.size === 'l' ? true : undefined
            }
          >
            {editing && (
              <div className="home-item-tools" role="group" aria-label={label(it)}>
                <span className="faint">{label(it)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Subir {label}', { label: label(it) })}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Bajar {label}', { label: label(it) })}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Quitar {label}', { label: label(it) })}
                  onClick={() => void save(items.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            )}
            {it.kind === 'card' ? (
              <HomeCardView id={it.id} onNavigate={onNavigate} />
            ) : (
              <WidgetView
                w={it.widget}
                filter={ALL_ACCOUNTS}
                onEdit={editing ? () => setWidget(it.widget) : null}
                onRemove={null}
              />
            )}
          </div>
        ))}
      </div>
      {widget && (
        <WidgetDialog
          widget={widget === 'new' ? null : widget}
          onClose={() => setWidget(null)}
          onSave={(w) => {
            const exists = items.some((x) => x.kind === 'widget' && x.widget.id === w.id)
            void save(
              exists
                ? items.map((x) =>
                    x.kind === 'widget' && x.widget.id === w.id ? { ...x, widget: w } : x,
                  )
                : [...items, { kind: 'widget', widget: w }],
            )
            setWidget(null)
          }}
        />
      )}
    </div>
  )
}
