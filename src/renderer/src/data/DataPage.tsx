import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BriefTemplate } from '@shared/data/brief-templates'
import { useCallback, useMemo, useState } from 'react'
import { VIEW_KIND_LABELS, VIEW_KINDS, type View, type ViewKind } from '@shared/data/views'
import { call, IpcCallError } from '../lib/ipc'
import { Popover } from '../ui/Popover'
import { useToast } from '../ui/Toast'
import { useRecordActions } from './actions'
import { viewColumns } from './columns'
import { SectionSettings } from './SectionSettings'
import { useEntity, useFields, useRecords, useSaveView, useViews } from './hooks'
import { FieldDialog } from './FieldsSettings'
import { RecordPanel } from './RecordPanel'
import { useTimeZone } from './nav'
import { todayIn } from '@shared/data/dates'
import { NameDialog } from '../ui/NameDialog'
import type { FieldDef } from '@shared/data/fields'
import { CardFieldsMenu, ColumnsMenu, FieldPicker, FilterMenu, SortMenu } from './ViewToolbar'
import { CalendarView } from './views/CalendarView'
import { GalleryView, ListView } from './views/Cards'
import { KanbanView } from './views/KanbanView'
import { TableView } from './views/TableView'

const EMPTY = new Set<string>()

/**
 * Página de una entidad (de momento, Notas): pestañas de vistas guardadas,
 * barra de filtros y orden, la vista elegida y el panel de la ficha.
 */
