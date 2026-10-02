import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, openEncryptedDb, type SqliteDb } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { DataService } from '../../src/main/data/data-service'
import { matchesFilter } from '../../src/main/data/query'
import type { FieldDef } from '../../src/shared/data/fields'
import type { ComputedValue, DataChange, RecordRow } from '../../src/shared/data/records'
import { OPS_BY_TYPE, VALUELESS_OPS, type Filter } from '../../src/shared/data/views'
import { tempDir } from './helpers'

const open: SqliteDb[] = []
afterEach(() => {
  while (open.length) closeDb(open.pop()!)
})

/** 15/06/2026 a las 10:00 en Madrid (08:00 UTC). */
const NOW = new Date('2026-06-15T08:00:00Z')

function setup(opts: { now?: () => Date } = {}) {
  const db = openEncryptedDb(join(tempDir(), 'crm.db'), randomBytes(32))
  open.push(db)
  runMigrations(db, MIGRATIONS)
  const changes: DataChange[] = []
  let now = NOW
  const svc = new DataService(db, {
    timeZone: 'Europe/Madrid',
    now: opts.now ?? (() => now),
    onChange: (c) => changes.push(c),
  })
  const fields = svc.listFields('nota')
  const byKey = (k: string) => fields.find((f) => f.key === k)!
  return {
    db,
    svc,
    changes,
    byKey,
    setNow: (d: Date) => {
      now = d
    },
  }
}

const opt = (f: FieldDef, label: string) =>
  (f.config['options'] as { id: string; label: string }[]).find((o) => o.label === label)!.id

const ids = (rows: RecordRow[]) => rows.map((r) => r.id).sort()

describe('siembra', () => {
  it('crea los campos y vistas de Notas una sola vez', () => {
    const { db, svc } = setup()
    const keys = svc.listFields('nota').map((f) => f.key)
    expect(keys).toEqual(['titulo', 'contenido', 'tipo', 'etiquetas', 'fecha', 'fijada'])
    expect(svc.listViews('nota').map((v) => [v.name, v.kind])).toEqual([
      ['Todas', 'table'],
      ['Por tipo', 'kanban'],
      ['Calendario', 'calendar'],
      ['Tarjetas', 'gallery'],
    ])
    const kanban = svc.listViews('nota')[1]!
    expect(kanban.config.groupBy).toBe(svc.listFields('nota')[2]!.id)
    // Abrir otra vez la bóveda no vuelve a sembrar.
    new DataService(db)
    expect(svc.listFields('nota')).toHaveLength(6)
    expect(svc.listViews('nota')).toHaveLength(4)
  })
})

describe('registros', () => {
  it('crea, edita y guarda el historial', () => {
    const { svc, byKey, changes } = setup()
    const titulo = byKey('titulo')
    const tipo = byKey('tipo')
    const r = svc.create('nota', { [titulo.id]: 'Campaña de verano', [tipo.id]: opt(tipo, 'Idea') })
    expect(r.title).toBe('Campaña de verano')
    expect(changes.at(-1)).toEqual({ entity: 'nota' })

    const r2 = svc.update(r.id, { [tipo.id]: opt(tipo, 'Reunión') })
    expect(r2.values[tipo.id]).toBe(opt(tipo, 'Reunión'))
    const h = svc.history(r.id)
    expect(h.map((x) => x.action)).toEqual(['update', 'create'])
    expect(h[0]!.changes).toEqual([
      { fieldId: tipo.id, label: 'Tipo', from: opt(tipo, 'Idea'), to: opt(tipo, 'Reunión') },
    ])
  })

  it('sin título usa «Sin título» y el título no puede quedar vacío', () => {
    const { svc, byKey } = setup()
    const r = svc.create('nota')
    expect(r.title).toBe('Sin título')
    expect(() => svc.update(r.id, { [byKey('titulo').id]: '' })).toThrow(/no puede quedar vacío/)
  })

  it('rechaza valores que no encajan con el tipo de campo', () => {
    const { svc, byKey } = setup()
    const r = svc.create('nota')
    expect(() => svc.update(r.id, { [byKey('fecha').id]: '15/06/2026' })).toThrow()
    expect(() => svc.update(r.id, { [byKey('tipo').id]: 'no-existe' })).toThrow()
    expect(() => svc.update(r.id, { [byKey('fijada').id]: 'sí' })).toThrow()
    expect(() => svc.update(r.id, { 'campo-inventado': 1 })).toThrow(/no existe/)
  })

  it('el texto largo guarda su versión en texto plano', () => {
    const { svc, byKey } = setup()
    const c = byKey('contenido')
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola mundo' }] }],
    }
    const r = svc.create('nota', { [c.id]: { doc, text: 'esto se ignora' } })
    expect(r.values[c.id]).toEqual({ doc, text: 'Hola mundo' })
  })

  it('duplica un registro con sus valores', () => {
    const { svc, byKey } = setup()
    const f = byKey('fecha')
    const r = svc.create('nota', { [byKey('titulo').id]: 'Brief', [f.id]: '2026-06-20' })
    const d = svc.duplicate(r.id)
    expect(d.id).not.toBe(r.id)
    expect(d.title).toBe('Brief (copia)')
    expect(d.values[f.id]).toBe('2026-06-20')
  })
})

