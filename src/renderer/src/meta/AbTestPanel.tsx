import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { RecordRow } from '@shared/data/records'
import { abVerdict, AB_METRICS, parseAdIds, type AbVariant } from '@shared/growth'
import { t } from '@shared/i18n'
import { computeMetrics, DEFAULT_HOLD_RATE } from '@shared/meta-metrics'
import { useFields } from '../data/hooks'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { isoToEs } from './meta'
import { columnLabel, formatMetric, metricDefs, useActionTypes, useTableSettings } from './metrics'

const ROWS = ['gasto', 'impresiones', 'ctr_enlace', 'hook_rate', 'compras', 'cpa', 'roas', 'cpm']

/**
 * Test A/B (fase 14, D-108): los anuncios de cada variante y quién gana con la métrica
 * elegida, con las cifras de Meta entre el inicio y el fin del test.
 */
export function AbTestPanel({ record }: { record: RecordRow }) {
  const qc = useQueryClient()
  const toast = useToast()
  const fields = useFields('prueba')
  const byKey = (k: string) => fields.data?.find((f) => f.key === k)
  const result = useQuery({
    queryKey: ['data', 'meta', 'ab-test', record.id, record.updatedAt],
    queryFn: () => call('meta:abTest', { recordId: record.id }),
  })
  const settings = useTableSettings()
  const actionTypes = useActionTypes()
  const defs = useMemo(
    () => metricDefs(settings.data?.metrics ?? [], actionTypes.data ?? []),
    [settings.data?.metrics, actionTypes.data],
  )
  const compute = (v: AbVariant) =>
    computeMetrics(v.base, null, {
      custom: settings.data?.metrics ?? [],
      holdRate: settings.data?.holdRate ?? DEFAULT_HOLD_RATE,
      actionTypes: actionTypes.data ?? [],
    })

  const save = (key: string, value: unknown) => {
    const f = byKey(key)
    if (!f) return
    void call('data:update', { id: record.id, patch: { [f.id]: value } })
      .then(() => qc.invalidateQueries({ queryKey: ['data'] }))
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : t('No se pudo guardar.'), 'error'),
      )
  }
  const ids = (key: string) => parseAdIds(record.values[byKey(key)?.id ?? ''])
  const setAds = (key: string, next: string[]) => save(key, next.length ? next.join(',') : null)

  const r = result.data
  const va = r ? compute(r.a) : null
  const vb = r ? compute(r.b) : null
  const metric = r ? AB_METRICS[r.metric]! : null
  const verdict = r && va && vb ? abVerdict(r.metric, va, vb, r.a.base, r.b.base) : null
  const currency = r?.currency ?? 'EUR'
  const rows = metric && !ROWS.includes(metric.key) ? [metric.key, ...ROWS] : ROWS

  return (
    <section className="panel-rich" data-testid="ab-test">
      <h3 className="panel-subtitle">{t('Variantes')}</h3>
      <div className="ab-variants">
        {(['a', 'b'] as const).map((v) => (
          <VariantAds
            key={v}
            label={v === 'a' ? t('Variante A') : t('Variante B')}
            ads={r?.[v].ads ?? []}
            selected={ids(v === 'a' ? 'anuncios_a' : 'anuncios_b')}
            onChange={(next) => setAds(v === 'a' ? 'anuncios_a' : 'anuncios_b', next)}
          />
        ))}
      </div>
      {r && va && vb && metric && (
        <>
          <p className="faint">
            {t('Del {since} al {until}', { since: isoToEs(r.since), until: isoToEs(r.until) })}
            {r.partial && ` · ${t('faltan tipos de cambio')}`}
          </p>
          <table className="ab-table">
            <thead>
              <tr>
                <th />
                <th className="num">A</th>
                <th className="num">B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k} data-decides={k === metric.key || undefined}>
                  <th scope="row">{columnLabel(k, defs)}</th>
                  <td className="num">{formatMetric(va[k], defs.get(k), currency)}</td>
                  <td className="num">{formatMetric(vb[k], defs.get(k), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {verdict && (
            <Verdict
              verdict={verdict}
              metricLabel={columnLabel(metric.key, defs)}
              onPick={(w) => save('ganador', w)}
            />
          )}
        </>
      )}
    </section>
  )
}

