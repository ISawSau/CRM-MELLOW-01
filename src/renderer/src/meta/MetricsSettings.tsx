import { useState } from 'react'
import { t, tn } from '@shared/i18n'
import {
  DEFAULT_HOLD_RATE,
  knownKeys,
  metricProblem,
  type CustomMetric,
  type MetricFormat,
} from '@shared/meta-metrics'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { useSaveTableSettings, useTableSettings } from './metrics'

const FORMAT_LABELS: Record<MetricFormat, string> = {
  currency: 'Moneda',
  percent: 'Porcentaje',
  number: 'Número',
  integer: 'Número entero',
}

/** «Beneficio neto» → «beneficio_neto» */
function keyFrom(label: string): string {
  const k = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(k) ? k : `m_${k}`.slice(0, 40)
}

function MetricDialog({
  metric,
  others,
  onSave,
  onClose,
}: {
  metric: CustomMetric | null
  others: CustomMetric[]
  onSave: (m: CustomMetric) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(metric?.label ?? '')
  const [expression, setExpression] = useState(metric?.expression ?? '')
  const [format, setFormat] = useState<MetricFormat>(metric?.format ?? 'number')
  const [decimals, setDecimals] = useState(metric?.decimals ?? 2)
  const key = metric?.key ?? keyFrom(label)
  const known = knownKeys(others)
  const clash = !metric && (known.has(key) || others.some((o) => o.key === key))
  const problem = expression.trim() ? metricProblem(expression, known) : null
  const valid = label.trim() && key && expression.trim() && !problem && !clash
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-t"
        data-testid="metric-dialog"
      >
        <h2 id="metric-t">{metric ? t('Editar métrica') : t('Nueva métrica')}</h2>
        <div className="field">
          <label htmlFor="metric-label">{t('Nombre')}</label>
          <input
            id="metric-label"
            className="input"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="hint">
            {t('En las fórmulas se usa como')} <code>{key || '…'}</code>.
            {clash && <span className="danger-text"> {t('Ese nombre ya existe.')}</span>}
          </p>
        </div>
        <div className="field">
          <label htmlFor="metric-expr">{t('Fórmula')}</label>
          <input
            id="metric-expr"
            className="input mono"
            value={expression}
            placeholder="valor_compras - gasto - 50"
            onChange={(e) => setExpression(e.target.value)}
          />
          {problem ? (
            <p className="hint danger-text">{problem}</p>
          ) : (
            <p className="hint">
              {t('Métricas:')} <code>gasto</code>, <code>impresiones</code>,{' '}
              <code>clics_enlace</code>, <code>compras</code>, <code>valor_compras</code>,{' '}
              <code>roas</code>, <code>cpa</code>, <code>alcance</code>
              {t('… y cualquier acción como')} <code>acc_lead</code> {t('o su valor')}{' '}
              <code>val_purchase</code>
              {t('. Funciones: SI, Y, O, REDONDEAR, MIN, MAX… Los decimales van con punto.')}
            </p>
          )}
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="metric-format">{t('Formato')}</label>
            <select
              id="metric-format"
              className="input"
              value={format}
              onChange={(e) => setFormat(e.target.value as MetricFormat)}
            >
              {Object.entries(FORMAT_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
            </select>
            {format === 'percent' && (
              <p className="hint">
                {t('El resultado ya en tanto por cien: … / impresiones * 100.')}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="metric-decimals">{t('Decimales')}</label>
            <select
              id="metric-decimals"
              className="input"
              value={decimals}
              onChange={(e) => setDecimals(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={() =>
              onSave({ key, label: label.trim(), expression: expression.trim(), format, decimals })
            }
          >
            {t('Guardar')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Métricas propias, hold rate y vínculo automático de creatividades (Campañas → Ajustes). */
export function MetricsSettings() {
  const settings = useTableSettings()
  const save = useSaveTableSettings()
  const toast = useToast()
  const [editing, setEditing] = useState<CustomMetric | 'new' | null>(null)
  const [hold, setHold] = useState<string | null>(null)
  const [pattern, setPattern] = useState<string | null>(null)
  const s = settings.data
  if (!s) return null
  const holdValue = hold ?? s.holdRate
  const holdProblem = metricProblem(holdValue, knownKeys(s.metrics))
  const patternValue = pattern ?? s.naming.pattern
  return (
    <>
      <h3 className="panel-subtitle">{t('Métricas propias')}</h3>
      <p className="hint">
        {t(
          'Se calculan con un parser seguro sobre cualquier métrica o acción y se pueden usar como columnas en la tabla.',
        )}
      </p>
      <ul className="metric-list" data-testid="custom-metrics">
        {s.metrics.map((m) => (
          <li key={m.key}>
            <strong>{m.label}</strong>
            <code className="faint">
              {m.key} = {m.expression}
            </code>
            <span className="faint">{t(FORMAT_LABELS[m.format])}</span>
            <span className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(m)}>
                {t('Editar')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void save({ metrics: s.metrics.filter((x) => x.key !== m.key) })}
              >
                {t('Borrar')}
              </button>
            </span>
          </li>
        ))}
        {s.metrics.length === 0 && <li className="faint">{t('Aún no hay métricas propias.')}</li>}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          {t('+ Métrica')}
        </button>
      </div>

      <div className="field">
        <label htmlFor="hold-rate">{t('Hold rate')}</label>
        <input
          id="hold-rate"
          className="input mono"
          value={holdValue}
          onChange={(e) => setHold(e.target.value)}
          onBlur={() => {
            if (hold !== null && !holdProblem && hold.trim()) void save({ holdRate: hold.trim() })
          }}
        />
        {holdProblem ? (
          <p className="hint danger-text">{holdProblem}</p>
        ) : (
          <p className="hint">
            {t('Por defecto, el estándar: de quienes ven 3 s, cuántos llegan a 15 s.')}{' '}
            <code>{DEFAULT_HOLD_RATE}</code>. {t('Otra opción:')}{' '}
            <code>thruplays / impresiones * 100</code>.
          </p>
        )}
      </div>

      <h3 className="panel-subtitle">{t('Vincular anuncios y creatividades')}</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={s.naming.byCode}
          onChange={(e) => void save({ naming: { ...s.naming, byCode: e.target.checked } })}
        />
        <span>{t('Si el nombre del anuncio contiene el código de una creatividad')}</span>
      </label>
      <div className="field">
        <label htmlFor="naming">{t('Convención de nombres (opcional)')}</label>
        <input
          id="naming"
          className="input mono"
          value={patternValue}
          placeholder="{cliente}_{angulo}_{formato}_v{version}"
          onChange={(e) => setPattern(e.target.value)}
          onBlur={() => {
            if (pattern !== null) void save({ naming: { ...s.naming, pattern: pattern.trim() } })
          }}
        />
        <p className="hint">
          {t('Entre llaves, campos de la creatividad')} (<code>{'{angulo}'}</code>,{' '}
          <code>{'{formato}'}</code>, <code>{'{cliente}'}</code>, <code>{'{codigo}'}</code>…);{' '}
          <code>{'{*}'}</code>{' '}
          {t(
            'vale cualquier cosa. Si el nombre de un anuncio encaja con una sola creatividad, se vinculan solos. Lo que desvincules a mano no se vuelve a vincular.',
          )}
        </p>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void call('meta:autoLink')
              .then((n) =>
                toast.show(
                  n === 0
                    ? t('No hay vínculos nuevos.')
                    : tn(n, '{n} vínculo nuevo.', '{n} vínculos nuevos.'),
                ),
              )
              .catch((e: unknown) =>
                toast.show(
                  e instanceof IpcCallError ? e.message : t('No se pudo vincular.'),
                  'error',
                ),
              )
          }
        >
          {t('Vincular ahora')}
        </button>
      </div>

      {editing && (
        <MetricDialog
          metric={editing === 'new' ? null : editing}
          others={
            editing === 'new'
              ? s.metrics
              : s.metrics.slice(
                  0,
                  s.metrics.findIndex((m) => m.key === editing.key),
                )
          }
          onClose={() => setEditing(null)}
          onSave={(m) => {
            const exists = s.metrics.some((x) => x.key === m.key)
            void save({
              metrics: exists ? s.metrics.map((x) => (x.key === m.key ? m : x)) : [...s.metrics, m],
            })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
