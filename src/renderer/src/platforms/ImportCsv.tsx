import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import {
  CSV_FIELDS,
  DATE_FORMATS,
  detectTable,
  guessFormats,
  parseAmount,
  parseCsv,
  parseCsvDate,
  PLATFORMS,
  REQUIRED_FIELDS,
  type CsvField,
  type CsvImportResult,
  type CsvMapping,
  type DateFormat,
  type OtherPlatform,
} from '@shared/platforms'
import { call, IpcCallError } from '../lib/ipc'
import { isoToEs } from '../meta/meta'
import { DropZone } from '../tools/kit'
import { usePlatformAccounts } from './platforms'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'MXN', 'CHF']

interface Loaded {
  name: string
  text: string
  rows: string[][]
  headerRow: number
  headers: string[]
}

/** Importar un CSV de LinkedIn Campaign Manager o X Ads con un mapeo que se recuerda. */
export function ImportCsv({ onDone, linkedin }: { onDone: () => void; linkedin: boolean }) {
  const qc = useQueryClient()
  const accounts = usePlatformAccounts().data ?? []
  const [platform, setPlatform] = useState<OtherPlatform>(linkedin ? 'linkedin' : 'x')
  const [file, setFile] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [newName, setNewName] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CsvImportResult | null>(null)

  const load = async (f: File, p: OtherPlatform) => {
    setError(null)
    setResult(null)
    const text = await f.text()
    const rows = parseCsv(text)
    if (rows.length < 2) {
      setError(t('El archivo no parece un CSV con datos.'))
      return
    }
    const table = detectTable(rows)
    setFile({ name: f.name, text, rows, headerRow: table.headerRow, headers: table.headers })
    const saved = await call('platforms:savedMapping', {
      platform: p,
      headers: table.headers,
    }).catch(() => null)
    setRemembered(saved !== null)
    setMapping(
      saved ?? {
        columns: table.columns,
        ...guessFormats(rows.slice(table.headerRow + 1), table.columns),
        conversionsAs: 'compras',
      },
    )
    if (!newName) setNewName(f.name.replace(/\.csv$/i, '').slice(0, 60))
  }

  const own = accounts.filter((a) => a.platform === platform)
  const preview = useMemo(() => {
    if (!file || !mapping) return []
    const c = mapping.columns
    const cell = (r: string[], k: CsvField) => {
      const i = c[k]
      return i === null || i === undefined ? '' : (r[i] ?? '')
    }
    return file.rows.slice(file.headerRow + 1, file.headerRow + 6).map((r) => ({
      date: parseCsvDate(cell(r, 'date'), mapping.dateFormat),
      campaign: cell(r, 'campaign'),
      spend: parseAmount(cell(r, 'spend'), mapping.decimal),
      impressions: parseAmount(cell(r, 'impressions'), mapping.decimal),
    }))
  }, [file, mapping])
  const missing = mapping
    ? REQUIRED_FIELDS.filter((f) => mapping.columns[f] === null || mapping.columns[f] === undefined)
    : []
  const accountOk = accountId !== '' || newName.trim() !== ''

  const run = async () => {
    if (!file || !mapping) return
    setBusy(true)
    setError(null)
    try {
      const r = await call('platforms:importCsv', {
        input: {
          platform,
          accountId: accountId || null,
          newAccount: accountId
            ? null
            : {
                name: newName.trim(),
                currency,
                timezone: platform === 'linkedin' ? 'UTC' : 'Europe/Madrid',
              },
          text: file.text,
          mapping,
        },
        headers: file.headers,
      })
      setResult(r)
      setFile(null)
      void qc.invalidateQueries({ queryKey: ['data'] })
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido importar.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool import-csv" data-testid="import-csv">
      <div className="field">
        <label htmlFor="imp-platform">{t('Plataforma')}</label>
        <select
          id="imp-platform"
          className="input"
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value as OtherPlatform)
            setAccountId('')
            setFile(null)
          }}
        >
          {linkedin && <option value="linkedin">LinkedIn (Campaign Manager)</option>}
          <option value="x">X (X Ads)</option>
        </select>
        <span className="hint">
          {platform === 'linkedin'
            ? t(
                'En Campaign Manager: Analizar → Exportar → informe de rendimiento de campañas, por día.',
              )
            : t('En X Ads: Exportar → por campaña y por día.')}
        </span>
      </div>
      <DropZone
        accept=".csv,text/csv"
        multiple={false}
        hint={t('Arrastra aquí el CSV exportado.')}
        onFiles={(f) => void load(f[0]!, platform)}
        testId="csv-drop"
        disabled={busy}
      />
      {error && <p className="danger-text">{error}</p>}
      {result && (
        <p className="report-saved" data-testid="import-result">
          <span className="marker" aria-hidden="true" />
          <span>
            {t('Importados {rows} días de {campaigns} campañas, del {since} al {until}', {
              rows: formatNumber(result.rows, 0),
              campaigns: formatNumber(result.campaigns, 0),
              since: isoToEs(result.since),
              until: isoToEs(result.until),
            })}
            {result.skipped
              ? ' ' +
                t('({n} filas sin fecha o de totales)', { n: formatNumber(result.skipped, 0) })
              : ''}
            .{' '}
            <button type="button" className="btn-link" onClick={onDone}>
              {t('Ver cuentas')}
            </button>
          </span>
        </p>
      )}
      {file && mapping && (
        <>
          <p className="muted">
            <strong>{file.name}</strong> ·{' '}
            {t('{n} filas', { n: formatNumber(file.rows.length - file.headerRow - 1, 0) })}
            {remembered && ' · ' + t('mapeo recordado de la última vez')}
          </p>
          <fieldset className="tool-dest">
            <legend>{t('Columnas')}</legend>
            <div className="tool-options mapping-grid">
              {(Object.keys(CSV_FIELDS) as CsvField[]).map((f) => (
                <div key={f} className="field">
                  <label htmlFor={`map-${f}`}>
                    {t(CSV_FIELDS[f])}
                    {REQUIRED_FIELDS.includes(f) ? ' *' : ''}
                  </label>
                  <select
                    id={`map-${f}`}
                    className="input"
                    value={mapping.columns[f] ?? ''}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        columns: {
                          ...mapping.columns,
                          [f]: e.target.value === '' ? null : Number(e.target.value),
                        },
                      })
                    }
                  >
                    <option value="">—</option>
                    {file.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || t('Columna {n}', { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="field">
                <label htmlFor="map-date">{t('Formato de fecha')}</label>
                <select
                  id="map-date"
                  className="input"
                  value={mapping.dateFormat}
                  onChange={(e) =>
                    setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })
                  }
                >
                  {Object.entries(DATE_FORMATS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {t(l)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="map-decimal">{t('Decimales')}</label>
                <select
                  id="map-decimal"
                  className="input"
                  value={mapping.decimal}
                  onChange={(e) => setMapping({ ...mapping, decimal: e.target.value as ',' | '.' })}
                >
                  <option value=",">{t('Coma (1.234,56)')}</option>
                  <option value=".">{t('Punto (1,234.56)')}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="map-conv">{t('Las conversiones son')}</label>
                <select
                  id="map-conv"
                  className="input"
                  value={mapping.conversionsAs}
                  onChange={(e) =>
                    setMapping({ ...mapping, conversionsAs: e.target.value as 'compras' | 'otras' })
                  }
                >
                  <option value="compras">{t('Compras (cuentan en ROAS y CPA)')}</option>
                  <option value="otras">{t('Otras conversiones (leads…)')}</option>
                </select>
              </div>
            </div>
          </fieldset>
          {missing.length > 0 && (
            <p className="danger-text">
              {t('Falta asignar: {fields}.', {
                fields: missing.map((f) => t(CSV_FIELDS[f])).join(', '),
              })}
            </p>
          )}
          <div className="meta-table-scroll">
            <table className="meta-table" data-testid="csv-preview">
              <thead>
                <tr>
                  <th>{t('Fecha')}</th>
                  <th>{t('Campaña')}</th>
                  <th className="num">{t('Importe')}</th>
                  <th className="num">{t('Impresiones')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className={r.date ? 'num' : 'danger-text'}>
                      {r.date ? isoToEs(r.date) : t('sin fecha')}
                    </td>
                    <td>{r.campaign}</td>
                    <td className="num">{r.spend === null ? '—' : formatNumber(r.spend, 2)}</td>
                    <td className="num">
                      {r.impressions === null ? '—' : formatNumber(r.impressions, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset className="tool-dest">
            <legend>{t('Cuenta')}</legend>
            <div className="field">
              <label htmlFor="imp-account">{t('Importar en')}</label>
              <select
                id="imp-account"
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">{t('Una cuenta nueva')}</option>
                {own.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {!accountId && (
              <>
                <div className="field">
                  <label htmlFor="imp-name">{t('Nombre de la cuenta')}</label>
                  <input
                    id="imp-name"
                    className="input"
                    maxLength={120}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="imp-currency">{t('Moneda de los importes')}</label>
                  <select
                    id="imp-currency"
                    className="input"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missing.length > 0 || !accountOk}
              onClick={() => void run()}
            >
              {busy
                ? t('Importando…')
                : t('Importar en {platform}', { platform: PLATFORMS[platform] })}
            </button>
            <span className="faint">
              {t('Si ya habías importado esas fechas, se sustituyen (no se duplican).')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
