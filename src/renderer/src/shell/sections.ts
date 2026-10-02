/** Secciones de la barra lateral. Cada una indica en qué fase llega (SPEC §9). */
export interface Section {
  id: string
  label: string
  letter: string
  phase: number | null
  summary: string
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
      { id: 'inicio', label: 'Inicio', letter: 'I', phase: null, summary: '' },
      {
        id: 'clientes',
        label: 'Clientes',
        letter: 'C',
        phase: 2,
        summary: 'fichas de cliente, contactos y pipelines editables',
      },
      {
        id: 'tareas',
        label: 'Tareas',
        letter: 'T',
        phase: 3,
        summary: 'tareas con estados, kanban, calendario y recurrencias',
      },
      {
        id: 'briefs',
        label: 'Briefs',
        letter: 'B',
        phase: 3,
        summary: 'briefs libres y plantillas',
      },
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
        phase: 6,
        summary: 'cuentas de Meta, campañas, ad sets, anuncios y métricas diarias',
      },
      {
        id: 'creatividades',
        label: 'Creatividades',
        letter: 'R',
        phase: 4,
        summary: 'biblioteca de creatividades y copies con etiquetas y versiones',
      },
      {
        id: 'analisis',
        label: 'Análisis',
        letter: 'A',
        phase: 8,
        summary: 'dashboards, comparativas y alertas',
      },
    ],
  },
  {
    num: '03',
    title: 'negocio',
    sections: [
      {
        id: 'facturacion',
        label: 'Facturación',
        letter: 'F',
        phase: 9,
        summary: 'acuerdos por cliente, facturas emitidas y cobros',
      },
      {
        id: 'informes',
        label: 'Informes',
        letter: 'N',
        phase: 9,
        summary: 'informes para clientes exportados a PDF',
      },
      {
        id: 'herramientas',
        label: 'Herramientas',
        letter: 'H',
        phase: 9,
        summary: 'comprimir y convertir PDF, imágenes y vídeo',
      },
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

export const ALL_SECTIONS: Section[] = [
  ...SECTION_GROUPS.flatMap((g) => g.sections),
  SETTINGS_SECTION,
]
