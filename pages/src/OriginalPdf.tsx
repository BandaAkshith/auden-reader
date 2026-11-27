import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { readOriginal } from './library'
import { loadPdf } from './pdf'

export default function OriginalPdf({ id, initialPage = 1 }: { id: string; initialPage?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [page, setPage] = useState(initialPage)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let document: Awaited<ReturnType<typeof loadPdf>> | undefined
    void (async () => {
      try {
        const file = await readOriginal(id)
        if (!file) throw new Error('The original PDF is unavailable.')
        document = await loadPdf(file)
        if (active) { setPdf(document.pdf); setPage(Math.min(initialPage, document.pdf.numPages)) }
        else await document.close()
      } catch {
        if (active) setError('Auden could not load the original PDF.')
      }
    })()
    return () => { active = false; if (document) void document.close() }
  }, [id, initialPage])

  useEffect(() => {
    if (!pdf) return
    let active = true
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    void (async () => {
      try {
        const sheet = await pdf.getPage(page)
        const target = canvas.current
        if (!target || !active) return
        const base = sheet.getViewport({ scale: 1 })
        const viewport = sheet.getViewport({ scale: Math.min(2, 1500 / Math.max(base.width, base.height)) })
        target.width = viewport.width
        target.height = viewport.height
        render = sheet.render({ canvas: target, viewport })
        await render.promise
      } catch {
        if (active) setError('Auden could not render this PDF page.')
      }
    })()
    return () => { active = false; render?.cancel() }
  }, [pdf, page])

  return <div className="reader-panel pdf-preview">
    {error ? <p role="alert">{error}</p> : !pdf ? <p role="status">Loading PDF…</p> : <nav className="page-controls" aria-label="Original PDF pages">
      <button className="secondary compact" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button>
      <span>Page {page} of {pdf.numPages}</span><button className="secondary compact" disabled={page === pdf.numPages} onClick={() => setPage(value => value + 1)}>Next</button>
    </nav>}
    <canvas ref={canvas} role="img" aria-label={`Original PDF page ${page}`} hidden={!pdf || Boolean(error)} />
  </div>
}
