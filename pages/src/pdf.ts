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
    const paragraphs: string[] = []
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const { items } = await page.getTextContent()
      const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')
      paragraphs.push(text.replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1').replace(/\n/g, ' '))
      page.cleanup()
      if (index % 10 === 0 || index === pdf.numPages) progress(`Reading PDF page ${index} of ${pdf.numPages}…`)
    }
    return paragraphs.join('\n\n')
  } finally {
    await close()
  }
}
