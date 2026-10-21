import type { BooksService } from '../books/books-service'
import type { Platform } from '../platform'
import type { IpcHandlers } from './run'

type BooksChannel = Extract<keyof IpcHandlers, `books:${string}`>
export type BooksHandlers = Pick<IpcHandlers, BooksChannel>

/** Biblioteca y lector (fase 15, D-123). */
export function createBooksHandlers(
  books: BooksService,
  readerUrl: () => string,
  platform: Platform,
): BooksHandlers {
  return {
    'books:readerUrl': () => readerUrl(),
    'books:progressAll': () => books.allProgress(),
    'books:open': ({ recordId }) => books.open(recordId),
    'books:setProgress': (p) => books.setProgress(p),
    'books:finish': ({ recordId }) => books.finish(recordId),
    'books:saveSession': (s) => books.saveSession(s),
    'books:stats': () => books.stats(),
    'books:goal': () => books.goal(),
    'books:setGoal': (g) => books.setGoal(g),
    'books:prefs': ({ device }) => books.prefs(device),
    'books:setPrefs': ({ device, prefs }) => books.setPrefs(device, prefs),
    'books:readingMode': ({ on, volumeKeys }) => platform.readingMode?.({ on, volumeKeys }),
  }
}
