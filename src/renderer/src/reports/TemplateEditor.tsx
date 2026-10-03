import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  BLOCK_LABELS,
  DEFAULT_TEMPLATE,
  GROUP_LABELS,
  REPORT_GROUPS,
  type ReportBlock,
  type ReportBlockKind,
  type ReportGroup,
  type ReportTemplate,
} from '@shared/reports'
import type { MetricDef } from '@shared/meta-metrics'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { MetricSelect, useMetricKit } from '../analysis/kit'
import { useReportTemplates } from './hooks'

const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function newBlock(kind: ReportBlockKind): ReportBlock {
  const id = newId('b')
  switch (kind) {
    case 'portada':
      return { id, kind }
    case 'kpis':
      return { id, kind, title: '', metrics: ['gasto', 'compras', 'cpa'], compare: true }
    case 'linea':
      return { id, kind, title: '', metric: 'gasto', compare: true }
    case 'barras':
      return { id, kind, title: '', metric: 'gasto', groupBy: 'campana', limit: 8 }
    case 'tabla':
      return {
        id,
        kind,
        title: '',
        metrics: ['gasto', 'compras', 'cpa'],
        groupBy: 'campana',
        limit: 10,
      }
    case 'comparativa':
      return { id, kind, title: '', metrics: ['gasto', 'compras', 'cpa'], compare: 'previous' }
    case 'texto':
      return { id, kind, title: '', text: '' }
    case 'comentarios':
      return { id, kind, title: 'Comentarios' }
  }
}

