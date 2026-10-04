/** Secciones de la barra lateral. Cada una indica en qué fase llega (SPEC §9). */
export interface Section {
  id: string
  label: string
  letter: string
  phase: number | null
  summary: string
  /** Si la sección es una entidad del motor de datos, su id. */
  entity?: string
  /** Icono de la barra lateral (nombre del catálogo); sin él, el de serie. */
  icon?: string
}

export interface SectionGroup {
  num: string
  title: string
  sections: Section[]
}

export const SECTION_GROUPS: SectionGroup[] = [
  {
    num: '01',
    title: 'trabajo',
    sections: [
      { id: 'perfil', label: 'Perfil', letter: 'Y', phase: null, summary: '' },
      { id: 'inicio', label: 'Inicio', letter: 'I', phase: null, summary: '' },
      { id: 'notas', label: 'Notas', letter: 'O', phase: null, summary: '', entity: 'nota' },
      {
        id: 'clientes',
        label: 'Clientes',
        letter: 'C',
        phase: null,
        summary: '',
        entity: 'cliente',
      },
      {
        id: 'contactos',
        label: 'Contactos',
        letter: 'P',
        phase: null,
        summary: '',
        entity: 'contacto',
      },
      { id: 'tareas', label: 'Tareas', letter: 'T', phase: null, summary: '', entity: 'tarea' },
      { id: 'briefs', label: 'Briefs', letter: 'B', phase: null, summary: '', entity: 'brief' },
    ],
  },
  {
    num: '02',
    title: 'media buying',
    sections: [
      {
        id: 'campanas',
        label: 'Campañas',
        letter: 'M',
        phase: null,
        summary: '',
      },
      {
        id: 'creatividades',
        label: 'Creatividades',
        letter: 'R',
        phase: null,
        summary: '',
        entity: 'creatividad',
      },
      {
        id: 'analisis',
        label: 'Análisis',
        letter: 'A',
        phase: null,
        summary: '',
      },
    ],
  },
  {
    num: '03',
    title: 'negocio',
    sections: [
      { id: 'facturacion', label: 'Facturación', letter: 'F', phase: null, summary: '' },
      {
        id: 'facturas',
        label: 'Facturas',
        letter: 'U',
        phase: null,
        summary: '',
        entity: 'factura',
      },
      { id: 'gastos', label: 'Gastos', letter: 'G', phase: null, summary: '', entity: 'gasto' },
      { id: 'horas', label: 'Horas', letter: 'R', phase: null, summary: '', entity: 'hora' },
      { id: 'informes', label: 'Informes', letter: 'N', phase: null, summary: '' },
      {
        id: 'documentos',
        label: 'Documentos',
        letter: 'D',
        phase: null,
        summary: '',
        entity: 'documento',
      },
      { id: 'herramientas', label: 'Herramientas', letter: 'H', phase: null, summary: '' },
    ],
  },
]

export const SETTINGS_SECTION: Section = {
  id: 'ajustes',
  label: 'Ajustes',
  letter: '⚙',
  phase: null,
  summary: '',
}

export const TRASH_SECTION: Section = {
  id: 'papelera',
  label: 'Papelera',
  letter: '⌫',
  phase: null,
  summary: '',
}

export const ALL_SECTIONS: Section[] = [
  ...SECTION_GROUPS.flatMap((g) => g.sections),
  TRASH_SECTION,
  SETTINGS_SECTION,
]

/** Grupo de la barra lateral con las colecciones del usuario (fase 12). */
export function withCollections(custom: { id: string; label: string; letter: string | null }[]): {
  groups: SectionGroup[]
  all: Section[]
} {
  const base = SECTION_GROUPS
  const groups = custom.length
    ? [
        ...base,
        {
          num: '04',
          title: 'colecciones',
          sections: custom.map((e) => ({
            id: e.id,
            label: e.label,
            letter: e.letter ?? e.label.charAt(0).toUpperCase(),
            phase: null,
            summary: '',
            entity: e.id,
          })),
        },
      ]
    : base
  return { groups, all: [...groups.flatMap((g) => g.sections), TRASH_SECTION, SETTINGS_SECTION] }
}
