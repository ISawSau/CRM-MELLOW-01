import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Esquema de la base de datos (Drizzle). Las migraciones SQL se generan con
 * `npm run db:generate` a partir de este archivo y se guardan en `drizzle/`.
 */

/** Ajustes de la app que viven dentro de la bóveda (valor en JSON). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
})

// --- Motor de datos (fase 1, SPEC §6) ------------------------------------------
//
// Todas las entidades (notas, y más adelante clientes, tareas…) comparten la tabla
// `records`. Los valores de los campos van en la columna JSON `data`, con el id del
// campo como clave (así renombrar un campo no toca los datos).

/** Registros de cualquier entidad. `deleted_at` no nulo = en la papelera. */
export const records = sqliteTable(
  'records',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('records_entity_idx').on(t.entity, t.deletedAt),
    index('records_updated_idx').on(t.updatedAt),
  ],
)

/** Definición de los campos de cada entidad (de sistema y personalizados). */
export const fieldDefs = sqliteTable(
  'field_defs',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    /** Nombre corto para las fórmulas (a-z, 0-9 y _). */
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    position: integer('position').notNull(),
    visible: integer('visible', { mode: 'boolean' }).notNull(),
    required: integer('required', { mode: 'boolean' }).notNull(),
    system: integer('system', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Campo eliminado (restaurable): sus valores siguen en `records.data`. */
    deletedAt: text('deleted_at'),
  },
  (t) => [uniqueIndex('field_defs_entity_key_idx').on(t.entity, t.key)],
)

/** Vínculos de los campos de tipo relación: registro origen → registro destino. */
export const links = sqliteTable(
  'links',
  {
    fieldId: text('field_id').notNull(),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fieldId, t.fromId, t.toId] }),
    index('links_from_idx').on(t.fromId),
    index('links_to_idx').on(t.toId),
  ],
)

/** Vistas guardadas (tabla, lista, kanban, calendario, galería). */
export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('views_entity_idx').on(t.entity)],
)

/** Historial de cambios por registro. */
export const history = sqliteTable(
  'history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordId: text('record_id').notNull(),
    entity: text('entity').notNull(),
    at: text('at').notNull(),
    /** create | update | delete | restore */
    action: text('action').notNull(),
    /** { [fieldId]: { from, to } } */
    changes: text('changes', { mode: 'json' }).notNull(),
  },
  (t) => [index('history_record_idx').on(t.recordId, t.at)],
)

/**
 * Archivos de la bóveda (fase 4). El contenido va cifrado en `files/`; aquí solo
 * los metadatos. El id es un HMAC del contenido (deduplica sin revelar su hash).
 */
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  size: integer('size').notNull(),
  mime: text('mime').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Duración en segundos (vídeo y audio). */
  duration: integer('duration'),
  hasThumb: integer('has_thumb').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

/** Versiones guardadas de un registro (creatividades y copies, fase 4). */
export const versions = sqliteTable(
  'versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordId: text('record_id').notNull(),
    number: integer('number').notNull(),
    note: text('note').notNull().default(''),
    /** Copia de los valores guardados del registro en ese momento. */
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('versions_record_number').on(t.recordId, t.number)],
)

// --- Meta (fase 6, SPEC §7.3) -------------------------------------------------------
//
// Datos que llegan de la API de Meta en solo lectura. Los importes van en la moneda de
// cada cuenta (en unidades, no en céntimos) y las fechas de las métricas en la zona
// horaria de la cuenta, tal como las entrega Meta. `raw` guarda la respuesta completa
// de cada objeto para poder usar más campos sin volver a descargar.

