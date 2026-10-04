import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { shiftDate, todayIn } from '@shared/data/dates'
import { t } from '@shared/i18n'
import { computeMetrics, DEFAULT_HOLD_RATE } from '@shared/meta-metrics'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { fileUrl } from '../data/files'
import { useTimeZone } from '../data/nav'
import { DELIVERY_LABELS, deliveryTone } from './meta'
import { columnLabel, formatMetric, metricDefs, useActionTypes, useTableSettings } from './metrics'

const KPIS = ['gasto', 'compras', 'roas', 'cpa', 'ctr_enlace', 'hook_rate', 'hold_rate']

/**
 * Anuncios de Meta vinculados a una creatividad y su rendimiento (SPEC §7.8). Se
 * vinculan a mano (buscar y elegir) o solos por código o convención de nombres.
 */
export function CreativeAds({ recordId }: { recordId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tz = useTimeZone()
  const status = useQuery({
    queryKey: ['data', 'meta', 'status'],
    queryFn: () => call('meta:status'),
  })
  const links = useQuery({
    queryKey: ['data', 'meta', 'links', recordId],
    queryFn: () => call('meta:creativeLinks', { recordId }),
  })
  const [days, setDays] = useState(30)
  const until = todayIn(tz)
  const since = shiftDate(until, -(days - 1))
  const perf = useQuery({
    queryKey: ['data', 'meta', 'creative-perf', recordId, since, until],
    queryFn: () => call('meta:creativePerf', { recordId, since, until }),
    enabled: (links.data?.length ?? 0) > 0,
  })
  const [text, setText] = useState('')
  const hits = useQuery({
    queryKey: ['data', 'meta', 'ad-search', text],
    queryFn: () => call('meta:searchAds', { text }),
    enabled: text.trim().length >= 2,
  })
  const settings = useTableSettings()
  const actionTypes = useActionTypes()
  const defs = useMemo(
    () => metricDefs(settings.data?.metrics ?? [], actionTypes.data ?? []),
    [settings.data?.metrics, actionTypes.data],
  )
  if (!status.data?.connected && !links.data?.length) return null

  const setLink = (adId: string, linked: boolean) =>
    void call('meta:setCreativeLink', { recordId, adId, linked })
      .then((list) => {
        qc.setQueryData(['data', 'meta', 'links', recordId], list)
        setText('')
        return qc.invalidateQueries({ queryKey: ['data', 'meta', 'creative-perf', recordId] })
      })
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : t('No se pudo vincular.'), 'error'),
      )
  const linked = new Set((links.data ?? []).map((l) => l.id))
  const values = perf.data
    ? computeMetrics(perf.data.base, null, {
        custom: settings.data?.metrics ?? [],
        holdRate: settings.data?.holdRate ?? DEFAULT_HOLD_RATE,
        actionTypes: actionTypes.data ?? [],
      })
    : null

  return (
    <section className="panel-rich" data-testid="creative-ads">
      <h3 className="panel-subtitle">{t('Anuncios de Meta')}</h3>
      {values && perf.data && (
        <>
          <div className="field-row">
            <select
              className="input"
              aria-label={t('Periodo del rendimiento')}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {[7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  {t('Últimos {n} días', { n: d })}
                </option>
              ))}
            </select>
          </div>
          <dl className="mini-kpis" data-testid="creative-kpis">
            {KPIS.map((k) => (
              <div key={k}>
                <dt>{columnLabel(k, defs)}</dt>
                <dd className="num">{formatMetric(values[k], defs.get(k), perf.data.currency)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <ul className="linked-ads">
        {(links.data ?? []).map((l) => (
          <li key={l.id}>
            {l.thumbFileId ? (
              <img className="meta-thumb" src={fileUrl(l.thumbFileId)} alt="" />
            ) : (
              <span className="meta-thumb" aria-hidden="true" />
            )}
            <span className="linked-ad-name">
              {l.previewUrl ? (
                <a
                  href={l.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={t('Ver el anuncio en Meta')}
                >
                  <strong>{l.name}</strong>
                </a>
              ) : (
                <strong>{l.name}</strong>
              )}
              <span className="faint">
                {l.accountName}
                {l.campaignName && ` · ${l.campaignName}`}
                {l.source === 'auto' && t(' · vinculado solo')}
              </span>
            </span>
            {l.effectiveStatus && (
              <span className="chip" data-color={deliveryTone(l.effectiveStatus)}>
                {DELIVERY_LABELS[l.effectiveStatus]
                  ? t(DELIVERY_LABELS[l.effectiveStatus]!)
                  : l.effectiveStatus}
              </span>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Desvincular {name}', { name: l.name })}
              onClick={() => setLink(l.id, false)}
            >
              ×
            </button>
          </li>
        ))}
        {links.data?.length === 0 && <li className="faint">{t('Ningún anuncio vinculado.')}</li>}
      </ul>
      <input
        className="input"
        placeholder={t('Buscar un anuncio para vincular…')}
        aria-label={t('Buscar anuncio')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim().length >= 2 && (
        <ul className="ad-hits" data-testid="ad-hits">
          {(hits.data ?? [])
            .filter((h) => !linked.has(h.id))
            .map((h) => (
              <li key={h.id}>
                <button type="button" className="btn-link" onClick={() => setLink(h.id, true)}>
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
    </section>
  )
}