function Verdict({
  verdict,
  metricLabel,
  onPick,
}: {
  verdict: ReturnType<typeof abVerdict>
  metricLabel: string
  onPick: (winner: 'a' | 'b' | 'empate') => void
}) {
  const pct = verdict.lift === null ? null : Math.round(Math.abs(verdict.lift) * 100)
  const better = verdict.lift === null ? null : verdict.lift > 0 ? 'B' : 'A'
  return (
    <div className="ab-verdict" data-testid="ab-verdict" data-winner={verdict.winner ?? 'none'}>
      {verdict.lift === null ? (
        <p className="muted">{t('Aún no hay datos suficientes en las dos variantes.')}</p>
      ) : verdict.winner ? (
        <p>
          <strong>
            {t('Gana {variant}: un {pct} % mejor en {metric}.', {
              variant: verdict.winner.toUpperCase(),
              pct: pct ?? 0,
              metric: metricLabel,
            })}
          </strong>{' '}
          <span className="faint">{t('La diferencia es clara (95 % de confianza).')}</span>
        </p>
      ) : (
        <p>
          {t('{variant} va un {pct} % mejor en {metric}, pero aún no es una diferencia clara.', {
            variant: better ?? '',
            pct: pct ?? 0,
            metric: metricLabel,
          })}{' '}
          <span className="faint">{t('Deja que acumule más datos.')}</span>
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() => onPick(verdict.winner ?? 'empate')}
          data-testid="ab-save-winner"
        >
          {verdict.winner
            ? t('Apuntar {variant} como ganador', { variant: verdict.winner.toUpperCase() })
            : t('Apuntar «sin diferencia clara»')}
        </button>
      </div>
    </div>
  )
}

function VariantAds({
  label,
  ads,
  selected,
  onChange,
}: {
  label: string
  ads: { id: string; name: string; accountName: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [text, setText] = useState('')
  const hits = useQuery({
    queryKey: ['data', 'meta', 'ad-search', text],
    queryFn: () => call('meta:searchAds', { text }),
    enabled: text.trim().length >= 2,
  })
  const names = new Map(ads.map((a) => [a.id, a]))
  return (
    <div className="ab-variant">
      <h4 className="ab-variant-title">{label}</h4>
      <ul className="linked-ads">
        {selected.map((id) => (
          <li key={id}>
            <span className="linked-ad-name">
              <strong>{names.get(id)?.name ?? id}</strong>
              <span className="faint">{names.get(id)?.accountName}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Quitar {title}', { title: names.get(id)?.name ?? id })}
              onClick={() => onChange(selected.filter((x) => x !== id))}
            >
              ×
            </button>
          </li>
        ))}
        {selected.length === 0 && <li className="faint">{t('Ningún anuncio.')}</li>}
      </ul>
      <input
        className="input"
        placeholder={t('Buscar un anuncio…')}
        aria-label={t('Buscar un anuncio para {variant}', { variant: label })}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim().length >= 2 && (
        <ul className="ad-hits">
          {(hits.data ?? [])
            .filter((h) => !selected.includes(h.id))
            .map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    onChange([...selected, h.id])
                    setText('')
                  }}
                >
                  + {h.name}
                </button>
                <span className="faint">
                  {' '}
                  {h.accountName}
                  {h.campaignName && ` · ${h.campaignName}`}
                </span>
              </li>
            ))}
          {hits.data?.length === 0 && <li className="faint">{t('Sin resultados.')}</li>}
        </ul>
      )}
    </div>
  )
}
