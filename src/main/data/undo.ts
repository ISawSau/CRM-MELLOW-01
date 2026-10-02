import type { UndoState } from '@shared/data/records'

/**
 * Deshacer y rehacer (Ctrl+Z, Ctrl+Mayús+Z) de las acciones de la sesión.
 * Vive solo en memoria: al bloquear la bóveda se pierde, como en cualquier editor.
 */
export interface UndoEntry {
  label: string
  undo: () => void
  redo: () => void
}

const MAX_ENTRIES = 100

export class UndoStack {
  private done: UndoEntry[] = []
  private undone: UndoEntry[] = []

  push(entry: UndoEntry): void {
    this.done.push(entry)
    if (this.done.length > MAX_ENTRIES) this.done.shift()
    this.undone = []
  }

  /** Devuelve la etiqueta de lo deshecho, o null si no había nada. */
  undo(): string | null {
    const e = this.done.pop()
    if (!e) return null
    e.undo()
    this.undone.push(e)
    return e.label
  }

  redo(): string | null {
    const e = this.undone.pop()
    if (!e) return null
    e.redo()
    this.done.push(e)
    return e.label
  }

  state(): UndoState {
    return {
      canUndo: this.done.length > 0,
      canRedo: this.undone.length > 0,
      undoLabel: this.done.at(-1)?.label ?? null,
      redoLabel: this.undone.at(-1)?.label ?? null,
    }
  }

  clear(): void {
    this.done = []
    this.undone = []
  }
}