/** Cuentas publicitarias visibles con el token, y su estado de sincronización. */
export const adAccounts = sqliteTable('ad_accounts', {
  /** «act_123…» */
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  timezone: text('timezone').notNull(),
  status: integer('status'),
  business: text('business'),
  /** El usuario la ha elegido para sincronizar. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** Registro del cliente al que está asignada. */
  clientId: text('client_id'),
  /** Primer día con métricas descargadas (fecha de la cuenta). */
  dataFrom: text('data_from'),
  /** Último día con métricas descargadas (fecha de la cuenta). */
  dataUntil: text('data_until'),
  /** El histórico llega hasta el límite de Meta. */
  historyDone: integer('history_done', { mode: 'boolean' }).notNull().default(false),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
  /** Desgloses activados por nivel: { campaign: ['age'], … } (fase 7). */
  breakdowns: text('breakdowns', { mode: 'json' }),
  /** Hasta dónde se ha leído el historial de actividad (fase 7). */
  activityAt: text('activity_at'),
  raw: text('raw', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Campañas, conjuntos de anuncios y anuncios (estructura). */
export const adObjects = sqliteTable(
  'ad_objects',
  {
    id: text('id').primaryKey(),
    /** campaign | adset | ad */
    level: text('level').notNull(),
    accountId: text('account_id').notNull(),
    campaignId: text('campaign_id'),
    adsetId: text('adset_id'),
    name: text('name').notNull(),
    status: text('status'),
    effectiveStatus: text('effective_status'),
    /** Objetivo (campaña) u objetivo de optimización (conjunto). */
    objective: text('objective'),
    bidStrategy: text('bid_strategy'),
    /** Presupuestos en la moneda de la cuenta (Meta los da en la unidad mínima). */
    dailyBudget: integer('daily_budget'),
    lifetimeBudget: integer('lifetime_budget'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    creativeId: text('creative_id'),
    updatedTime: text('updated_time'),
    /** Última edición significativa según el historial de actividad (fase 7). */
    lastEdit: text('last_edit'),
    raw: text('raw', { mode: 'json' }).notNull(),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [
    index('ad_objects_account_idx').on(t.accountId, t.level),
    index('ad_objects_parent_idx').on(t.campaignId, t.adsetId),
  ],
)

/** Creatividades de anuncio, con su miniatura guardada cifrada en la bóveda. */
export const adCreatives = sqliteTable('ad_creatives', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name'),
  title: text('title'),
  body: text('body'),
  objectType: text('object_type'),
  callToAction: text('call_to_action'),
  linkUrl: text('link_url'),
  videoId: text('video_id'),
  /** URL de la miniatura en Meta (caduca: por eso se descarga). */
  thumbnailUrl: text('thumbnail_url'),
  /** Archivo de la bóveda con la miniatura descargada. */
  thumbFileId: text('thumb_file_id'),
  raw: text('raw', { mode: 'json' }).notNull(),
  syncedAt: text('synced_at').notNull(),
})

/** Métricas diarias por nivel (cuenta, campaña, conjunto, anuncio), entidad y fecha. */
export const adInsightsDaily = sqliteTable(
  'ad_insights_daily',
  {
    /** account | campaign | adset | ad */
    level: text('level').notNull(),
    entityId: text('entity_id').notNull(),
    date: text('date').notNull(),
    accountId: text('account_id').notNull(),
    campaignId: text('campaign_id'),
    adsetId: text('adset_id'),
    spend: real('spend').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    reach: integer('reach'),
    frequency: real('frequency'),
    clicks: integer('clicks'),
    linkClicks: integer('link_clicks'),
    uniqueLinkClicks: integer('unique_link_clicks'),
    linkCtr: real('link_ctr'),
    uniqueLinkCtr: real('unique_link_ctr'),
    cpm: real('cpm'),
    cpc: real('cpc'),
    qualityRanking: text('quality_ranking'),
    engagementRanking: text('engagement_ranking'),
    conversionRanking: text('conversion_ranking'),
    /** Respuesta cruda de acciones y valores de acciones. */
    actions: text('actions', { mode: 'json' }),
    actionValues: text('action_values', { mode: 'json' }),
    /** Resto de campos (ROAS, vídeo, resultados…). */
    extra: text('extra', { mode: 'json' }),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.entityId, t.date] }),
    index('ad_insights_account_idx').on(t.accountId, t.level, t.date),
  ],
)

/** Acciones normalizadas: una fila por entidad, día y tipo de acción. */
export const adActions = sqliteTable(
  'ad_actions',
  {
    level: text('level').notNull(),
    entityId: text('entity_id').notNull(),
    date: text('date').notNull(),
    actionType: text('action_type').notNull(),
    accountId: text('account_id').notNull(),
    count: real('count'),
    value: real('value'),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.entityId, t.date, t.actionType] }),
    index('ad_actions_account_idx').on(t.accountId, t.level, t.date),
  ],
)

