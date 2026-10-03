import { parseFieldConfig, type FieldDef } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { formatCurrency, formatNumber } from '@shared/format'
import { OptionChip } from '../data/FieldValue'
import { useFields, useRecords } from '../data/hooks'
import { useNav, useProfile } from '../data/nav'

const ALL = { filters: [], match: 'all' as const, sorts: [] }
const RECENT = {
  filters: [],
  match: 'all' as const,
  sorts: [{ fieldId: 'updatedAt', dir: 'desc' } as const],
}

const byKey = (fields: FieldDef[] | undefined, key: string) => fields?.find((f) => f.key === key)

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      {hint && <span className="kpi-hint faint">{hint}</span>}
    </div>
  )
}

function Upcoming({ title, phase, text }: { title: string; phase: number; text: string }) {
  return (
    <section className="home-card home-upcoming">
      <h2 className="home-card-title">{title}</h2>
      <p className="muted">{text}</p>
      <span className="faint">Llega en la fase {phase}.</span>
    </section>
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

/** Inicio (SPEC §7.1): visión general. Gasto, ROAS y alertas llegan con Meta. */
export function Home({ onNavigate }: { onNavigate: (section: string) => void }) {
  const profile = useProfile()
  const cFields = useFields('cliente')
  const clients = useRecords('cliente', ALL)
  const contacts = useRecords('contacto', ALL)
  const nFields = useFields('nota')
  const notes = useRecords('nota', RECENT)

  const etapa = byKey(cFields.data, 'etapa')
  const fee = byKey(cFields.data, 'fee')
  const fijada = byKey(nFields.data, 'fijada')
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
  const maxCount = Math.max(1, ...stages.map((s) => cl.filter((r) => stageOf(r) === s.id).length))
  const nt = notes.data ?? []
  const pinned = fijada ? nt.filter((r) => r.values[fijada.id] === true).slice(0, 6) : []
  const name = profile.data?.name.trim()
  const currency = profile.data?.currency ?? 'EUR'

  return (
    <div className="page page-wide" data-testid="page-inicio">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">00</span> inicio
        </span>
        <h1 className="title">{name ? `Hola, ${name.split(' ')[0]}` : 'Inicio'}</h1>
      </div>

      <div className="kpis" data-testid="home-kpis">
        <Kpi
          label="Clientes activos"
          value={formatNumber(active.length, 0)}
          hint={`de ${formatNumber(cl.length, 0)} en total`}
        />
        <Kpi
          label="Fees mensuales"
          value={formatCurrency(monthly, currency)}
          hint="clientes activos"
        />
        <Kpi label="Contactos" value={formatNumber(contacts.data?.length ?? 0, 0)} />
        <Kpi label="Notas" value={formatNumber(nt.length, 0)} />
      </div>

      <div className="home-grid">
        <section className="home-card">
          <div className="home-card-head">
            <h2 className="home-card-title">Clientes por etapa</h2>
            <button type="button" className="btn-link" onClick={() => onNavigate('clientes')}>
              Ver pipeline →
            </button>
          </div>
          {stages.length === 0 ? (
            <p className="faint">Sin etapas.</p>
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

        <section className="home-card">
          <div className="home-card-head">
            <h2 className="home-card-title">Notas recientes</h2>
            <button type="button" className="btn-link" onClick={() => onNavigate('notas')}>
              Ver notas →
            </button>
          </div>
          <RecordList rows={nt.slice(0, 6)} empty="Aún no hay notas." entity="nota" />
          {pinned.length > 0 && (
            <>
              <h3 className="panel-subtitle">Fijadas</h3>
              <RecordList rows={pinned} empty="" entity="nota" />
            </>
          )}
        </section>

        <Upcoming
          title="Gasto y ROAS"
          phase={6}
          text="Gasto de hoy, 7 y 30 días y ROAS de tus cuentas de Meta."
        />
        <Upcoming title="Tareas" phase={3} text="Tareas de hoy y atrasadas." />
        <Upcoming title="Alertas" phase={8} text="Avisos cuando una métrica cruza tu umbral." />
      </div>
    </div>
  )
}
