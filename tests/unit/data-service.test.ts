import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDb, openEncryptedDb, type SqliteDb } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { DataService } from '../../src/main/data/data-service'
import { FileStore } from '../../src/main/files/file-store'
import { matchesFilter } from '../../src/main/data/query'
import { briefDocFromTemplate } from '../../src/shared/data/brief-templates'
import { socialUrl } from '../../src/shared/profile'
import { shiftDate } from '../../src/shared/data/dates'
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
  const files = new FileStore(randomBytes(32), tempDir())
  const svc = new DataService(db, {
    files,
    timeZone: 'Europe/Madrid',
    now: opts.now ?? (() => now),
    onChange: (c) => changes.push(c),
  })
  const fields = svc.listFields('nota')
  const byKey = (k: string) => fields.find((f) => f.key === k)!
  return {
    db,
    svc,
    files,
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
    expect(keys).toEqual([
      'titulo',
      'contenido',
      'tipo',
      'etiquetas',
      'fecha',
      'fijada',
      'cliente',
      'tareas',
    ])
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
    expect(svc.listFields('nota')).toHaveLength(8)
    expect(svc.listViews('nota')).toHaveLength(4)
  })
})

describe('siembra incremental (fase 2)', () => {
  it('una bóveda de la fase 1 recibe Clientes, Contactos y el campo Cliente en Notas', () => {
    const { db } = setup()
    // Simula la fase 1: solo Notas, sin el campo «cliente», con la marca antigua.
    db.exec("DELETE FROM field_defs WHERE entity <> 'nota' OR key = 'cliente'")
    db.exec("DELETE FROM views WHERE entity <> 'nota'")
    db.exec("DELETE FROM settings WHERE key LIKE 'data.seeded.%'")
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('data.seeded.nota', 'true', '')",
    ).run()
    // El usuario había renombrado un campo: no se toca.
    db.exec("UPDATE field_defs SET label = 'Clase' WHERE entity = 'nota' AND key = 'tipo'")

    const svc = new DataService(db, { timeZone: 'Europe/Madrid', now: () => NOW })
    const nota = svc.listFields('nota')
    expect(nota.map((f) => f.key)).toContain('cliente')
    expect(nota.find((f) => f.key === 'tipo')!.label).toBe('Clase')
    expect(svc.listViews('nota')).toHaveLength(4)
    const cliente = svc.listFields('cliente')
    const inverso = cliente.find((f) => f.key === 'notas')!
    expect(inverso.config['inverseOf']).toBe(nota.find((f) => f.key === 'cliente')!.id)
    expect(svc.listViews('cliente').map((v) => v.name)).toEqual(['Todos', 'Pipeline', 'Tarjetas'])
    expect(svc.listViews('contacto')).toHaveLength(2)
  })
})

