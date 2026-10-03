import { app, dialog, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultService } from '../vault/vault-service'
import type { IpcHandlers } from './register'

type DataChannel = Extract<keyof IpcHandlers, `data:${string}` | `profile:${string}`>
export type DataHandlers = Pick<IpcHandlers, DataChannel>

/**
 * Canales del motor de datos. Todos pasan por `vault.data`, que lanza
 * VAULT_IS_LOCKED si la bóveda está bloqueada.
 */
export function createDataHandlers(
  vault: VaultService,
  getWindow: () => BrowserWindow | null,
): DataHandlers {
  const trashList = () => ({ items: vault.data.listTrash(), days: vault.data.trashDays() })

  return {
    'data:entities': () => vault.data.entities(),
    'data:fields': ({ entity, includeDeleted }) => vault.data.listFields(entity, includeDeleted),
    'data:createField': ({ entity, label, type, config }) =>
      vault.data.createField(entity, { label, type, ...(config ? { config } : {}) }),
    'data:updateField': ({ id, ...patch }) => vault.data.updateField(id, patch),
    'data:reorderFields': ({ entity, ids }) => vault.data.reorderFields(entity, ids),
    'data:deleteField': ({ id }) => vault.data.deleteField(id),
    'data:restoreField': ({ id }) => vault.data.restoreField(id),
    'data:formulaProblem': ({ entity, expression, fieldId }) => {
      const self = fieldId ? vault.data.getField(fieldId) : undefined
      return vault.data.formulaProblem(entity, expression, self?.id, self?.key)
    },

    'data:views': ({ entity }) => vault.data.listViews(entity),
    'data:createView': ({ entity, name, kind }) => vault.data.createView(entity, name, kind),
    'data:updateView': ({ id, name, config }) =>
      vault.data.updateView(id, {
        ...(name !== undefined ? { name } : {}),
        ...(config ? { config } : {}),
      }),
    'data:deleteView': ({ id }) => vault.data.deleteView(id),

    'data:query': ({ entity, ...opts }) => vault.data.query(entity, opts),
    'data:get': ({ id }) => vault.data.get(id),
    'data:create': ({ entity, values, title }) =>
      vault.data.create(entity, values, title ? { title } : {}),
    'data:createInverseField': ({ fieldId, label, multiple }) =>
      vault.data.createInverseField(fieldId, label, multiple),
    'profile:get': () => vault.data.getProfile(),
    'profile:set': (profile) => vault.data.setProfile(profile),
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
      const win = getWindow()
      const options: Electron.SaveDialogOptions = {
        title: 'Exportar a CSV',
        defaultPath: join(app.getPath('documents'), filename),
        buttonLabel: 'Exportar',
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      writeFileSync(result.filePath, csv, 'utf8')
      return result.filePath
    },
  }
}