describe('deshacer y rehacer', () => {
  it('deshace y rehace ediciones, creaciones y borrados', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const r = svc.create('nota', { [t.id]: 'Uno' })
    svc.update(r.id, { [t.id]: 'Dos' })
    expect(svc.undoState()).toMatchObject({ canUndo: true, undoLabel: 'Editar «Título»' })

    expect(svc.undo()).toBe('Editar «Título»')
    expect(svc.get(r.id).title).toBe('Uno')
    expect(svc.redo()).toBe('Editar «Título»')
    expect(svc.get(r.id).title).toBe('Dos')

    svc.trash([r.id])
    expect(svc.query('nota')).toHaveLength(0)
    svc.undo()
    expect(svc.query('nota')).toHaveLength(1)

    svc.undo() // la edición
    svc.undo() // la creación
    expect(svc.query('nota')).toHaveLength(0)
    expect(svc.undoState().canUndo).toBe(false)
    svc.redo()
    expect(svc.get(r.id).title).toBe('Uno')
  })

  it('una acción nueva borra lo que se podía rehacer', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const r = svc.create('nota', { [t.id]: 'Uno' })
    svc.update(r.id, { [t.id]: 'Dos' })
    svc.undo()
    svc.update(r.id, { [t.id]: 'Tres' })
    expect(svc.undoState().canRedo).toBe(false)
  })

  it('si el registro ya no existe, avisa y vacía la pila', () => {
    const { svc, byKey } = setup()
    const r = svc.create('nota')
    svc.update(r.id, { [byKey('titulo').id]: 'Algo' })
    svc.trash([r.id])
    svc.purge([r.id])
    expect(() => svc.undo()).toThrow(/No se pudo deshacer/)
    expect(svc.undoState().canUndo).toBe(false)
  })
})

describe('papelera', () => {
  it('restaura y borra para siempre', () => {
    const { svc } = setup()
    const a = svc.create('nota')
    const b = svc.create('nota')
    svc.trash([a.id, b.id])
    expect(svc.listTrash().map((t) => t.daysLeft)).toEqual([30, 30])
    svc.restore([a.id])
    expect(ids(svc.query('nota'))).toEqual([a.id])
    svc.purge([b.id])
    expect(svc.listTrash()).toHaveLength(0)
    expect(() => svc.get(b.id)).toThrow()
  })

  it('vacía lo que lleva más días de los configurados', () => {
    const { svc, setNow } = setup()
    const a = svc.create('nota')
    svc.trash([a.id])
    setNow(new Date(NOW.getTime() + 10 * 86_400_000))
    expect(svc.listTrash()[0]!.daysLeft).toBe(20)
    svc.setTrashDays(7)
    expect(svc.listTrash()).toHaveLength(0)
    expect(svc.trashDays()).toBe(7)
  })
})

describe('búsqueda', () => {
  it('encuentra sin importar tildes ni mayúsculas, y por prefijo', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const c = byKey('contenido')
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revisar la creatividad' }] }],
    }
    const a = svc.create('nota', { [t.id]: 'Campaña de Navidad', [c.id]: { doc, text: '' } })
    svc.create('nota', { [t.id]: 'Otra cosa' })
    expect(svc.search('campana').map((h) => h.id)).toEqual([a.id])
    expect(svc.search('CAMPAÑA nav').map((h) => h.id)).toEqual([a.id])
    expect(svc.search('creativ')[0]).toMatchObject({ id: a.id, title: 'Campaña de Navidad' })
    expect(svc.search('"; DROP TABLE records; --')).toEqual([])
    svc.trash([a.id])
    expect(svc.search('campana')).toEqual([])
    svc.undo()
    expect(svc.search('campana')).toHaveLength(1)
  })

  it('busca también por la etiqueta de las opciones', () => {
    const { svc, byKey } = setup()
    const tipo = byKey('tipo')
    const a = svc.create('nota', { [tipo.id]: opt(tipo, 'Reunión') })
    expect(svc.search('reunion').map((h) => h.id)).toEqual([a.id])
  })
})