export function DataPage({
  entity,
  num,
  openRecordId,
  onOpenRecord,
}: {
  entity: string
  num: string
  openRecordId: string | null
  onOpenRecord: (id: string | null) => void
}) {
  const def = useEntity(entity)!
  const [settingsOpen, setSettingsOpen] = useState(false)
  const fields = useFields(entity)
  const views = useViews(entity)
  const saveView = useSaveView(entity)
  const qc = useQueryClient()
  const toast = useToast()
  const { create, trash } = useRecordActions()
  const tz = useTimeZone()
  const [viewId, setViewId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<FieldDef | null>(null)
  const [naming, setNaming] = useState(false)
  // La selección es de una vista: al cambiar de vista se vacía.
  const [selection, setSelection] = useState<{ viewId: string | null; ids: Set<string> }>({
    viewId: null,
    ids: new Set(),
  })

  const view: View | undefined =
    views.data?.find((v) => v.id === viewId) ?? views.data?.[0] ?? undefined
  const records = useRecords(entity, {
    filters: view?.config.filters ?? [],
    match: view?.config.match ?? 'all',
    sorts: view?.config.sorts ?? [],
  })

  const selected = selection.viewId === view?.id ? selection.ids : EMPTY
  const setSelected = (ids: Set<string>) => setSelection({ viewId: view?.id ?? null, ids })

  const allFields = useMemo(() => fields.data ?? [], [fields.data])
  const byId = useMemo(() => new Map(allFields.map((f) => [f.id, f])), [allFields])
  const titleId = allFields.find((f) => f.key === def.titleKey && f.system)?.id ?? null
  const rows = records.data ?? []

  const save = useCallback(
    (config: Partial<View['config']>) => {
      if (!view) return
      saveView(view.id, { config }).catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo guardar la vista.', 'error'),
      )
    },
    [view, saveView, toast],
  )

  /** Valores que impone la vista (crear en «Swipe file» ya marca «Referencia»). */
  const viewDefaults = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    if (!view || view.config.match !== 'all') return out
    for (const f of view.config.filters) {
      const field = byId.get(f.fieldId)
      if (!field) continue
      if (f.op === 'is_true') out[f.fieldId] = true
      else if (f.op === 'today' && field.type === 'date') out[f.fieldId] = todayIn(tz)
      else if (
        f.op === 'any_of' &&
        Array.isArray(f.value) &&
        f.value.length === 1 &&
        (field.type === 'select' || field.type === 'multiselect')
      )
        out[f.fieldId] = field.type === 'select' ? f.value[0] : [f.value[0]]
    }
    return out
  }

  const newRecord = async (values: Record<string, unknown> = {}) => {
    const r = await create(entity, { ...viewDefaults(), ...values })
    if (r) onOpenRecord(r.id)
  }

  const addView = async (kind: ViewKind) => {
    try {
      const v = await call('data:createView', {
        entity,
        name: VIEW_KIND_LABELS[kind],
        kind,
      })
      await qc.invalidateQueries({ queryKey: ['data', 'views', entity] })
      setViewId(v.id)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : 'No se pudo crear la vista.', 'error')
    }
  }

  const addPipeline = async (name: string) => {
    try {
      const field = await call('data:createField', {
        entity,
        label: name,
        type: 'select',
        config: {
          pipeline: true,
          options: [
            { id: 'nuevo', label: 'Nuevo', color: 'gris' },
            { id: 'en-curso', label: 'En curso', color: 'azul' },
            { id: 'ganado', label: 'Ganado', color: 'verde' },
            { id: 'perdido', label: 'Perdido', color: 'vino' },
          ],
        },
      })
      const v = await call('data:createView', { entity, name, kind: 'kanban' })
      await call('data:updateView', { id: v.id, config: { groupBy: field.id } })
      await qc.invalidateQueries({ queryKey: ['data'] })
      setViewId(v.id)
      setEditingField(field)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : 'No se pudo crear el pipeline.', 'error')
    }
  }

  const exportCsv = async () => {
    if (!view) return
    try {
      const path = await call('data:exportCsv', { viewId: view.id })
      if (path) toast.show(`Exportado: ${path}`)
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : 'No se pudo exportar.', 'error')
    }
  }

  if (!view || !fields.data) return <div className="page" aria-busy="true" />

  const columns = viewColumns(allFields, view, titleId)
  const cardFields = view.config.cardFields.map((id) => byId.get(id)).filter((f) => !!f)
  const selectFields = allFields.filter((f) => f.type === 'select')
  const hasPipelines = selectFields.some((f) => f.config['pipeline'] === true)
  const dateFields = allFields.filter((f) => f.type === 'date' || f.type === 'datetime')
  const article = def.gender === 'f' ? 'Nueva' : 'Nuevo'

  return (
    <div className="data-page" data-testid={`page-${entity}`}>
      <div className="data-main">
        <div className="data-head">
          <div className="section-head">
            <span className="eyebrow">
              <span className="num">{num}</span> {def.label.toLowerCase()}
            </span>
            <h1 className="title">{def.label}</h1>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setSettingsOpen(true)}
              title={`Campos${entity === 'brief' ? ' y plantillas' : ''} de ${def.label}`}
              data-testid="open-section-settings"
            >
              ⚙ Ajustes
            </button>
            {entity === 'brief' && (
              <TemplatePicker
                onPick={(t) =>
                  void call('briefs:createFromTemplate', {
                    templateId: t.id,
                    values: viewDefaults(),
                  })
                    .then((r) => onOpenRecord(r.id))
                    .catch((e: unknown) =>
                      toast.show(
                        e instanceof IpcCallError ? e.message : 'No se pudo crear el brief.',
                        'error',
                      ),
                    )
                }
              />
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void newRecord()}
              data-testid="new-record"
            >
              + {article} {def.singular}
            </button>
          </div>
        </div>

        <div className="view-tabs" role="tablist" aria-label="Vistas">
          {views.data!.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              onClick={() => setViewId(v.id)}
              data-testid="view-tab"
            >
              <span className="view-kind">{VIEW_KIND_LABELS[v.kind].slice(0, 1)}</span>
              {v.name}
            </button>
          ))}
          <Popover label="Nueva vista" className="view-add" button="+ Vista" testId="add-view">
            {(close) => (
              <ul className="menu">
                {VIEW_KINDS.map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close()
                        void addView(k)
                      }}
                    >
                      {VIEW_KIND_LABELS[k]}
                    </button>
                  </li>
                ))}
                {hasPipelines && (
                  <li>
                    <button
                      type="button"
                      className="menu-item menu-create"
                      onClick={() => {
                        close()
                        setNaming(true)
                      }}
                    >
                      + Pipeline nuevo…
                    </button>
                  </li>
                )}
              </ul>
            )}
          </Popover>
        </div>

        <div className="view-toolbar">
          <FilterMenu key={`f-${view.id}`} view={view} fields={allFields} onSave={save} />
          <SortMenu view={view} fields={allFields} onSave={save} />
          {view.kind === 'table' && (
            <ColumnsMenu columns={columns} titleId={titleId} onSave={save} />
          )}
          {view.kind === 'kanban' && (
            <FieldPicker
              label="Agrupar por"
              value={view.config.groupBy}
              fields={selectFields}
              onChange={(groupBy) => save({ groupBy })}
            />
          )}
          {view.kind === 'kanban' && view.config.groupBy && byId.get(view.config.groupBy) && (
            <button
              type="button"
              className="btn"
              data-testid="edit-stages"
              onClick={() => setEditingField(byId.get(view.config.groupBy!)!)}
            >
              Editar etapas
            </button>
          )}
          {view.kind === 'calendar' && (
            <FieldPicker
              label="Campo de fecha"
              value={view.config.dateField}
              fields={dateFields}
              onChange={(dateField) => save({ dateField })}
            />
          )}
          {view.kind !== 'table' && view.kind !== 'calendar' && (
            <CardFieldsMenu view={view} fields={allFields} onSave={save} />
          )}
          <span className="toolbar-spacer" />
          <span className="faint num" data-testid="record-count">
            {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
          </span>
          <ViewMenu view={view} canDelete={views.data!.length > 1} entity={entity} />
          <button type="button" className="btn" onClick={() => void exportCsv()}>
            Exportar CSV
          </button>
        </div>

        {selected.size > 0 && (
          <div className="bulk-bar" role="status">
            <span>
              {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
            </span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void trash([...selected])
                setSelected(new Set())
              }}
            >
              Enviar a la papelera
            </button>
            <button type="button" className="btn-link" onClick={() => setSelected(new Set())}>
              Quitar selección
            </button>
          </div>
        )}

        <div className="view-body" data-kind={view.kind}>
          {rows.length === 0 && view.kind !== 'calendar' && view.kind !== 'kanban' ? (
            <div className="empty">
              <h2>
                {view.config.filters.length ? 'Nada coincide' : `Sin ${def.label.toLowerCase()}`}
              </h2>
              <p className="muted">
                {view.config.filters.length
                  ? 'Ningún registro cumple los filtros de esta vista.'
                  : `Crea la primera con «+ ${article} ${def.singular}».`}
              </p>
            </div>
          ) : view.kind === 'table' ? (
            <TableView
              columns={columns}
              rows={rows}
              onOpen={onOpenRecord}
              selected={selected}
              onSelect={setSelected}
              onResize={(fieldId, width) =>
                save({
                  columns: columns.map((c) => ({
                    fieldId: c.field.id,
                    width: c.field.id === fieldId ? width : c.width,
                    visible: c.visible,
                  })),
                })
              }
            />
          ) : view.kind === 'list' ? (
            <ListView
              rows={rows}
              cardFields={cardFields}
              allFields={allFields}
              onOpen={onOpenRecord}
            />
          ) : view.kind === 'gallery' ? (
            <GalleryView
              rows={rows}
              cardFields={cardFields}
              allFields={allFields}
              onOpen={onOpenRecord}
            />
          ) : view.kind === 'kanban' ? (
            <KanbanView
              rows={rows}
              groupField={view.config.groupBy ? byId.get(view.config.groupBy) : undefined}
              cardFields={cardFields}
              onOpen={onOpenRecord}
              onCreate={(values) => void newRecord(values)}
            />
          ) : (
            <CalendarView
              rows={rows}
              dateField={view.config.dateField ? byId.get(view.config.dateField) : undefined}
              onOpen={onOpenRecord}
              onCreate={(values) => void newRecord(values)}
            />
          )}
        </div>
      </div>

      {editingField && (
        <FieldDialog
          entity={entity}
          field={editingField}
          fields={allFields}
          onClose={() => setEditingField(null)}
        />
      )}
      {naming && (
        <NameDialog
          title="Pipeline nuevo"
          label="Nombre del pipeline"
          placeholder="Ventas, Reclutamiento…"
          onCancel={() => setNaming(false)}
          onSubmit={(name) => {
            setNaming(false)
            void addPipeline(name)
          }}
        />
      )}
      {settingsOpen && <SectionSettings entity={def} onClose={() => setSettingsOpen(false)} />}
      {openRecordId && (
        <RecordPanel
          key={openRecordId}
          id={openRecordId}
          fields={allFields}
          onClose={() => onOpenRecord(null)}
          onOpen={onOpenRecord}
        />
      )}
    </div>
  )
}

