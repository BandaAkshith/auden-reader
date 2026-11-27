import type { Format, ImportedBook } from './library'
import { chapterIndices, looksLikeHeading } from './chapters'

const MAX_BYTES = 60 * 1024 * 1024
const MAX_TEXT = 12_000_000
const ALLOWED = new Set<string>(['PDF', 'EPUB', 'DOCX', 'TXT'])

function xml(text: string) {
  return new DOMParser().parseFromString(text, 'application/xml')
}

function elements(root: Document | Element, name: string) {
  return Array.from(root.getElementsByTagNameNS('*', name))
}

function epubPath(base: string, target: string) {
  const origin = 'https://epub.invalid'
  const result = new URL(target, origin + '/' + base)
  return result.origin === origin ? decodeURIComponent(result.pathname.slice(1)) : ''
}

async function archiveText(file: File, format: 'DOCX' | 'EPUB', headings: Set<string>) {
  const { unzip, strFromU8 } = await import('fflate')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let size = 0
  let oversized = false
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, { filter: item => {
      const wanted = format === 'DOCX'
        ? item.name === 'word/document.xml'
        : /\.(xml|opf|xhtml|html|htm)$/i.test(item.name)
      if (!wanted) return false
      size += item.originalSize
      oversized ||= size > MAX_BYTES
      return !oversized
    } }, (error, data) => error ? reject(error) : resolve(data))
  })
  if (oversized) throw new Error('This document exceeds the expanded import limit.')
  const read = (path: string) => entries[path] instanceof Uint8Array ? strFromU8(entries[path]) : ''
  if (format === 'DOCX') {
    return elements(xml(read('word/document.xml')), 'p')
      .map(paragraph => {
        const text = elements(paragraph, 't').map(run => run.textContent || '').join('')
        const style = elements(paragraph, 'pStyle')[0]
        const name = Array.from(style?.attributes || []).find(attribute => attribute.localName === 'val')?.value || ''
        if (/^heading/i.test(name)) headings.add(text.trim())
        return text
      })
      .join('\n\n')
  }
  const packagePath = elements(xml(read('META-INF/container.xml')), 'rootfile')[0]?.getAttribute('full-path')
  if (!packagePath) throw new Error('This EPUB has no readable package.')
  const book = xml(read(packagePath))
  const paths = new Map(elements(book, 'item').map(item => [item.id, item.getAttribute('href') || '']))
  return elements(book, 'itemref').map(item => {
    const href = paths.get(item.getAttribute('idref') || '')
    if (!href) return ''
    // Parse the XHTML for text only. Imported markup never enters the app DOM.
    const document = xml(read(epubPath(packagePath, href)).replace(/&nbsp;/g, '&#160;'))
    for (const tag of ['script', 'style', 'svg', 'nav']) {
      elements(document, tag).forEach(element => element.remove())
    }
    const body = elements(document, 'body')[0]
    if (!body) return ''
    const blocks = Array.from(body.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre'))
      .filter(block => !block.querySelector('p, li, blockquote, pre'))
    return blocks.length ? blocks.map(block => {
      const text = (block.textContent || '').trim()
      if (/^h[1-4]$/i.test(block.localName)) headings.add(text)
      return text
    }).join('\n\n') : body.textContent || ''
  }).join('\n\n')
}

function splitPassages(text: string) {
  const blocks = text.replace(/\r\n?/g, '\n').replace(/\0/g, '').split(/\n\s*\n/g)
    .flatMap(block => block.replace(/^.+$/gm, line => looksLikeHeading(line.trim()) ? '\n' + line.trim() + '\n' : line).split(/\n\s*\n/g))
  return blocks.flatMap(block => {
    const remaining = block.trim()
    if (!remaining) return []
    if (remaining.length <= 900) return [remaining]
    // Bound speech and rendering work even for single-line text and PDF pages.
    return remaining.match(/.{1,900}(?:\s|$)|.{1,900}/gs)!.map(part => part.trim()).filter(Boolean)
  })
}

export async function importBook(file: File, progress: (status: string) => void): Promise<ImportedBook> {
  const format = file.name.split('.').pop()?.toUpperCase() || ''
  if (!ALLOWED.has(format)) throw new Error('Choose a PDF, EPUB, DOCX, or TXT file.')
  if (file.size > MAX_BYTES) throw new Error('Files can be up to 60 MB.')
  const headings = new Set<string>()
  let text: string
  switch (format) {
    case 'PDF':
      text = await (await import('./pdf')).pdfText(file, progress)
      break
    case 'EPUB':
    case 'DOCX':
      text = await archiveText(file, format, headings)
      break
    default:
      text = await file.text()
  }
  if (text.length > MAX_TEXT) throw new Error('This document contains too much text for one import.')
  const passages = splitPassages(text)
  if (!passages.length) throw new Error(format === 'PDF'
    ? 'This PDF has no extractable text. Scanned pages need OCR before import.'
    : 'Auden could not find readable text in this document.')
  return {
    book: {
      id: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled document',
      format: format as Format, wordCount: text.trim().split(/\s+/).length,
      passageCount: passages.length, headings: chapterIndices(passages, headings), addedAt: Date.now(), cursor: 0, bookmarks: [], notes: [],
    },
    passages,
    original: format === 'PDF' ? file.slice(0, file.size, 'application/pdf') : undefined,
  }
}
