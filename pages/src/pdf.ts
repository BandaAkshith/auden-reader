import { readPdfOutline } from './pdfOutline'
import { looksLikeHeading } from './chapters'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export async function loadPdf(file: Blob) {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    return { pdf: await task.promise, close: () => task.destroy() }
  } catch (error) {
    await task.destroy()
    throw error
  }
}

export async function pdfText(file: Blob, progress: (status: string) => void) {
  const { pdf, close } = await loadPdf(file)
  try {
    const pages: string[] = []
    let inContents = false
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const paragraphs: string[] = []
      const { items } = await page.getTextContent()
      const lines: { text: string; x: number; y: number; height: number }[] = []
      let line: typeof lines[number] | undefined
      for (const item of items) {
        if (!('str' in item)) continue
        const [, , , scale, x, y] = item.transform
        const height = Math.max(1, item.height || Math.abs(scale))
        if (!line || Math.abs(y - line.y) > Math.max(2, height * .45)) {
          line = { text: '', x, y, height }
          lines.push(line)
        }
        if (item.str) line.text += item.str + ' '
        if (item.hasEOL) line = undefined
      }
      const readable = lines.map(line => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
        .filter(line => line.text && !/^\d{1,4}$/.test(line.text))
      const contentsHeading = readable.some(line => /^(?:table of |detailed )?contents:?$/i.test(line.text))
      const contentsRows = readable.filter(line => /^(?:chapter|part|book)\s+\d+\s*[:.\-–—]|(?:\.{2,}|…)\s*\d+$/i.test(line.text)).length
      if (contentsHeading || contentsRows >= 3 || (inContents && contentsRows && readable.length <= contentsRows * 3)) {
        inContents = true
        // Preserve the original lines for the in-book contents view.
        paragraphs.push(readable.map(line => line.text).join('\n'))
      } else {
        inContents = false
        let pending = ''
        let last: typeof lines[number] | undefined
        const flush = () => {
          if (pending) paragraphs.push(pending)
          pending = ''
        }
        const left = Math.min(...readable.map(line => line.x))
        for (const row of readable) {
          if (looksLikeHeading(row.text)) {
            flush()
            paragraphs.push(row.text)
          } else {
            if (last && (last.y - row.y > Math.max(last.height, row.height) * 1.85 ||
              (row.x - left > row.height * .9 && last.x - left < row.height * .7))) flush()
            pending = pending.endsWith('-') && /^\p{Ll}/u.test(row.text)
              ? pending.slice(0, -1) + row.text : pending ? pending + ' ' + row.text : row.text
          }
          last = row
        }
        flush()
      }
      pages.push(paragraphs.join('\n\n'))
      page.cleanup()
      if (index % 10 === 0 || index === pdf.numPages) progress(`Reading PDF page ${index} of ${pdf.numPages}…`)
    }
    return { pages, outline: await readPdfOutline(pdf).catch(() => []) }
  } finally {
    await close()
  }
}

export async function pdfOutline(file: Blob) {
  const { pdf, close } = await loadPdf(file)
  try { return await readPdfOutline(pdf) }
  finally { await close() }
}
