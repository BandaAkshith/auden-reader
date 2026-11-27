import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OutlineEntry } from './library'

export async function readPdfOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  const roots = await pdf.getOutline()
  const found: OutlineEntry[] = []
  if (!roots) return found

  async function walk(items: NonNullable<typeof roots>, depth: number) {
    for (const item of items) {
      if (item.dest) {
        try {
          const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
          const reference = destination?.[0]
          const page = Number.isInteger(reference) ? reference : reference ? await pdf.getPageIndex(reference) : -1
          const title = item.title.trim()
          if (page >= 0 && title) found.push({ title, sourcePage: page + 1, depth })
        } catch { /* Keep the rest of the outline if an individual link is broken. */ }
      }
      await walk(item.items, depth + 1)
    }
  }
  await walk(roots, 0)
  return found
}