describe('relaciones inversas', () => {
  it('un contacto pertenece a un cliente y el cliente ve sus contactos', () => {
    const { svc } = setup()
    const cf = (k: string) => svc.listFields('cliente').find((f) => f.key === k)!
    const kf = (k: string) => svc.listFields('contacto').find((f) => f.key === k)!
    const acme = svc.create('cliente', { [cf('nombre').id]: 'Acme' })
    const beta = svc.create('cliente', { [cf('nombre').id]: 'Beta' })
    const ana = svc.create('contacto', { [kf('nombre').id]: 'Ana' })
    const luis = svc.create('contacto', { [kf('nombre').id]: 'Luis' })

    // Desde el contacto (campo directo, un solo cliente).
    svc.setLinks(kf('cliente').id, ana.id, [acme.id])
    expect(svc.get(acme.id).values[cf('contactos').id]).toEqual([{ id: ana.id, title: 'Ana' }])

    // Desde el cliente (campo inverso, varios contactos).
    svc.setLinks(cf('contactos').id, acme.id, [ana.id, luis.id])
    expect(svc.get(luis.id).values[kf('cliente').id]).toEqual([{ id: acme.id, title: 'Acme' }])

    // Luis pasa a Beta: deja de estar en Acme (el contacto solo admite un cliente).
    svc.setLinks(cf('contactos').id, beta.id, [luis.id])
    expect(svc.get(acme.id).values[cf('contactos').id]).toEqual([{ id: ana.id, title: 'Ana' }])
    expect(svc.get(luis.id).values[kf('cliente').id]).toEqual([{ id: beta.id, title: 'Beta' }])

    // Deshacer devuelve a Luis a Acme exactamente.
    svc.undo()
    expect(svc.get(luis.id).values[kf('cliente').id]).toEqual([{ id: acme.id, title: 'Acme' }])
    expect(svc.get(beta.id).values[cf('contactos').id]).toEqual([])
    svc.redo()
    expect(svc.get(beta.id).values[cf('contactos').id]).toEqual([{ id: luis.id, title: 'Luis' }])

    // Un contacto no puede tener dos clientes.
    expect(() => svc.setLinks(kf('cliente').id, ana.id, [acme.id, beta.id])).toThrow(/un solo/)
    // Los que están en la papelera no aparecen.
    svc.trash([ana.id])
    expect(svc.get(acme.id).values[cf('contactos').id]).toEqual([])
  })

  it('crea el campo inverso de una relación nueva y filtra por él', () => {
    const { svc } = setup()
    const rel = svc.createField('contacto', {
      label: 'Referido por',
      type: 'relation',
      config: { target: 'cliente', multiple: false },
    })
    const inv = svc.createInverseField(rel.id, 'Referidos')
    expect(inv.entity).toBe('cliente')
    const nombre = svc.listFields('cliente').find((f) => f.key === 'nombre')!
    const c = svc.create('cliente', { [nombre.id]: 'Acme' })
    svc.create('cliente', { [nombre.id]: 'Beta' })
    const k = svc.create('contacto')
    svc.setLinks(rel.id, k.id, [c.id])
    const hits = svc.query('cliente', {
      filters: [{ fieldId: inv.id, op: 'not_empty', value: null }],
    })
    expect(hits.map((h) => h.id)).toEqual([c.id])
    // Un inverso no se puede invertir ni cambiar de destino.
    expect(() => svc.createInverseField(inv.id, 'x')).toThrow()
    svc.updateField(inv.id, { config: { target: 'nota', multiple: true } })
    expect(svc.getField(inv.id).config['target']).toBe('contacto')
  })

  it('un resumen cuenta los contactos de cada cliente', () => {
    const { svc } = setup()
    const cf = (k: string) => svc.listFields('cliente').find((f) => f.key === k)!
    const n = svc.createField('cliente', {
      label: 'Nº contactos',
      type: 'rollup',
      config: { relationField: cf('contactos').id, fn: 'count' },
    })
    const c = svc.create('cliente')
    svc.setLinks(cf('contactos').id, c.id, [svc.create('contacto').id, svc.create('contacto').id])
    expect(svc.get(c.id).values[n.id]).toEqual({ value: 2 })
  })
})

