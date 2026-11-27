import { strFromU8, strToU8, unzip, zip } from 'fflate'
import { listBooks, readOriginal, readPassages, storeBooks, type Book, type ImportedBook } from './library'

const limit = 160 * 1024 * 1024
const format = 'auden-browser-backup'
const bookId = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|auden-reading-room-sample)$/i

export async function exportBackup() {
  const files: Record<string, Uint8Array> = {}
  let size = 0
  const save = (path: string, bytes: Uint8Array) => {
    size += bytes.length
    if (size > limit) throw new Error('The library exceeds the 160 MiB backup limit.')
    files[path] = bytes
  }
  const books = await listBooks()
  for (const book of books) {
    const text = await readPassages(book.id)
    if (!text) throw new Error(`Could not read the saved text for ${book.title}.`)
    save(`books/${book.id}.json`, strToU8(JSON.stringify(text)))
    if (book.format === 'PDF') {
      const original = await readOriginal(book.id)
      if (original) save(`books/${book.id}.pdf`, new Uint8Array(await original.arrayBuffer()))
    }
  }
  save('manifest.json', strToU8(JSON.stringify({ format, version: 1, books })))
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 3 }, (error, archive) => error ? reject(error) : resolve(archive))
  })
}

function readBook(value: unknown, passages: unknown): Book {
  const book = value as Book
  const position = (index: number) => Number.isInteger(index) && index >= 0 && index < book.passageCount
  if (!book || typeof book.id !== 'string' || !bookId.test(book.id) ||
      typeof book.title !== 'string' || !book.title.trim() || book.title.length > 1024 ||
      !['PDF', 'EPUB', 'DOCX', 'TXT'].includes(book.format) ||
      !Number.isSafeInteger(book.addedAt) || book.addedAt < 0 ||
      (book.openedAt !== undefined && (!Number.isSafeInteger(book.openedAt) || book.openedAt < 0)) ||
      !Number.isSafeInteger(book.wordCount) || book.wordCount < 0 ||
      !Array.isArray(passages) || passages.length !== book.passageCount || !passages.length ||
      !passages.every(text => typeof text === 'string' && text.length <= 901 && text.trim()) ||
      !position(book.cursor) || (book.cursorOffset !== undefined && (!Number.isInteger(book.cursorOffset) || book.cursorOffset < 0 || book.cursorOffset >= passages[book.cursor].length)) ||
      !Array.isArray(book.bookmarks) || !book.bookmarks.every(position) ||
      (book.headings !== undefined && (!Array.isArray(book.headings) || !book.headings.every(position))) ||
      (book.outline !== undefined && (!Array.isArray(book.outline) || !book.outline.every(entry => entry &&
        typeof entry.title === 'string' && entry.title.length <= 2048 && Number.isInteger(entry.depth) && entry.depth >= 0 &&
        Number.isInteger(entry.sourcePage) && entry.sourcePage > 0 && (entry.index === undefined || position(entry.index))))) ||
      !Array.isArray(book.notes) || !book.notes.every(note => note && typeof note.id === 'string' &&
        typeof note.body === 'string' && note.body.length <= 4000 && position(note.cursor))) {
    throw new Error('The backup contains an invalid document or annotation.')
  }
  const { id, title, format, wordCount, passageCount, addedAt, openedAt, cursor, cursorOffset, bookmarks, notes, headings, outline } = book
  return { id, title, format, wordCount, passageCount, addedAt, openedAt, cursor, cursorOffset, bookmarks, notes, headings, outline }
}

export async function restoreBackup(file: File) {
  if (file.size > limit) throw new Error('The backup exceeds 160 MiB.')
  let size = 0
  let oversized = false
  const bytes = new Uint8Array(await file.arrayBuffer())
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: entry => {
      if (entry.name !== 'manifest.json' && !/^books\/[\w-]+\.(json|pdf)$/.test(entry.name)) return false
      size += entry.originalSize
      oversized ||= size > limit
      return !oversized
    } }, (error, data) => error ? reject(new Error('Choose a valid Auden browser backup ZIP.')) : resolve(data))
  })
  if (oversized) throw new Error('The expanded backup exceeds 160 MiB.')
  if (!files['manifest.json']) throw new Error('The backup manifest is missing.')
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  if (manifest?.format !== format || manifest.version !== 1 || !Array.isArray(manifest.books)) {
    throw new Error('This ZIP is not an Auden browser backup.')
  }

  const seen = new Set<string>()
  const entries: ImportedBook[] = manifest.books.map((data: Book) => {
    if (typeof data?.id !== 'string' || !bookId.test(data.id) || seen.has(data.id)) {
      throw new Error('The backup has an invalid or repeated document identifier.')
    }
    seen.add(data.id)
    const saved = files[`books/${data.id}.json`]
    const passages = saved && JSON.parse(strFromU8(saved))
    const book = readBook(data, passages)
    const pdf = files[`books/${book.id}.pdf`]
    if (pdf && (book.format !== 'PDF' || pdf.length > 60 * 1024 * 1024)) {
      throw new Error('The backup contains an invalid PDF.')
    }
    return { book, passages, original: pdf ? new Blob([Uint8Array.from(pdf)], { type: 'application/pdf' }) : undefined }
  })
  const added = await storeBooks(entries, true)
  return { added, skipped: entries.length - added.length }
}