function TemplatePicker({ onPick }: { onPick: (t: BriefTemplate) => void }) {
  const templates = useQuery({
    queryKey: ['data', 'brief-templates'],
    queryFn: () => call('briefs:templates'),
  })
  return (
    <Popover
      label="Nuevo desde plantilla"
      button="Desde plantilla ▾"
      align="end"
      testId="from-template"
    >
      {(close) => (
        <ul className="menu">
          {(templates.data ?? []).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close()
                  onPick(t)
                }}
              >
                {t.name}
              </button>
            </li>
          ))}
          {templates.data?.length === 0 && (
            <li className="faint menu-empty">Crea plantillas en «⚙ Ajustes» de esta sección.</li>
          )}
        </ul>
      )}
    </Popover>
  )
}

function ViewMenu({ view, canDelete, entity }: { view: View; canDelete: boolean; entity: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const saveView = useSaveView(entity)
  const [name, setName] = useState(view.name)
  const [prev, setPrev] = useState(view.name)
  if (prev !== view.name) {
    setPrev(view.name)
    setName(view.name)
  }
  return (
    <Popover label="Opciones de la vista" button="Vista ▾" align="end">
      {(close) => (
        <div className="menu">
          <form
            className="menu-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void saveView(view.id, { name: name.trim() })
              close()
            }}
          >
            <input
              className="input"
              aria-label="Nombre de la vista"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn">
              Renombrar
            </button>
          </form>
          <button
            type="button"
            className="menu-item menu-danger"
            disabled={!canDelete}
            onClick={() => {
              close()
              void call('data:deleteView', { id: view.id })
                .then(() => qc.invalidateQueries({ queryKey: ['data', 'views', entity] }))
                .catch((e: unknown) =>
                  toast.show(e instanceof IpcCallError ? e.message : 'No se pudo borrar.', 'error'),
                )
            }}
          >
            Eliminar esta vista
          </button>
        </div>
      )}
    </Popover>
  )
}