describe('perfil', () => {
  it('guarda el perfil y su zona horaria manda en los filtros de «hoy»', () => {
    const { svc, byKey } = setup()
    expect(svc.getProfile()).toMatchObject({ name: '', currency: 'EUR', timeZone: 'Europe/Madrid' })
    // 15/06 a las 08:00 UTC: en Madrid ya es 15, en Honolulu aún es 14.
    const f = byKey('fecha')
    svc.create('nota', { [f.id]: '2026-06-14' })
    const hoy = () => svc.query('nota', { filters: [{ fieldId: f.id, op: 'today', value: null }] })
    expect(hoy()).toHaveLength(0)
    svc.setProfile({ ...svc.getProfile(), name: 'Joan', timeZone: 'Pacific/Honolulu' })
    expect(svc.getProfile().name).toBe('Joan')
    expect(hoy()).toHaveLength(1)
    expect(() => svc.setProfile({ ...svc.getProfile(), timeZone: 'Marte/Olympus' })).toThrow()
    expect(() =>
      svc.setProfile({ ...svc.getProfile(), photo: 'data:text/html;base64,PHNjcmlwdD4=' }),
    ).toThrow()
  })

  it('redes del perfil, clientes destacados y actividad por día', () => {
    const { svc } = setup()
    const p = svc.setProfile({
      ...svc.getProfile(),
      role: 'Media buyer',
      socials: { instagram: '@yellowmellow', whatsapp: '+34 600 11 22 33', x: '' },
      pinned: ['c1', 'c2'],
      setupDone: true,
    })
    expect(p).toMatchObject({ role: 'Media buyer', pinned: ['c1', 'c2'], setupDone: true })
    expect(socialUrl('instagram', '@yellowmellow')).toBe('https://www.instagram.com/yellowmellow')
    expect(socialUrl('whatsapp', '+34 600 11 22 33')).toBe('https://wa.me/34600112233')
    expect(socialUrl('discord', 'mellow')).toBeNull()
    expect(socialUrl('discord', 'https://discord.gg/abc')).toBe('https://discord.gg/abc')
    expect(socialUrl('x', 'javascript:alert(1)')).toBeNull()
    expect(() =>
      svc.setProfile({ ...svc.getProfile(), socials: { github: 'no vale con espacios' } }),
    ).toThrow()
    expect(() =>
      svc.setProfile({ ...svc.getProfile(), pinned: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    ).toThrow()
    // Cada cambio en un registro cuenta en el día (hora de Madrid).
    svc.create('nota', {}, { title: 'Una' })
    svc.create('nota', {}, { title: 'Otra' })
    expect(svc.activity()).toEqual([{ date: '2026-06-15', count: 2 }])
  })

  it('crea un registro con título directamente', () => {
    const { svc } = setup()
    expect(svc.create('contacto', {}, { title: '  Ana  ' }).title).toBe('Ana')
    // Los pipelines empiezan en su primera etapa.
    const estado = svc.listFields('tarea').find((f) => f.key === 'estado')!
    expect(svc.create('tarea').values[estado.id]).toBe('pendiente')
    expect(svc.create('tarea', { [estado.id]: 'hecha' }).values[estado.id]).toBe('hecha')
  })
})

describe('tareas que se repiten', () => {
  function taskSetup() {
    const env = setup()
    const tf = (k: string) => env.svc.listFields('tarea').find((f) => f.key === k)!
    return { ...env, tf }
  }

  it('al completar una tarea semanal se crea la siguiente, y deshacer lo revierte', () => {
    const { svc, tf } = taskSetup()
    const cf = svc.listFields('cliente').find((f) => f.key === 'nombre')!
    const acme = svc.create('cliente', { [cf.id]: 'Acme' })
    // Hoy es lunes 15/06/2026. Informe cada lunes, con checklist.
    const t = svc.create('tarea', {
      [tf('titulo').id]: 'Informe semanal',
      [tf('fecha_limite').id]: '2026-06-15',
      [tf('estado').id]: 'en-curso',
      [tf('checklist').id]: [{ id: 'a', text: 'Exportar datos', done: true }],
      [tf('repeticion').id]: { freq: 'weekly', weekdays: [0], mode: 'completion' },
    })
    svc.setLinks(tf('cliente').id, t.id, [acme.id])
    svc.update(t.id, { [tf('estado').id]: 'hecha' })

    const all = svc.query('tarea')
    expect(all).toHaveLength(2)
    const next = all.find((r) => r.id !== t.id)!
    expect(next.title).toBe('Informe semanal')
    expect(next.values[tf('fecha_limite').id]).toBe('2026-06-22')
    expect(next.values[tf('estado').id]).toBe('pendiente')
    expect(next.values[tf('checklist').id]).toEqual([
      { id: 'a', text: 'Exportar datos', done: false },
    ])
    expect(next.values[tf('cliente').id]).toEqual([{ id: acme.id, title: 'Acme' }])
    // La regla pasa a la nueva; la completada ya no genera más.
    expect(next.values[tf('repeticion').id]).toMatchObject({ freq: 'weekly' })
    expect(svc.get(t.id).values[tf('repeticion').id]).toBeUndefined()
    // Volver a abrirla y cerrarla no duplica.
    svc.update(t.id, { [tf('estado').id]: 'pendiente' })
    svc.update(t.id, { [tf('estado').id]: 'hecha' })
    expect(svc.query('tarea')).toHaveLength(2)

    svc.undo() // hecha
    svc.undo() // pendiente
    svc.undo() // la primera vez que se completó: quita la nueva y devuelve la regla
    expect(svc.query('tarea')).toHaveLength(1)
    expect(svc.get(t.id).values[tf('repeticion').id]).toMatchObject({ freq: 'weekly' })
    expect(svc.get(t.id).values[tf('estado').id]).toBe('en-curso')
    svc.redo()
    expect(svc.query('tarea')).toHaveLength(2)
  })

  it('según calendario: una tarea vencida genera la de hoy al abrir la bóveda', () => {
    const { db, svc, tf } = taskSetup()
    svc.create('tarea', {
      [tf('titulo').id]: 'Revisar presupuesto',
      [tf('fecha_limite').id]: '2026-06-10',
      [tf('repeticion').id]: { freq: 'daily', mode: 'schedule' },
    })
    svc.create('tarea', {
      [tf('titulo').id]: 'Al completar',
      [tf('fecha_limite').id]: '2026-06-10',
      [tf('repeticion').id]: { freq: 'daily', mode: 'completion' },
    })
    const again = new DataService(db, { timeZone: 'Europe/Madrid', now: () => NOW })
    again.dispose()
    const rows = svc.query('tarea').filter((r) => r.title === 'Revisar presupuesto')
    expect(rows.map((r) => r.values[tf('fecha_limite').id]).sort()).toEqual([
      '2026-06-10',
      '2026-06-15',
    ])
    expect(svc.query('tarea').filter((r) => r.title === 'Al completar')).toHaveLength(1)
    expect(svc.processRecurrences()).toBe(0)
  })

  it('cuenta las tareas de hoy y las atrasadas sin terminar', () => {
    const { svc, tf } = taskSetup()
    const mk = (fecha: string, estado = 'pendiente') =>
      svc.create('tarea', { [tf('fecha_limite').id]: fecha, [tf('estado').id]: estado })
    mk('2026-06-15')
    mk('2026-06-15', 'hecha')
    mk('2026-06-14')
    mk('2026-06-01')
    mk('2026-06-16')
    expect(svc.taskSummary()).toEqual({ today: 1, overdue: 2 })
    const hoy = svc.listViews('tarea').find((v) => v.name === 'Hoy')!
    expect(svc.query('tarea', hoy.config)).toHaveLength(1)
    const atrasadas = svc.listViews('tarea').find((v) => v.name === 'Atrasadas')!
    expect(
      svc.query('tarea', atrasadas.config).map((r) => r.values[tf('fecha_limite').id]),
    ).toEqual(['2026-06-01', '2026-06-14'])
  })
})

describe('plantillas de brief', () => {
  it('trae una plantilla de partida, la guarda editada y genera el contenido', () => {
    const { svc } = setup()
    const [campana] = svc.getBriefTemplates()
    expect(campana!.name).toBe('Brief de campaña')
    const doc = briefDocFromTemplate(campana!)
    expect(doc.text).toContain('Objetivo')
    const bf = (k: string) => svc.listFields('brief').find((f) => f.key === k)!
    const b = svc.create('brief', { [bf('contenido').id]: doc }, { title: 'Lanzamiento' })
    expect((b.values[bf('contenido').id] as { text: string }).text).toContain('Mensajes clave')
    svc.setBriefTemplates([
      { ...campana!, name: 'Mi brief', sections: campana!.sections.slice(0, 2) },
    ])
    expect(svc.getBriefTemplates()[0]).toMatchObject({ name: 'Mi brief' })
    expect(() =>
      svc.setBriefTemplates([
        { ...campana!, sections: [{ id: 'x', title: '', kind: 'text', hint: '' }] },
      ]),
    ).toThrow()
  })
})

describe('plantillas de brief (fase 12)', () => {
  it('crear desde plantilla pone la entrega y crea las tareas enlazadas al brief', () => {
    const { svc } = setup()
    const today = '2026-06-15'
    const [campana] = svc.getBriefTemplates()
    expect(campana!.dueDays).toBe(7)
    expect(campana!.tasks.map((t) => t.title)).toEqual([
      'Revisar el brief con el cliente',
      'Preparar las creatividades',
    ])
    const bf = (k: string) => svc.listFields('brief').find((f) => f.key === k)!
    const tf = (k: string) => svc.listFields('tarea').find((f) => f.key === k)!
    const brief = svc.createBriefFromTemplate(campana!.id)
    expect(brief.title).toBe('Brief de campaña')
    expect(brief.values[bf('entrega').id]).toBe(shiftDate(today, 7))
    expect((brief.values[bf('contenido').id] as { text: string }).text).toContain(
      'Enlaza las creatividades en el campo «Creatividades» de este brief.',
    )
    const tasks = svc.query('tarea', { filters: [], match: 'all', sorts: [] })
    expect(tasks.map((t) => [t.title, t.values[tf('fecha_limite').id]]).sort()).toEqual([
      ['Preparar las creatividades', shiftDate(today, 6)],
      ['Revisar el brief con el cliente', shiftDate(today, 2)],
    ])
    for (const t of tasks)
      expect((t.values[tf('brief').id] as { id: string }[]).map((l) => l.id)).toEqual([brief.id])
    expect(() => svc.createBriefFromTemplate('no-existe')).toThrow(/no existe/)
  })

  it('guardar un brief como plantilla convierte sus títulos en secciones', () => {
    const { svc } = setup()
    const [campana] = svc.getBriefTemplates()
    const brief = svc.createBriefFromTemplate(campana!.id)
    const list = svc.saveBriefAsTemplate(brief.id, 'Copia del brief')
    const t = list.at(-1)!
    expect(t.name).toBe('Copia del brief')
    expect(t.sections.map((s) => [s.title, s.kind, s.hint])).toEqual(
      campana!.sections.map((s) => [s.title, s.kind, s.hint]),
    )
    const vacio = svc.create('brief', {}, { title: 'Vacío' })
    expect(() => svc.saveBriefAsTemplate(vacio.id, 'X')).toThrow(/no tiene títulos/)
  })

  it('las plantillas guardadas antes de la fase 12 siguen valiendo', () => {
    const { svc, db } = setup()
    const old = { id: 'vieja', name: 'Vieja', sections: [{ id: 's', title: 'A', kind: 'text' }] }
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('briefs.templates', ?, '')",
    ).run(JSON.stringify([old]))
    expect(svc.getBriefTemplates()).toEqual([
      { ...old, sections: [{ ...old.sections[0], hint: '' }], dueDays: null, tasks: [] },
    ])
  })
})

describe('colecciones personalizadas (fase 12)', () => {
  const input = { label: 'Proveedores', singular: 'Proveedor', gender: 'm' as const, letter: 'V' }

  it('crear una colección: campos, vista, registros, relaciones, búsqueda y papelera', () => {
    const { svc } = setup()
    const list = svc.createCollection(input)
    const col = list.find((e) => e.custom)!
    expect(col).toMatchObject({
      id: 'col-proveedores',
      label: 'Proveedores',
      singular: 'proveedor',
      titleKey: 'nombre',
      letter: 'V',
    })
    expect(svc.listFields(col.id).map((f) => f.key)).toEqual(['nombre', 'notas'])
    expect(svc.listViews(col.id).map((v) => v.name)).toEqual(['Todos'])
    // Mismo nombre: id distinto.
    expect(
      svc
        .createCollection(input)
        .filter((e) => e.custom)
        .map((e) => e.id),
    ).toEqual(['col-proveedores', 'col-proveedores-2'])
    // Campos propios y relación con clientes (con su campo inverso).
    const precio = svc.createField(col.id, { label: 'Precio', type: 'currency' })
    const rel = svc.createField(col.id, {
      label: 'Clientes',
      type: 'relation',
      config: { target: 'cliente', multiple: true },
    })
    svc.createInverseField(rel.id, 'Proveedores', true)
    const acme = svc.create('cliente', {}, { title: 'Acme' })
    const p = svc.create(col.id, { [precio.id]: 120 }, { title: 'Imprenta Pérez' })
    svc.setLinks(rel.id, p.id, [acme.id])
    const inv = svc.listFields('cliente').find((f) => f.label === 'Proveedores')!
    expect((svc.get(acme.id).values[inv.id] as { title: string }[]).map((l) => l.title)).toEqual([
      'Imprenta Pérez',
    ])
    expect(svc.search('imprenta').map((h) => h.entity)).toEqual([col.id])
    expect(svc.query(col.id, { filters: [], match: 'all', sorts: [] })).toHaveLength(1)

    // No se borra con registros ni mientras otra entidad la enlace.
    expect(() => svc.deleteCollection(col.id)).toThrow(/tiene 1 registro/)
    svc.trash([p.id])
    expect(() => svc.deleteCollection(col.id)).toThrow(/«Proveedores» de Clientes/)
    svc.deleteField(inv.id)
    const after = svc.deleteCollection(col.id)
    expect(after.some((e) => e.id === col.id)).toBe(false)
    expect(() => svc.listFields(col.id)).toThrow(/No existe la entidad/)
    expect(svc.listTrash().some((t) => t.id === p.id)).toBe(false)
  })

  it('renombrar y validar', () => {
    const { svc } = setup()
    const [col] = svc.createCollection(input).filter((e) => e.custom)
    const r = svc.updateCollection(col!.id, {
      ...input,
      label: 'Agencias',
      singular: 'Agencia',
      gender: 'f',
    })
    expect(r.find((e) => e.id === col!.id)).toMatchObject({
      label: 'Agencias',
      singular: 'agencia',
    })
    expect(() => svc.createCollection({ ...input, letter: 'VV' })).toThrow()
    expect(() => svc.createCollection({ ...input, label: '' })).toThrow()
    // Una relación hacia una colección que no existe se rechaza.
    expect(() =>
      svc.createField('nota', {
        label: 'X',
        type: 'relation',
        config: { target: 'col-no-existe', multiple: true },
      }),
    ).toThrow(/no existe/)
  })
})

describe('archivos y versiones', () => {
  it('el fondo de un tema propio no se borra como huérfano', () => {
    const { svc, db, setNow } = setup()
    const bg = svc.importBuffer('fondo.jpg', Buffer.from('imagen'))
    const suelto = svc.importBuffer('suelto.jpg', Buffer.from('otra'))
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('appearance.themes', ?, '')",
    ).run(JSON.stringify([{ id: 'propio-1', background: { fileId: bg.id, kind: 'image' } }]))
    setNow(new Date(NOW.getTime() + 2 * 86_400_000))
    expect(svc.gcFiles()).toBe(1)
    expect(svc.fileInfo(bg.id)).not.toBeNull()
    expect(svc.fileInfo(suelto.id)).toBeNull()
  })

  it('adjunta archivos cifrados y borra los huérfanos al cabo de un día', () => {
    const { svc, files, setNow } = setup()
    const adj = svc.createField('nota', { label: 'Adjuntos', type: 'files' })
    const img = svc.importBuffer('foto.JPG', Buffer.from('imagen'))
    expect(img).toMatchObject({ name: 'foto.JPG', size: 6, mime: 'image/jpeg' })
    const doc = svc.importBuffer('../../secreto/informe.pdf', Buffer.from('pdf'))
    expect(doc.name).toBe('informe.pdf')
    const n = svc.create('nota', { [adj.id]: [img, doc] })
    expect(n.values[adj.id]).toEqual([img, doc])
    expect(svc.search('informe').map((h) => h.id)).toEqual([n.id])
    expect(() => svc.update(n.id, { [adj.id]: [{ ...img, id: 'f'.repeat(64) }] })).toThrow(
      /no está en la bóveda/,
    )
    // Filtros de vacío.
    svc.create('nota')
    expect(
      svc.query('nota', { filters: [{ fieldId: adj.id, op: 'not_empty', value: null }] }),
    ).toHaveLength(1)

    svc.setFileMeta(img.id, { width: 1080, height: 1350, thumb: Buffer.from('mini') })
    expect(svc.fileInfo(img.id)).toMatchObject({ width: 1080, height: 1350, hasThumb: true })
    expect(files.read(img.id, 'thumbs').toString()).toBe('mini')

    // Quitar el PDF: sigue un día por si se deshace; luego se borra.
    svc.update(n.id, { [adj.id]: [img] })
    expect(svc.gcFiles()).toBe(0)
    setNow(new Date(NOW.getTime() + 2 * 86_400_000))
    expect(svc.gcFiles()).toBe(1)
    expect(files.exists(doc.id)).toBe(false)
    expect(files.exists(img.id)).toBe(true)
    // En la papelera sigue en uso; al vaciarla, se borra.
    svc.trash([n.id])
    expect(svc.gcFiles()).toBe(0)
    svc.purge([n.id])
    expect(files.exists(img.id)).toBe(false)
  })

  it('guarda versiones, las restaura y deshacer vuelve atrás', () => {
    const { svc, byKey } = setup()
    const t = byKey('titulo')
    const c = byKey('contenido')
    const doc = (text: string) => ({
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      text,
    })
    const r = svc.create('nota', { [t.id]: 'Hook A', [c.id]: doc('Primer copy') })
    const v1 = svc.createVersion(r.id, 'Primera')
    expect(v1).toMatchObject({ number: 1, note: 'Primera' })
    svc.update(r.id, { [t.id]: 'Hook B', [c.id]: doc('Segundo copy') })
    svc.createVersion(r.id)
    expect(svc.listVersions(r.id).map((v) => v.number)).toEqual([2, 1])
    svc.restoreVersion(v1.id)
    expect(svc.get(r.id).title).toBe('Hook A')
    expect((svc.get(r.id).values[c.id] as { text: string }).text).toBe('Primer copy')
    svc.undo()
    expect(svc.get(r.id).title).toBe('Hook B')
    // Las versiones se borran con el registro.
    svc.trash([r.id])
    svc.purge([r.id])
    expect(() => svc.listVersions(r.id)).toThrow()
  })
})

describe('registros', () => {
  it('crea, edita y guarda el historial', () => {
    const { svc, byKey, changes } = setup()
    const titulo = byKey('titulo')
    const tipo = byKey('tipo')
    const r = svc.create('nota', { [titulo.id]: 'Campaña de verano', [tipo.id]: opt(tipo, 'Idea') })
    expect(r.title).toBe('Campaña de verano')
    expect(changes.at(-1)).toMatchObject({ entity: 'nota', undo: { canUndo: true } })

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

  it('no deja borrar campos de sistema', () => {
    const { svc, byKey } = setup()
    expect(() => svc.deleteField(byKey('titulo').id)).toThrow(/sistema/)
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
    expect(head).toBe(
      'Título;Contenido;Tipo;Etiquetas;Fecha;Fijada;Cliente;Tareas;Precio (EUR);Margen (%)',
    )
    expect(row).toBe(`"'=HYPERLINK(""http://malo"")";;;;15/06/2026;Sí;;;1234,56;21,5`)
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
