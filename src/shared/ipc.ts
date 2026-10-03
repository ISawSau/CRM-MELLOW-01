import { z } from 'zod'
import { appearanceSchema, type Appearance } from './appearance'
import { FIELD_TYPES, idSchema, type FieldDef, type FileRef } from './data/fields'
import { profileSchema, type Profile } from './profile'
import { briefTemplatesSchema, type BriefTemplate } from './data/brief-templates'
import type {
  DataChange,
  HistoryEntry,
  RecordRow,
  SearchHit,
  TrashItem,
  UndoState,
} from './data/records'
import { filterSchema, sortSchema, VIEW_KINDS, type View } from './data/views'

/**
 * Contrato IPC entre la interfaz (renderer) y el proceso principal.
 *
 * Cada canal define el esquema de entrada (validado en el proceso principal con zod,
 * porque el renderer no es de confianza) y el tipo de salida. La lista de canales
 * permitidos está en `channels.ts` para que el preload no tenga que cargar zod.
 */

/** Longitud mínima de la contraseña maestra. Ver docs/DECISIONS.md. */
export const MIN_PASSWORD_LENGTH = 8

const password = z.string().min(MIN_PASSWORD_LENGTH).max(1024)
const anyPassword = z.string().min(1).max(1024)
const absolutePath = z.string().min(1).max(4096)

export const vaultNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  // eslint-disable-next-line no-control-regex -- se excluyen a propósito los caracteres de control
  .regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/, 'Nombre de carpeta no válido')
  .refine((n) => n !== '.' && n !== '..', 'Nombre de carpeta no válido')

export type VaultState = 'none' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  /** Ruta de la bóveda seleccionada (bloqueada o desbloqueada). */
  path: string | null
  /** Nombre visible (nombre de la carpeta). */
  name: string | null
  /** Minutos de inactividad antes del bloqueo automático (solo si está desbloqueada). */
  autoLockMinutes: number | null
  /** Apariencia guardada en la bóveda (solo si está desbloqueada). */
  appearance: Appearance | null
}

export interface EntityInfo {
  id: string
  label: string
  singular: string
  gender: 'f' | 'm'
}

/** Valores por id de campo; el proceso principal los valida contra cada campo. */
const values = z
  .record(idSchema, z.unknown())
  .refine((v) => Object.keys(v).length <= 300, 'Demasiados campos')
/** Configuración libre: el proceso principal la valida según el tipo de campo o vista. */
const config = z.record(z.string().max(40), z.unknown())
const ids = z.array(idSchema).min(1).max(5000)
const label = z.string().max(120)
const fileId = z.string().regex(/^[a-f0-9]{64}$/)
/** Lo que se puede arrastrar a la app de una vez; lo mayor, con «Añadir archivos». */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

export interface FileInfo {
  id: string
  size: number
  mime: string
  width: number | null
  height: number | null
  duration: number | null
  hasThumb: boolean
}

export interface VersionEntry {
  id: number
  number: number
  note: string
  createdAt: string
  data: Record<string, unknown>
}

export interface SyncStatus {
  /** Destino configurado: null si no hay sincronización. */
  kind: 'folder' | 'drive' | null
  label: string | null
  phase: 'idle' | 'syncing' | 'error' | 'conflict'
  error: string | null
  /** Conflicto pendiente: quién subió la versión de la nube y cuándo. */
  conflict: { device: string; uploadedAt: string } | null
  lastSyncAt: string | null
  /** Hay cambios de este equipo sin subir. */
  pending: boolean
  lastBackupAt: string | null
}

export interface BackupEntry {
  name: string
  date: string
  reason: string
  /** Tamaño de la base de datos (si la copia está en este equipo). */
  size: number | null
  local: boolean
  remote: boolean
}

export interface AppInfo {
  version: string
  platform: string
  hostname: string
  isPackaged: boolean
}

