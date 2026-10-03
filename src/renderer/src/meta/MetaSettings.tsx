import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { SYNC_INTERVALS, type MetaSettings, type MetaStatus } from '@shared/meta'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { MetricsSettings } from './MetricsSettings'

const INTERVAL_LABELS: Record<number, string> = {
  30: 'Cada 30 minutos',
  60: 'Cada hora',
  120: 'Cada 2 horas',
  240: 'Cada 4 horas',
}

export function MetaSettingsPanel({ status }: { status: MetaStatus }) {
  const toast = useToast()
  const qc = useQueryClient()
  const s = status.settings
  const [newCurrency, setNewCurrency] = useState('')
  // Cada cambio parte de los ajustes más recientes (dos cambios seguidos no se pisan).
  const save = (patch: Partial<MetaSettings>) => {
    const key = ['data', 'meta', 'status']
    const latest = qc.getQueryData<MetaStatus>(key) ?? status
    const next = { ...latest.settings, ...patch }
    void qc.cancelQueries({ queryKey: key })
    qc.setQueryData<MetaStatus>(key, { ...latest, settings: next })
    void call('meta:setSettings', next)
      .then((st) => qc.setQueryData(key, st))
      .catch((e: unknown) => {
        void qc.invalidateQueries({ queryKey: key })
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo guardar.', 'error')
      })
  }
  const code = newCurrency.trim().toUpperCase()
  return (
    <div className="meta-settings" data-testid="meta-settings">
      <div className="field-row">
        <div className="field">
          <label htmlFor="meta-interval">Sincronizar con la app abierta</label>
          <select
            id="meta-interval"
            className="input"
            value={s.intervalMinutes}
            onChange={(e) => save({ intervalMinutes: Number(e.target.value) })}
          >
            {SYNC_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {INTERVAL_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="meta-window">Ventana de atribución</label>
          <select
            id="meta-window"
            className="input"
            value={s.attributionDays}
            onChange={(e) => save({ attributionDays: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 1 ? '1 día' : `${d} días`}
              </option>
            ))}
          </select>
          <p className="hint">
            Meta sigue atribuyendo conversiones a días pasados: en cada sincronización se vuelven a
            descargar estos últimos días.
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor="meta-currency">Moneda en la que ver los importes</label>
        <select
          id="meta-currency"
          className="input"
          value={s.displayCurrency}
          onChange={(e) => save({ displayCurrency: e.target.value })}
        >
          {s.currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="hint">
          Se convierte con el tipo de referencia del Banco Central Europeo de cada día (sin coste).
          Las fechas de las métricas son las de la zona horaria de cada cuenta, como en Ads Manager.
        </p>
      </div>
      <div className="field">
        <label>Monedas disponibles</label>
        <div className="chips chips-edit">
          {s.currencies.map((c) => (
            <span key={c} className="chip">
              {c}
              {c !== s.displayCurrency && s.currencies.length > 1 && (
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Quitar ${c}`}
                  onClick={() => save({ currencies: s.currencies.filter((x) => x !== c) })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="inline-add">
          <input
            className="input mono"
            placeholder="Código ISO (p. ej. COP)"
            maxLength={3}
            value={newCurrency}
            aria-label="Añadir moneda"
            onChange={(e) => setNewCurrency(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={!/^[A-Z]{3}$/.test(code) || s.currencies.includes(code)}
            onClick={() => {
              save({ currencies: [...s.currencies, code] })
              setNewCurrency('')
            }}
          >
            Añadir
          </button>
        </div>
      </div>
      <MetricsSettings />
    </div>
  )
}
