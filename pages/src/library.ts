import { profile } from './accounts'

export type Format = 'PDF' | 'EPUB' | 'DOCX' | 'TXT'

export type OutlineEntry = { title: string; sourcePage: number; depth: number; index?: number }

export type Book = {
  id: string
  title: string
  format: Format
  wordCount: number
  passageCount: number
  addedAt: number
  openedAt?: number
  cursor: number
  cursorOffset?: number
  bookmarks: number[]
  headings?: number[]
  outline?: OutlineEntry[]
  notes: { id: string; cursor: number; body: string }[]
}

export type ImportedBook = { book: Book; passages: string[]; original?: Blob }

let database: Promise<IDBDatabase> | undefined

function openLibrary() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(profile ? `auden-pages-library:${profile.id}` : 'auden-pages-library', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('books', { keyPath: 'id' })
      db.createObjectStore('texts')
      db.createObjectStore('originals')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = undefined }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  }).catch(error => { database = undefined; throw error })
  return database!
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function committed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function listBooks(): Promise<Book[]> {
  const db = await openLibrary()
  return result(db.transaction('books').objectStore('books').getAll())
}

export async function readPassages(id: string): Promise<string[] | undefined> {
  const db = await openLibrary()
  return result(db.transaction('texts').objectStore('texts').get(id))
}

export async function readOriginal(id: string): Promise<Blob | undefined> {
  const db = await openLibrary()
  return result(db.transaction('originals').objectStore('originals').get(id))
}

export async function storeBooks(entries: ImportedBook[], skipExisting = false) {
  const db = await openLibrary()
  const transaction = db.transaction(['books', 'texts', 'originals'], 'readwrite')
  const done = committed(transaction)
  const books = transaction.objectStore('books')
  const added: Book[] = []

  for (const { book, passages, original } of entries) {
    const insert = () => {
      books.add(book)
      transaction.objectStore('texts').add(passages, book.id)
      if (original) transaction.objectStore('originals').add(original, book.id)
      added.push(book)
    }
    if (skipExisting) {
      const existing = books.getKey(book.id)
      existing.onsuccess = () => { if (existing.result === undefined) insert() }
    } else insert()
  }
  await done
  return added
}

export function storeBook(entry: ImportedBook) {
  return storeBooks([entry])
}

export async function updateBook(id: string, patch: Partial<Pick<Book, 'cursor' | 'cursorOffset' | 'openedAt' | 'bookmarks' | 'notes'>>) {
  const db = await openLibrary()
  const transaction = db.transaction('books', 'readwrite')
  const done = committed(transaction)
  const store = transaction.objectStore('books')
  const request = store.get(id)
  request.onsuccess = () => {
    const book = request.result as Book | undefined
    if (book) store.put({ ...book, ...patch })
  }
  return done
}

export async function removeBook(id: string) {
  const db = await openLibrary()
  const stores = ['books', 'texts', 'originals']
  const transaction = db.transaction(stores, 'readwrite')
  const done = committed(transaction)
  for (const store of stores) transaction.objectStore(store).delete(id)
  return done
}