/** Plantillas de informe: bloques en orden, cada uno con sus opciones. */
export function TemplateEditor() {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = useReportTemplates().data
  const [draft, setDraft] = useState<ReportTemplate[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [saving, setSaving] = useState(false)
  const list = draft ?? saved ?? []
  const tpl = list[Math.min(selected, list.length - 1)]
  const dirty = draft !== null

  const update = (next: ReportTemplate) =>
    setDraft(list.map((x, i) => (i === Math.min(selected, list.length - 1) ? next : x)))
  const setBlocks = (blocks: ReportBlock[]) => tpl && update({ ...tpl, blocks })

  const save = async () => {
    setSaving(true)
    try {
      const r = await call('reports:setTemplates', { templates: list })
      qc.setQueryData(['data', 'reports', 'templates'], r)
      setDraft(null)
      toast.show(t('Plantillas guardadas.'))
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : t('No se han podido guardar.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!tpl) return null
  return (
    <div className="template-editor" data-testid="template-editor">
      <div className="template-bar">
        <div className="field">
          <label htmlFor="tpl-select">{t('Plantilla')}</label>
          <select
            id="tpl-select"
            className="input"
            value={Math.min(selected, list.length - 1)}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {list.map((x, i) => (
              <option key={x.id} value={i}>
                {t(x.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tpl-name">{t('Nombre')}</label>
          <input
            id="tpl-name"
            className="input"
            maxLength={80}
            value={tpl.name}
            onChange={(e) => update({ ...tpl, name: e.target.value })}
          />
        </div>
        <span className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft([...list, { ...tpl, id: newId('p'), name: t('{name} (copia)', { name: tpl.name }) }])
              setSelected(list.length)
            }}
          >
            {t('Duplicar')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft([...list, { ...DEFAULT_TEMPLATE, id: newId('p'), name: t('Nueva plantilla') }])
              setSelected(list.length)
            }}
          >
            {t('+ Plantilla')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={list.length <= 1}
            onClick={() => {
              setDraft(list.filter((x) => x.id !== tpl.id))
              setSelected(0)
            }}
          >
            {t('Eliminar')}
          </button>
        </span>
      </div>

      <ol className="block-list">
        {tpl.blocks.map((b, i) => (
          <li key={b.id} className="block-item" data-testid="report-block">
            <div className="block-head">
              <span className="block-kind">{t(BLOCK_LABELS[b.kind])}</span>
              <span className="form-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Subir {block}', { block: t(BLOCK_LABELS[b.kind]) })}
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...tpl.blocks]
                    next.splice(i - 1, 0, next.splice(i, 1)[0]!)
                    setBlocks(next)
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Bajar {block}', { block: t(BLOCK_LABELS[b.kind]) })}
                  disabled={i === tpl.blocks.length - 1}
                  onClick={() => {
                    const next = [...tpl.blocks]
                    next.splice(i + 1, 0, next.splice(i, 1)[0]!)
                    setBlocks(next)
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Quitar {title}', { title: t(BLOCK_LABELS[b.kind]) })}
                  disabled={tpl.blocks.length <= 1}
                  onClick={() => setBlocks(tpl.blocks.filter((x) => x.id !== b.id))}
                >
                  ×
                </button>
              </span>
            </div>
            <BlockOptions
              block={b}
              onChange={(nb) => setBlocks(tpl.blocks.map((x) => (x.id === b.id ? nb : x)))}
            />
          </li>
        ))}
      </ol>

      <div className="form-actions">
        <AddBlock onAdd={(kind) => setBlocks([...tpl.blocks, newBlock(kind)])} />
      </div>
      <div className="form-actions template-save">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving || list.some((x) => !x.name.trim())}
          onClick={() => void save()}
        >
          {t('Guardar plantillas')}
        </button>
        {dirty && (
          <button type="button" className="btn" onClick={() => setDraft(null)}>
            {t('Descartar cambios')}
          </button>
        )}
      </div>
    </div>
  )
}

function AddBlock({ onAdd }: { onAdd: (k: ReportBlockKind) => void }) {
  const [kind, setKind] = useState<ReportBlockKind>('kpis')
  return (
    <>
      <div className="field">
        <label htmlFor="tpl-add">{t('Añadir bloque')}</label>
        <select
          id="tpl-add"
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as ReportBlockKind)}
        >
          {Object.entries(BLOCK_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn" onClick={() => onAdd(kind)}>
        {t('+ Bloque')}
      </button>
    </>
  )
}

function BlockOptions({
  block: b,
  onChange,
}: {
  block: ReportBlock
  onChange: (b: ReportBlock) => void
}) {
  const { defs } = useMetricKit()
  if (b.kind === 'portada')
    return (
      <p className="hint">{t('Cliente, periodo, moneda y tu nombre o empresa (del perfil).')}</p>
    )
  const title = (
    <div className="field">
      <label htmlFor={`${b.id}-title`}>{t('Título')}</label>
      <input
        id={`${b.id}-title`}
        className="input"
        maxLength={120}
        placeholder={t(BLOCK_LABELS[b.kind])}
        value={b.title}
        onChange={(e) => onChange({ ...b, title: e.target.value })}
      />
    </div>
  )
  const group = (value: ReportGroup, set: (g: ReportGroup) => void) => (
    <div className="field">
      <label htmlFor={`${b.id}-group`}>{t('Por')}</label>
      <select
        id={`${b.id}-group`}
        className="input"
        value={value}
        onChange={(e) => set(e.target.value as ReportGroup)}
      >
        {REPORT_GROUPS.map((g) => (
          <option key={g} value={g}>
            {t(GROUP_LABELS[g])}
          </option>
        ))}
      </select>
    </div>
  )
  const limit = (value: number, max: number, set: (n: number) => void) => (
    <div className="field">
      <label htmlFor={`${b.id}-limit`}>{t('Filas')}</label>
      <input
        id={`${b.id}-limit`}
        className="input"
        type="number"
        min={2}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= 2 && n <= max) set(n)
        }}
      />
    </div>
  )
  switch (b.kind) {
    case 'kpis':
      return (
        <div className="block-options">
          {title}
          <MetricList
            id={b.id}
            defs={defs}
            value={b.metrics}
            max={8}
            onChange={(metrics) => onChange({ ...b, metrics })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={b.compare}
              onChange={(e) => onChange({ ...b, compare: e.target.checked })}
            />
            <span>{t('Variación frente al periodo anterior')}</span>
          </label>
        </div>
      )
    case 'linea':
      return (
        <div className="block-options">
          {title}
          <MetricSelect
            id={`${b.id}-metric`}
            value={b.metric}
            defs={defs}
            onChange={(metric) => onChange({ ...b, metric })}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={b.compare}
              onChange={(e) => onChange({ ...b, compare: e.target.checked })}
            />
            <span>{t('Con el periodo anterior')}</span>
          </label>
        </div>
      )
    case 'barras':
      return (
        <div className="block-options">
          {title}
          <MetricSelect
            id={`${b.id}-metric`}
            value={b.metric}
            defs={defs}
            onChange={(metric) => onChange({ ...b, metric })}
          />
          {group(b.groupBy, (groupBy) => onChange({ ...b, groupBy }))}
          {limit(b.limit, 15, (n) => onChange({ ...b, limit: n }))}
        </div>
      )
    case 'tabla':
      return (
        <div className="block-options">
          {title}
          <MetricList
            id={b.id}
            defs={defs}
            value={b.metrics}
            max={8}
            onChange={(metrics) => onChange({ ...b, metrics })}
          />
          {group(b.groupBy, (groupBy) => onChange({ ...b, groupBy }))}
          {limit(b.limit, 30, (n) => onChange({ ...b, limit: n }))}
        </div>
      )
    case 'comparativa':
      return (
        <div className="block-options">
          {title}
          <MetricList
            id={b.id}
            defs={defs}
            value={b.metrics}
            max={12}
            onChange={(metrics) => onChange({ ...b, metrics })}
          />
          <div className="field">
            <label htmlFor={`${b.id}-compare`}>{t('Frente a')}</label>
            <select
              id={`${b.id}-compare`}
              className="input"
              value={b.compare}
              onChange={(e) => onChange({ ...b, compare: e.target.value as 'previous' | 'year' })}
            >
              <option value="previous">{t('El periodo anterior')}</option>
              <option value="year">{t('El mismo periodo del año anterior')}</option>
            </select>
          </div>
        </div>
      )
    case 'texto':
      return (
        <div className="block-options">
          {title}
          <div className="field block-text">
            <label htmlFor={`${b.id}-text`}>{t('Texto')}</label>
            <textarea
              id={`${b.id}-text`}
              className="input textarea"
              rows={4}
              maxLength={5000}
              value={b.text}
              onChange={(e) => onChange({ ...b, text: e.target.value })}
            />
          </div>
        </div>
      )
    case 'comentarios':
      return (
        <div className="block-options">
          {title}
          <p className="hint">
            {t('Lo que escribas en «Comentarios del periodo» al generar el informe.')}
          </p>
        </div>
      )
  }
}

function MetricList({
  id,
  defs,
  value,
  max,
  onChange,
}: {
  id: string
  defs: Map<string, MetricDef>
  value: string[]
  max: number
  onChange: (v: string[]) => void
}) {
  const [pick, setPick] = useState('gasto')
  return (
    <div className="metric-list">
      <ul className="chips">
        {value.map((k) => (
          <li key={k} className="chip">
            {defs.get(k)?.label ?? k}
            <button
              type="button"
              className="icon-btn"
              aria-label={t('Quitar {title}', { title: defs.get(k)?.label ?? k })}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((x) => x !== k))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <span className="metric-add">
        <MetricSelect
          id={`${id}-add`}
          label={t('Añadir métrica')}
          value={pick}
          defs={defs}
          onChange={setPick}
        />
        <button
          type="button"
          className="btn"
          disabled={value.includes(pick) || value.length >= max}
          onClick={() => onChange([...value, pick])}
        >
          {t('Añadir')}
        </button>
      </span>
    </div>
  )
}
