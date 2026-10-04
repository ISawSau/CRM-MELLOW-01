import { closeSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { safeFileName } from '@shared/files'
import { t } from '@shared/i18n'
import { uiField, uiView } from '../data/data-service'
import type { Platform } from '../platform'
import type { VaultService } from '../vault/vault-service'
import type { IpcHandlers } from './run'

type DataChannel = Extract<
  keyof IpcHandlers,
  | `data:${string}`
  | `profile:${string}`
  | `tasks:${string}`
  | `briefs:${string}`
  | `home:${string}`
  | `files:${string}`
  | `timer:${string}`
  | `versions:${string}`
>
export type DataHandlers = Pick<IpcHandlers, DataChannel>

/**
 * Canales del motor de datos. Todos pasan por `vault.data`, que lanza
 * VAULT_IS_LOCKED si la bóveda está bloqueada.
 */
export function createDataHandlers(vault: VaultService, platform: Platform): DataHandlers {
  const trashList = () => ({ items: vault.data.listTrash(), days: vault.data.trashDays() })

  return {
    'data:entities': () => vault.data.entities(),
    'data:createCollection': (input) => vault.data.createCollection(input),
    'data:updateCollection': ({ id, ...input }) => vault.data.updateCollection(id, input),
    'data:deleteCollection': ({ id }) => vault.data.deleteCollection(id),
    // Campos y vistas salen con los textos de serie en el idioma activo (uiField, uiView).
    'data:fields': ({ entity, includeDeleted }) =>
      vault.data.listFields(entity, includeDeleted).map(uiField),
    'data:createField': ({ entity, label, type, config }) =>
      uiField(vault.data.createField(entity, { label, type, ...(config ? { config } : {}) })),
    'data:updateField': ({ id, ...patch }) => uiField(vault.data.updateField(id, patch)),
    'data:reorderFields': ({ entity, ids }) => vault.data.reorderFields(entity, ids).map(uiField),
    'data:deleteField': ({ id }) => vault.data.deleteField(id),
    'data:restoreField': ({ id }) => uiField(vault.data.restoreField(id)),
    'data:formulaProblem': ({ entity, expression, fieldId }) => {
      const self = fieldId ? vault.data.getField(fieldId) : undefined
      return vault.data.formulaProblem(entity, expression, self?.id, self?.key)
    },

    'data:views': ({ entity }) => vault.data.listViews(entity).map(uiView),
    'data:createView': ({ entity, name, kind }) =>
      uiView(vault.data.createView(entity, name, kind)),
    'data:updateView': ({ id, name, config }) =>
      uiView(
        vault.data.updateView(id, {
          ...(name !== undefined ? { name } : {}),
          ...(config ? { config } : {}),
        }),
      ),
    'data:deleteView': ({ id }) => vault.data.deleteView(id),

    'data:query': ({ entity, ...opts }) => vault.data.query(entity, opts),
    'data:get': ({ id }) => vault.data.get(id),
    'data:create': ({ entity, values, title }) =>
      vault.data.create(entity, values, title ? { title } : {}),
    'data:createInverseField': ({ fieldId, label, multiple }) =>
      uiField(vault.data.createInverseField(fieldId, label, multiple)),
    // Archivos: se eligen en el diálogo del sistema (la interfaz no puede pedir rutas).
    'files:pick': async () => {
      const paths = await platform.pickFiles({
        title: t('Añadir archivos a la bóveda'),
        buttonLabel: t('Añadir'),
      })
      return paths.length ? vault.data.importFiles(paths) : []
    },
    'files:upload': ({ name, data }) => vault.data.importBuffer(name, data),
    'files:info': ({ id }) => vault.data.fileInfo(id),
    'files:setMeta': ({ id, ...meta }) => vault.data.setFileMeta(id, meta),
    // Exportar es una acción explícita: el archivo descifrado va donde el usuario elija.
    'files:export': async ({ id, name }) => {
      if (!vault.data.fileInfo(id)) return null
      const path = await platform.saveAs({
        title: t('Guardar una copia del archivo'),
        defaultName: safeFileName(name),
        folder: 'downloads',
        buttonLabel: t('Guardar'),
      })
      if (!path) return null
      const fd = openSync(path, 'w')
      try {
        for (const chunk of vault.data.files.readRange(id)) writeSync(fd, chunk)
      } finally {
        closeSync(fd)
      }
      return platform.delivered(path)
    },
    'versions:list': ({ recordId }) => vault.data.listVersions(recordId),
    'versions:create': ({ recordId, note }) => vault.data.createVersion(recordId, note),
    'versions:restore': ({ versionId }) => vault.data.restoreVersion(versionId),
    'tasks:summary': () => vault.data.taskSummary(),
    'home:layout': () => vault.data.getHomeLayout(),
    'home:setLayout': ({ layout }) => vault.data.setHomeLayout(layout),
    'briefs:templates': () => vault.data.getBriefTemplates(),
    'briefs:setTemplates': ({ templates }) => vault.data.setBriefTemplates(templates),
    'briefs:createFromTemplate': ({ templateId, values }) =>
      vault.data.createBriefFromTemplate(templateId, values),
    'briefs:saveAsTemplate': ({ recordId, name }) => vault.data.saveBriefAsTemplate(recordId, name),
    'profile:get': () => vault.data.getProfile(),
    'profile:set': (profile) => vault.data.setProfile(profile),
    'profile:activity': () => vault.data.activity(),
    'timer:get': () => vault.data.getTimer(),
    'timer:start': (input) => vault.data.startTimer(input),
    'timer:stop': ({ discard }) => vault.data.stopTimer(discard),
    'data:update': ({ id, patch }) => vault.data.update(id, patch),
    'data:setLinks': ({ fieldId, fromId, toIds }) => vault.data.setLinks(fieldId, fromId, toIds),
    'data:duplicate': ({ id }) => vault.data.duplicate(id),
    'data:trash': ({ ids }) => vault.data.trash(ids),
    'data:restore': ({ ids }) => vault.data.restore(ids),
    'data:purge': ({ ids }) => vault.data.purge(ids),
    'data:trashList': ({ entity }) => ({
      items: vault.data.listTrash(entity),
      days: vault.data.trashDays(),
    }),
    'data:setTrashDays': ({ days }) => {
      vault.data.setTrashDays(days)
      return trashList()
    },
    'data:history': ({ id }) => vault.data.history(id),
    'data:search': ({ text, limit }) => vault.data.search(text, limit),
    'data:undo': () => vault.data.undo(),
    'data:redo': () => vault.data.redo(),
    'data:undoState': () => vault.data.undoState(),

    // Exportar es una acción explícita del usuario: el archivo va donde él elija.
    'data:exportCsv': async ({ viewId }) => {
      const { csv, filename } = vault.data.exportCsv(viewId)
      const path = await platform.saveAs({
        title: t('Exportar a CSV'),
        defaultName: filename,
        folder: 'documents',
        buttonLabel: t('Exportar'),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      })
      if (!path) return null
      writeFileSync(path, csv, 'utf8')
      return platform.delivered(path)
    },
  }
}