describe('campos', () => {
  it('crea, renombra, elimina y restaura campos sin perder valores', () => {
    const { svc } = setup()
    const f = svc.createField('nota', { label: 'Presupuesto', type: 'currency' })
    expect(f.key).toBe('presupuesto')
    const r = svc.create('nota', { [f.id]: 1500 })
    svc.updateField(f.id, { label: 'Inversión' })
    expect(svc.getField(f.id).label).toBe('Inversión')
    svc.deleteField(f.id)
    expect(svc.get(r.id).values[f.id]).toBeUndefined()
    svc.restoreField(f.id)
    expect(svc.get(r.id).values[f.id]).toBe(1500)
  })

  it('no deja borrar campos de sistema ni crear campos de archivos todavía', () => {
    const { svc, byKey } = setup()
    expect(() => svc.deleteField(byKey('titulo').id)).toThrow(/sistema/)
    expect(() => svc.createField('nota', { label: 'Adjuntos', type: 'files' })).toThrow(/fase 4/)
  })

  it('genera claves únicas', () => {
    const { svc } = setup()
    expect(svc.createField('nota', { label: 'Tipo', type: 'text' }).key).toBe('tipo_2')
    expect(svc.createField('nota', { label: '¿Año?', type: 'number' }).key).toBe('ano')
  })
})

describe('fórmulas y resúmenes', () => {
  it('calcula fórmulas encadenadas y avisa de errores', () => {
    const { svc } = setup()
    const gasto = svc.createField('nota', { label: 'Gasto', type: 'currency' })
    const valor = svc.createField('nota', { label: 'Valor', type: 'currency' })
    const roas = svc.createField('nota', {
      label: 'ROAS',
      type: 'formula',
      config: { expression: 'SI(gasto > 0; valor / gasto; 0)', format: 'number' },
    })
    const etiqueta = svc.createField('nota', {
      label: 'Etiqueta ROAS',
      type: 'formula',
      config: { expression: 'SI(roas >= 2; "Bueno"; "Flojo")', format: 'text' },
    })
    const a = svc.create('nota', { [gasto.id]: 100, [valor.id]: 300 })
    expect(a.values[roas.id]).toEqual({ value: 3 })
    expect(a.values[etiqueta.id]).toEqual({ value: 'Bueno' })
    const b = svc.create('nota', {})
    expect(b.values[roas.id]).toEqual({ value: 0 })

    const div = svc.createField('nota', {
      label: 'Div',
      type: 'formula',
      config: { expression: 'valor / gasto', format: 'number' },
    })
    expect((svc.get(b.id).values[div.id] as ComputedValue & { error: string }).error).toMatch(
      /cero/,
    )
  })

  it('rechaza referencias circulares y campos que no existen', () => {
    const { svc } = setup()
    const a = svc.createField('nota', {
      label: 'A',
      type: 'formula',
      config: { expression: '1', format: 'number' },
    })
    svc.createField('nota', {
      label: 'B',
      type: 'formula',
      config: { expression: 'a + 1', format: 'number' },
    })
    expect(() =>
      svc.updateField(a.id, { config: { expression: 'b + 1', format: 'number' } }),
    ).toThrow(/circular/)
    expect(() =>
      svc.createField('nota', {
        label: 'C',
        type: 'formula',
        config: { expression: 'inventado * 2', format: 'number' },
      }),
    ).toThrow(/inventado/)
    expect(svc.formulaProblem('nota', 'SI(1')).toMatch(/paréntesis/)
  })

  it('relaciona registros y resume sus valores', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const importe = svc.createField('nota', { label: 'Importe', type: 'number' })
    const rel = svc.createField('nota', {
      label: 'Relacionadas',
      type: 'relation',
      config: { target: 'nota', multiple: true },
    })
    const total = svc.createField('nota', {
      label: 'Total',
      type: 'rollup',
      config: { relationField: rel.id, targetField: importe.id, fn: 'sum' },
    })
    const n = svc.createField('nota', {
      label: 'Cuántas',
      type: 'rollup',
      config: { relationField: rel.id, fn: 'count' },
    })
    const madre = svc.create('nota', { [t.id]: 'Madre' })
    const h1 = svc.create('nota', { [t.id]: 'Hija 1', [importe.id]: 10.5 })
    const h2 = svc.create('nota', { [t.id]: 'Hija 2', [importe.id]: 4 })
    const r = svc.setLinks(rel.id, madre.id, [h1.id, h2.id, madre.id])
    expect(r.values[rel.id]).toEqual([
      { id: h1.id, title: 'Hija 1' },
      { id: h2.id, title: 'Hija 2' },
    ])
    expect(r.values[total.id]).toEqual({ value: 14.5 })
    expect(r.values[n.id]).toEqual({ value: 2 })

    svc.trash([h2.id])
    expect(svc.get(madre.id).values[total.id]).toEqual({ value: 10.5 })
    svc.undo()
    svc.undo() // deshace los vínculos
    expect(svc.get(madre.id).values[rel.id]).toEqual([])

    const single = svc.createField('nota', {
      label: 'Principal',
      type: 'relation',
      config: { target: 'nota', multiple: false },
    })
    expect(() => svc.setLinks(single.id, madre.id, [h1.id, h2.id])).toThrow(/un solo/)
  })
})