/** Catálogo de tipos de acción vistos (para elegirlos en las métricas calculadas). */
export const adActionTypes = sqliteTable('ad_action_types', {
  actionType: text('action_type').primaryKey(),
  firstSeen: text('first_seen').notNull(),
})

/** Trozos de la importación histórica (reanudable si se cierra la app). */
export const adJobs = sqliteTable(
  'ad_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull(),
    level: text('level').notNull(),
    /** Desglose del trozo (null = métricas sin desglosar). */
    breakdown: text('breakdown'),
    since: text('since').notNull(),
    until: text('until').notNull(),
    /** pending | running | done | failed */
    status: text('status').notNull(),
    reportRunId: text('report_run_id'),
    startedAt: text('started_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('ad_jobs_account_idx').on(t.accountId, t.status)],
)

/** Tipos de cambio de referencia del BCE: unidades de `currency` por 1 EUR. */
export const fxRates = sqliteTable(
  'fx_rates',
  {
    date: text('date').notNull(),
    currency: text('currency').notNull(),
    rate: real('rate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.currency] })],
)

// --- Meta II (fase 7) ---------------------------------------------------------------

/** Vínculo entre una creatividad (registro del motor) y un anuncio de Meta. */
export const creativeLinks = sqliteTable(
  'creative_links',
  {
    recordId: text('record_id').notNull(),
    adId: text('ad_id').notNull(),
    /** manual | auto (convención de nombres) */
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.adId] }), index('creative_links_ad_idx').on(t.adId)],
)

/** Métricas diarias desglosadas (edad, sexo, país, plataforma, ubicación, dispositivo). */
export const adBreakdowns = sqliteTable(
  'ad_breakdowns',
  {
    level: text('level').notNull(),
    entityId: text('entity_id').notNull(),
    date: text('date').notNull(),
    breakdown: text('breakdown').notNull(),
    value: text('value').notNull(),
    accountId: text('account_id').notNull(),
    spend: real('spend').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks'),
    linkClicks: integer('link_clicks'),
    actions: text('actions', { mode: 'json' }),
    actionValues: text('action_values', { mode: 'json' }),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.entityId, t.date, t.breakdown, t.value] }),
    index('ad_breakdowns_account_idx').on(t.accountId, t.level, t.breakdown, t.date),
  ],
)

/** Métricas no sumables de un periodo (alcance, frecuencia, únicos), pedidas a Meta. */
export const adRangeStats = sqliteTable(
  'ad_range_stats',
  {
    level: text('level').notNull(),
    entityId: text('entity_id').notNull(),
    since: text('since').notNull(),
    until: text('until').notNull(),
    accountId: text('account_id').notNull(),
    reach: integer('reach'),
    frequency: real('frequency'),
    uniqueLinkClicks: integer('unique_link_clicks'),
    uniqueLinkCtr: real('unique_link_ctr'),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.level, t.entityId, t.since, t.until] }),
    index('ad_range_account_idx').on(t.accountId, t.since, t.until),
  ],
)

// --- Análisis (fase 8) ----------------------------------------------------------------

/** Avisos de las alertas: uno por alerta y periodo mientras se cumple la condición. */
export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    alertId: text('alert_id').notNull(),
    since: text('since').notNull(),
    until: text('until').notNull(),
    value: real('value').notNull(),
    /** Copia de la alerta al saltar (por si luego se edita o se borra). */
    snapshot: text('snapshot', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    seenAt: text('seen_at'),
  },
  (t) => [uniqueIndex('alert_events_period').on(t.alertId, t.until)],
)