export const ipcSchemas = {
  'app:info': z.void(),
  'app:activity': z.void(),
  'vault:status': z.void(),
  'vault:pickFolder': z.object({ purpose: z.enum(['create', 'open']) }),
  'vault:create': z.object({ parentPath: absolutePath, name: vaultNameSchema, password }),
  'vault:open': z.object({ path: absolutePath }),
  'vault:unlock': z.object({ password: anyPassword, force: z.boolean().default(false) }),
  'vault:recover': z.object({
    recoveryKey: z.string().min(1).max(200),
    newPassword: password,
    force: z.boolean().default(false),
  }),
  'vault:lock': z.void(),
  'vault:close': z.void(),
  'vault:changePassword': z.object({ currentPassword: anyPassword, newPassword: password }),
  'vault:rotateKey': z.object({ password: anyPassword }),
  'settings:setAutoLock': z.object({
    minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  }),
  'settings:setAppearance': appearanceSchema,
  'clipboard:writeSecret': z.object({ text: z.string().min(1).max(500) }),

  // --- Motor de datos (fase 1) ---
  'data:entities': z.void(),
  'data:fields': z.object({ entity: idSchema, includeDeleted: z.boolean().default(false) }),
  'data:createField': z.object({
    entity: idSchema,
    label,
    type: z.enum(FIELD_TYPES),
    config: config.optional(),
  }),
  'data:updateField': z.object({
    id: idSchema,
    label: label.optional(),
    key: z.string().max(40).optional(),
    config: config.optional(),
    visible: z.boolean().optional(),
    required: z.boolean().optional(),
  }),
  'data:reorderFields': z.object({ entity: idSchema, ids: z.array(idSchema).max(300) }),
  'data:deleteField': z.object({ id: idSchema }),
  'data:restoreField': z.object({ id: idSchema }),
  'data:formulaProblem': z.object({
    entity: idSchema,
    expression: z.string().max(5000),
    fieldId: idSchema.optional(),
  }),
  'data:views': z.object({ entity: idSchema }),
  'data:createView': z.object({ entity: idSchema, name: label, kind: z.enum(VIEW_KINDS) }),
  'data:updateView': z.object({ id: idSchema, name: label.optional(), config: config.optional() }),
  'data:deleteView': z.object({ id: idSchema }),
  'data:query': z.object({
    entity: idSchema,
    filters: z.array(filterSchema).max(50).default([]),
    match: z.enum(['all', 'any']).default('all'),
    sorts: z.array(sortSchema).max(5).default([]),
  }),
  'data:get': z.object({ id: idSchema }),
  'data:create': z.object({
    entity: idSchema,
    values: values.default({}),
    title: z.string().max(10_000).optional(),
  }),
  'data:createInverseField': z.object({
    fieldId: idSchema,
    label,
    multiple: z.boolean().default(true),
  }),
  'files:pick': z.void(),
  'files:upload': z.object({
    name: z.string().min(1).max(255),
    data: z
      .instanceof(Uint8Array)
      .refine((d) => d.byteLength <= MAX_UPLOAD_BYTES, 'Archivo demasiado grande'),
  }),
  'files:info': z.object({ id: fileId }),
  'files:setMeta': z.object({
    id: fileId,
    width: z.number().int().min(1).max(100_000).optional(),
    height: z.number().int().min(1).max(100_000).optional(),
    duration: z.number().min(0).max(1e7).optional(),
    thumb: z
      .instanceof(Uint8Array)
      .refine((d) => d.byteLength <= 2_000_000, 'Miniatura demasiado grande')
      .optional(),
  }),
  'files:export': z.object({ id: fileId, name: z.string().min(1).max(255) }),
  'versions:list': z.object({ recordId: idSchema }),
  'versions:create': z.object({ recordId: idSchema, note: z.string().max(500).default('') }),
  'versions:restore': z.object({ versionId: z.number().int().min(1) }),
  'sync:status': z.void(),
  'sync:pickFolder': z.void(),
  'sync:connectDrive': z.object({
    clientId: z.string().trim().min(10).max(300),
    clientSecret: z.string().trim().max(300),
  }),
  'sync:disconnect': z.void(),
  'sync:now': z.void(),
  'sync:resolve': z.object({ keep: z.enum(['local', 'remote']) }),
  'backups:list': z.void(),
  'backups:create': z.void(),
  'backups:restore': z.object({ name: z.string().regex(/^\d{8}-\d{6}-[a-z0-9-]{1,60}$/i) }),
  'backups:config': z.void(),
  'backups:setConfig': z.object({
    intervalDays: z.number().int().min(1).max(60),
    keepLast: z.number().int().min(1).max(100),
    keepMonthly: z.boolean(),
  }),
  'tasks:summary': z.void(),
  'briefs:templates': z.void(),
  'briefs:setTemplates': z.object({ templates: briefTemplatesSchema }),
  'profile:get': z.void(),
  'profile:set': profileSchema,
  'data:update': z.object({ id: idSchema, patch: values }),
  'data:setLinks': z.object({
    fieldId: idSchema,
    fromId: idSchema,
    toIds: z.array(idSchema).max(1000),
  }),
  'data:duplicate': z.object({ id: idSchema }),
  'data:trash': z.object({ ids }),
  'data:restore': z.object({ ids }),
  'data:purge': z.object({ ids }),
  'data:trashList': z.object({ entity: idSchema.optional() }),
  'data:setTrashDays': z.object({ days: z.number().int().min(1).max(3650) }),
  'data:history': z.object({ id: idSchema }),
  'data:search': z.object({
    text: z.string().max(200),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  'data:undo': z.void(),
  'data:redo': z.void(),
  'data:undoState': z.void(),
  'data:exportCsv': z.object({ viewId: idSchema }),
} as const

export interface IpcOutputs {
  'app:info': AppInfo
  'app:activity': void
  'vault:status': VaultStatus
  'vault:pickFolder': string | null
  'vault:create': { status: VaultStatus; recoveryKey: string }
  'vault:open': VaultStatus
  'vault:unlock': VaultStatus
  'vault:recover': VaultStatus
  'vault:lock': VaultStatus
  'vault:close': VaultStatus
  'vault:changePassword': void
  'vault:rotateKey': { recoveryKey: string }
  'settings:setAutoLock': VaultStatus
  'settings:setAppearance': VaultStatus
  'clipboard:writeSecret': void
  'data:entities': EntityInfo[]
  'data:fields': FieldDef[]
  'data:createField': FieldDef
  'data:updateField': FieldDef
  'data:reorderFields': FieldDef[]
  'data:deleteField': void
  'data:restoreField': FieldDef
  'data:formulaProblem': string | null
  'data:views': View[]
  'data:createView': View
  'data:updateView': View
  'data:deleteView': void
  'data:query': RecordRow[]
  'data:get': RecordRow
  'data:create': RecordRow
  'data:createInverseField': FieldDef
  'files:pick': FileRef[]
  'files:upload': FileRef
  'files:info': FileInfo | null
  'files:setMeta': FileInfo
  'files:export': string | null
  'versions:list': VersionEntry[]
  'versions:create': VersionEntry
  'versions:restore': RecordRow
  'sync:status': SyncStatus
  'sync:pickFolder': SyncStatus | null
  'sync:connectDrive': SyncStatus
  'sync:disconnect': SyncStatus
  'sync:now': SyncStatus
  'sync:resolve': SyncStatus
  'backups:list': BackupEntry[]
  'backups:create': string
  'backups:restore': 'reopened' | 'locked'
  'backups:config': { intervalDays: number; keepLast: number; keepMonthly: boolean }
  'backups:setConfig': SyncStatus
  'tasks:summary': { today: number; overdue: number }
  'briefs:templates': BriefTemplate[]
  'briefs:setTemplates': BriefTemplate[]
  'profile:get': Profile
  'profile:set': Profile
  'data:update': RecordRow
  'data:setLinks': RecordRow
  'data:duplicate': RecordRow
  'data:trash': void
  'data:restore': void
  'data:purge': void
  'data:trashList': { items: TrashItem[]; days: number }
  'data:setTrashDays': { items: TrashItem[]; days: number }
  'data:history': HistoryEntry[]
  'data:search': SearchHit[]
  'data:undo': string | null
  'data:redo': string | null
  'data:undoState': UndoState
  /** Ruta donde se guardó el CSV, o null si se canceló. */
  'data:exportCsv': string | null
}

export type IpcChannel = keyof typeof ipcSchemas
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcSchemas)[C]>
export type IpcParsedInput<C extends IpcChannel> = z.output<(typeof ipcSchemas)[C]>
export type IpcOutput<C extends IpcChannel> = IpcOutputs[C]

/** Eventos que el proceso principal envía a la interfaz. */
export interface IpcEvents {
  'vault:changed': VaultStatus
  'data:changed': DataChange
  'sync:changed': SyncStatus
}
export type IpcEvent = keyof IpcEvents