describe('filtros', () => {
  /**
   * Garantía central de SPEC §6: el filtro en SQL (campos guardados) y el filtro en
   * JavaScript (campos calculados) dan exactamente el mismo resultado.
   */
  it('SQL y JavaScript coinciden para todos los tipos y operadores', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const c = byKey('contenido')
    const tipo = byKey('tipo')
    const etiq = byKey('etiquetas')
    const fecha = byKey('fecha')
    const fijada = byKey('fijada')
    const num = svc.createField('nota', { label: 'Número', type: 'number' })
    const pct = svc.createField('nota', { label: 'Porcentaje', type: 'percent' })
    const cuando = svc.createField('nota', { label: 'Cuándo', type: 'datetime' })
    const web = svc.createField('nota', { label: 'Web', type: 'url' })
    const idea = opt(tipo, 'Idea')
    const reunion = opt(tipo, 'Reunión')
    const imp = opt(etiq, 'Importante')
    const pend = opt(etiq, 'Pendiente')
    const doc = (text: string) => ({
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      text,
    })

    const samples: Record<string, unknown>[] = [
      {},
      { [t.id]: 'Campaña Navidad', [c.id]: doc('Revisar creatividades'), [tipo.id]: idea },
      { [t.id]: 'campana 50%_off', [num.id]: 0, [pct.id]: 0.15, [fijada.id]: true },
      { [t.id]: 'Ñandú', [num.id]: -3.5, [fecha.id]: '2026-06-15', [etiq.id]: [imp] },
      { [num.id]: 10, [fecha.id]: '2026-06-09', [etiq.id]: [imp, pend], [tipo.id]: reunion },
      { [num.id]: 1e6, [fecha.id]: '2026-06-01', [fijada.id]: false, [web.id]: 'https://a.es' },
      { [fecha.id]: '2026-05-31', [cuando.id]: '2026-06-14T22:30:00.000Z' }, // 15/06 en Madrid
      { [fecha.id]: '2026-07-01', [cuando.id]: '2026-06-14T21:59:00.000Z' }, // 14/06 en Madrid
      { [cuando.id]: '2026-06-01T00:00:00.000Z', [etiq.id]: [pend], [c.id]: doc('') },
    ]
    for (const s of samples) svc.create('nota', s)

    const values: Record<string, unknown[]> = {
      text: ['campaña', 'CAMPANA', '50%', '_', 'nandu', 'x'],
      longtext: ['creativ', 'nada'],
      url: ['a.es', 'https://a.es'],
      number: [0, 10, -3.5, 1e6],
      percent: [0.15, 0.1],
      date: [
        '2026-06-15',
        '2026-06-01',
        ['2026-06-01', '2026-06-15'],
        ['2026-06-15', '2026-06-01'],
      ],
      datetime: ['2026-06-15', '2026-06-14', ['2026-06-01', '2026-06-14']],
      select: [[idea], [idea, reunion]],
      multiselect: [[imp], [imp, pend], [pend]],
    }
    const fields = svc.listFields('nota')
    const all = svc.query('nota')
    expect(all).toHaveLength(samples.length)
    const ctx = { today: '2026-06-15', timeZone: 'Europe/Madrid' }
    let checked = 0
    for (const f of fields) {
      for (const op of OPS_BY_TYPE[f.type]) {
        const vals = VALUELESS_OPS.includes(op) ? [null] : (values[f.type] ?? [])
        for (const value of vals) {
          if (op === 'between' && !Array.isArray(value)) continue
          if (
            op !== 'between' &&
            Array.isArray(value) &&
            !['select', 'multiselect'].includes(f.type)
          )
            continue
          const filter = { fieldId: f.id, op, value } as Filter
          const viaSql = ids(svc.query('nota', { filters: [filter] }))
          const viaJs = ids(all.filter((r) => matchesFilter(f, r.values[f.id], filter, ctx)))
          expect(viaSql, `${f.label} ${op} ${JSON.stringify(value)}`).toEqual(viaJs)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(80)
  })

  it('combina filtros con «todas» y «alguna», incluidos campos calculados', () => {
    const { svc, byKey } = setup()
    const num = svc.createField('nota', { label: 'N', type: 'number' })
    const doble = svc.createField('nota', {
      label: 'Doble',
      type: 'formula',
      config: { expression: 'n * 2', format: 'number' },
    })
    const fijada = byKey('fijada')
    const a = svc.create('nota', { [num.id]: 1, [fijada.id]: true })
    const b = svc.create('nota', { [num.id]: 5 })
    svc.create('nota', { [num.id]: 2 })
    const f1: Filter = { fieldId: doble.id, op: 'gte', value: 10 }
    const f2: Filter = { fieldId: fijada.id, op: 'is_true', value: null }
    expect(ids(svc.query('nota', { filters: [f1, f2], match: 'all' }))).toEqual([])
    expect(ids(svc.query('nota', { filters: [f1, f2], match: 'any' }))).toEqual(ids([a, b]))
    // Un filtro incompleto (sin valor) se ignora.
    expect(
      svc.query('nota', { filters: [{ fieldId: num.id, op: 'gt', value: null }] }),
    ).toHaveLength(3)
  })

  it('ordena en español con los vacíos al final', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const n = svc.createField('nota', { label: 'N', type: 'number' })
    for (const [title, v] of [
      ['Óscar', 2],
      ['nube', null],
      ['Ana', 10],
      ['Ñu', 1],
      ['Zeta', null],
      ['oso', 3],
    ] as const)
      svc.create('nota', { [t.id]: title, ...(v === null ? {} : { [n.id]: v }) })
    const titles = (rows: RecordRow[]) => rows.map((r) => r.title)
    expect(titles(svc.query('nota', { sorts: [{ fieldId: t.id, dir: 'asc' }] }))).toEqual([
      'Ana',
      'nube',
      'Ñu',
      'Óscar',
      'oso',
      'Zeta',
    ])
    const desc = titles(svc.query('nota', { sorts: [{ fieldId: n.id, dir: 'desc' }] }))
    expect(desc.slice(0, 4)).toEqual(['Ana', 'oso', 'Óscar', 'Ñu'])
    expect(desc.slice(4).sort()).toEqual(['Zeta', 'nube'].sort())
  })
})

describe('vistas y exportación', () => {
  it('guarda la configuración y no deja borrar la última vista', () => {
    const { svc, byKey } = setup()
    const v = svc.createView('nota', 'Fijadas', 'list')
    const u = svc.updateView(v.id, {
      config: { filters: [{ fieldId: byKey('fijada').id, op: 'is_true', value: null }] },
    })
    expect(u.config.filters).toHaveLength(1)
    for (const x of svc.listViews('nota').slice(1)) svc.deleteView(x.id)
    expect(() => svc.deleteView(svc.listViews('nota')[0]!.id)).toThrow(/al menos una/)
  })

  it('exporta CSV para Excel en español', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const precio = svc.createField('nota', { label: 'Precio', type: 'currency' })
    const pct = svc.createField('nota', { label: 'Margen', type: 'percent' })
    svc.create('nota', {
      [t.id]: '=HYPERLINK("http://malo")',
      [precio.id]: 1234.56,
      [pct.id]: 0.215,
      [byKey('fecha').id]: '2026-06-15',
      [byKey('fijada').id]: true,
    })
    const view = svc.listViews('nota')[0]!
    const { csv, filename } = svc.exportCsv(view.id)
    expect(filename).toBe('Notas - Todas - 15-06-2026.csv')
    expect(csv.startsWith('﻿')).toBe(true)
    const [head, row] = csv.slice(1).split('\r\n')
    expect(head).toBe('Título;Contenido;Tipo;Etiquetas;Fecha;Fijada;Precio (EUR);Margen (%)')
    expect(row).toBe(`"'=HYPERLINK(""http://malo"")";;;;15/06/2026;Sí;1234,56;21,5`)
  })
})

describe('índices', () => {
  it('crea un índice al filtrar una vista por un campo numérico', () => {
    const { db, svc } = setup()
    const n = svc.createField('nota', { label: 'N', type: 'number' })
    const v = svc.listViews('nota')[0]!
    svc.updateView(v.id, { config: { filters: [{ fieldId: n.id, op: 'gt', value: 1 }] } })
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'rec_f_%'")
      .all()
    expect(idx).toHaveLength(1)
  })
})
