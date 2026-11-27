import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, List, Maximize2, Minimize2, Pencil, ChevronLeft, ChevronRight, FileText, Headphones, LibraryBig, LockKeyhole, Pause, Play, Plus, Search, Square, StickyNote, Timer, Trash2, Upload, X, Moon, Sun, RotateCcw, SkipForward } from 'lucide-react'
import { importBook } from './importBook'
import { listBooks, readOriginal, readPassages, removeBook, storeBook, updateBook, type Book, type OutlineEntry } from './library'
import { sample } from './sample'
import { useNarration, type Position } from './useNarration'
import { bookStructure, paginate, splitSentences, type PageFragment } from './readingLayout'
import { naturalVoices, type NaturalVoice } from './voiceCatalog'
import { usePreference } from './readerPreferences'
import { dayKey, loadInsights, summarizeInsights, useReadingSession } from './insights'

const OriginalPdf = lazy(() => import('./OriginalPdf'))
const wordCount = new Intl.NumberFormat()
const covers = ['ocean', 'rose', 'moss', 'ocher']
const tone = (title: string) => covers[Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0) % covers.length]

function completion(book: Book) {
  return book.passageCount ? Math.min(100, Math.round((book.cursor + 1) / book.passageCount * 100)) : 0
}

function Surface({ title, format, className = '' }: { title: string; format: string; className?: string }) {
  return <div className={`cover ${tone(title)} ${className}`}>
    <span>{format}</span><div className="cover-orbit" aria-hidden="true" />
    <BookOpen size={21} aria-hidden="true" strokeWidth={1.15} />
    <strong>{title}</strong>
  </div>
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: string | number) {
  const text = String(value)
  return `"${(/^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`
}

export function App() {
  const [dark, setDark] = usePreference<boolean>('dark-mode', false)
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const [books, setBooks] = useState<Book[]>([])
  const [loaded, setLoaded] = useState(false)
  const [active, setActive] = useState<{ id: string; passages: string[] }>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [drop, setDrop] = useState(false)
  const [removing, setRemoving] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const started = useRef(false)

  useEffect(() => {
    let current = true
    listBooks().then(items => { if (current) setBooks(items) })
      .catch(() => { if (current) setError('This browser could not open Auden’s library storage.') })
      .finally(() => { if (current) setLoaded(true) })
    return () => { current = false }
  }, [])

  const selected = books.find(book => book.id === active?.id)
  const recent = books.filter(book => book.openedAt)
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))[0]
  const filtered = books.filter(book => `${book.title} ${book.format}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title)
      : sort === 'format' ? a.format.localeCompare(b.format) || a.title.localeCompare(b.title)
        : (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt))

  async function patch(id: string, changes: Parameters<typeof updateBook>[1]) {
    try {
      await updateBook(id, changes)
      setBooks(items => items.map(item => item.id === id ? { ...item, ...changes } : item))
      return true
    } catch {
      setError('Auden could not save your changes in this browser.')
      return false
    }
  }

  async function open(book: Book, passages?: string[]) {
    const text = passages || await readPassages(book.id)
    if (!text?.length) throw new Error('The saved document text is unavailable.')
    setActive({ id: book.id, passages: text })
    void patch(book.id, { openedAt: Date.now() })
    window.scrollTo(0, 0)
  }

  async function openSaved(book: Book) {
    setError('')
    try { await open(book) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the document.') }
  }

  async function add(files: File[]) {
    if (!files.length || started.current) return
    started.current = true
    setBusy(true)
    setError('')
    const failures: string[] = []
    let added = 0
    try {
      for (const file of files) {
        setStatus(`Importing ${file.name}…`)
        try {
          const entry = await importBook(file, setStatus)
          await storeBook(entry)
          setBooks(items => [...items, entry.book])
          added++
          if (files.length === 1) await open(entry.book, entry.passages)
        } catch (cause) {
          failures.push(`${file.name} · ${cause instanceof Error ? cause.message : 'Import failed.'}`)
        }
      }
      setStatus(added ? `${added} ${added === 1 ? 'document' : 'documents'} added.` : '')
      setError(failures.join('\n'))
    } finally {
      setBusy(false)
      started.current = false
    }
  }

  async function openSample() {
    if (started.current || !loaded) return
    started.current = true
    try {
      const existing = books.find(book => book.id === sample.book.id)
      if (existing) { await open(existing); return }
      await storeBook(sample)
      setBooks(items => [...items, sample.book])
      await open(sample.book, sample.passages)
    } catch {
      setError('Could not open the sample. Check that browser storage is available.')
    } finally {
      started.current = false
    }
  }

  async function remove(book: Book) {
    try {
      await removeBook(book.id)
      setBooks(items => items.filter(item => item.id !== book.id))
      setRemoving('')
      setStatus(`Removed ${book.title}.`)
    } catch {
      setError('Auden could not remove this document.')
    }
  }

  async function backup(file?: File) {
    if (started.current) return
    started.current = true
    setBusy(true)
    setError('')
    setStatus(file ? 'Restoring library backup…' : 'Preparing library backup…')
    try {
      const { exportBackup, restoreBackup } = await import('./backup')
      if (file) {
        const { added, skipped } = await restoreBackup(file)
        setBooks(items => [...items, ...added])
        setStatus(`Restored ${added.length} · skipped ${skipped} already in your library.`)
      } else {
        download(`auden-library-${dayKey()}.zip`, Uint8Array.from(await exportBackup()), 'application/zip')
        setStatus('Library backup exported.')
      }
    } catch (cause) {
      setStatus('')
      setError(cause instanceof Error ? cause.message : 'The backup could not be processed.')
    } finally {
      setBusy(false)
      started.current = false
    }
  }

  function exportHistory() {
    const { totals, daily } = summarizeInsights(loadInsights())
    const rows = [
      ['Record type', 'Date', 'Title', 'Format', 'Words', 'Current passage', 'Passages', 'Last opened', 'Reading seconds'],
      ...books.map(book => ['Book', '', book.title, book.format, book.wordCount, book.openedAt ? book.cursor + 1 : 0, book.passageCount, book.openedAt ? new Date(book.openedAt).toISOString() : '', totals.get(book.id) || 0]),
      ...Array.from(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, seconds]) => ['Day', date, '', '', '', '', '', '', seconds]),
    ]
    download('auden-reading-history.csv', '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  }

  return <div className="shell">
    <header className="masthead">
      <button className="brand" onClick={() => { setActive(undefined); setError('') }}><span className="brand-mark"><BookOpen size={21} strokeWidth={1.6} /></span>Auden</button>
      <div className="masthead-end"><span><LockKeyhole size={14} /> Device library</span>
        <button className="icon-button theme-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} onClick={() => setDark(!dark)}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
        <button className="primary compact" disabled={busy || !loaded} onClick={() => input.current?.click()}><Plus size={17} /> Import<span className="wide-only"> documents</span></button></div>
      <input ref={input} type="file" aria-label="Import documents" accept=".pdf,.epub,.docx,.txt" multiple hidden onChange={event => {
        const files = Array.from(event.currentTarget.files || [])
        event.currentTarget.value = ''
        void add(files)
      }} />
    </header>
    <main className="workspace">
      {error && <div className="notice error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}
      {status && (!selected || busy) && <div className="notice" role="status"><span>{status}</span>{!busy && <button className="icon-button" aria-label="Dismiss status" onClick={() => setStatus('')}><X size={17} /></button>}</div>}
      {selected && active ? <Reader key={selected.id} book={selected} passages={active.passages} dark={dark} toggleTheme={() => setDark(!dark)} save={changes => patch(selected.id, changes)} onBack={() => { setActive(undefined); setStatus(''); window.scrollTo(0, 0) }} />
        : <>
          <section className="hero" aria-labelledby="welcome">
            <div className="hero-copy"><span className="kicker"><span /> Your reading room</span>
              <h1 id="welcome">Make time<br />for <em>reading.</em></h1>
              <p>Bring a document, pick up where you left off, or let Auden read the next passage aloud.</p>
              {recent ? <button className="primary" onClick={() => void openSaved(recent)}>Continue reading <ArrowRight size={17} /></button>
                : <button className="primary" disabled={!loaded} onClick={() => void openSample()}>Read a sample <ArrowRight size={17} /></button>}
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" />
              <div className="art-book back"><div /></div><div className="art-book front"><BookOpen size={26} strokeWidth={1.25} /><div /><i /></div>
            </div>
          </section>
          <ReadingInsights books={books} />
          <section className="library" aria-labelledby="library-heading">
            <div className="library-heading"><div><span className="kicker"><LibraryBig size={15} /> Collection</span><h2 id="library-heading">Your library <span>{books.length}</span></h2></div>
              <button className="secondary compact" onClick={exportHistory} disabled={books.length === 0}><ArrowDownToLine size={16} /> Export history</button></div>
            <div className="library-tools">
              <label className="search"><Search size={18} /><input aria-label="Search library" placeholder="Search by title or format" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <select aria-label="Sort library" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Recently opened</option><option value="title">Title A–Z</option><option value="format">File format</option></select>
            </div>
            {!loaded ? <p>Opening your library…</p> : filtered.length ? <div className="book-grid">{filtered.map(book => (
              <article className="book-card" key={book.id}>
                <button className="book-open" aria-label={`Open ${book.title}`} onClick={() => void openSaved(book)}><Surface title={book.title} format={book.format} />
                  <span className="book-meta"><strong>{book.title}</strong><small>{wordCount.format(book.wordCount)} words · {book.openedAt ? `${completion(book)}% read` : 'Unopened'}</small></span></button>
                {removing === book.id ? <div className="remove-row"><span>Remove from this library?</span><button onClick={() => void remove(book)}>Remove</button><button onClick={() => setRemoving('')}>Cancel</button></div>
                  : <button className="icon-button remove" aria-label={`Remove ${book.title}`} onClick={() => setRemoving(book.id)}><Trash2 size={16} /></button>}
              </article>
            ))}</div> : query.trim() ? <p className="empty">No documents match your search.</p> :
              <div className={`drop-area ${drop ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDrop(true) }} onDragLeave={() => setDrop(false)} onDrop={event => {
                event.preventDefault(); setDrop(false); void add(Array.from(event.dataTransfer.files))
              }}>
                <span className="empty-icon"><FileText size={24} strokeWidth={1.4} /></span><strong>Drop in something to read</strong><p>PDF, EPUB, DOCX, or TXT · up to 60 MB each</p>
                <button className="secondary compact" disabled={busy} onClick={() => input.current?.click()}><Plus size={16} /> Choose files</button>
              </div>}
          </section>
          <details className="library-backup">
            <summary>Library backup</summary>
            <p>Keep a ZIP of your documents, original PDFs, notes, bookmarks, and saved positions. Restore adds documents missing from this browser library.</p>
            <div className="note-tools">
              <button className="secondary compact" disabled={busy || !books.length} onClick={() => void backup()}><ArrowDownToLine size={16} /> Download backup</button>
              <button className="secondary compact" disabled={busy || !loaded} onClick={() => backupInput.current?.click()}><Upload size={16} /> Restore backup</button>
            </div>
            <input ref={backupInput} type="file" accept=".zip,application/zip" hidden onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void backup(file)
            }} />
          </details>
        </>}
      <footer><BookOpen size={15} /> Auden <span>Documents, notes, and progress are stored in this browser.</span></footer>
    </main>
  </div>
}

function ReadingInsights({ books }: { books: Book[] }) {
  const [activity, setActivity] = useState(loadInsights)
  useEffect(() => {
    const refresh = () => setActivity(loadInsights())
    window.addEventListener('auden-reading-activity', refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => {
      window.removeEventListener('auden-reading-activity', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  const { seconds, sessions, daily, totals } = summarizeInsights(activity)
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + index - 6)
    return { date, seconds: daily.get(dayKey(date)) || 0 }
  })
  const peak = Math.max(60, ...week.map(day => day.seconds))
  const mostRead = books.filter(book => totals.has(book.id)).sort((a, b) => totals.get(b.id)! - totals.get(a.id)!)[0]
  const duration = (value: number) => value >= 3600
    ? `${Math.floor(value / 3600)} h ${Math.floor(value % 3600 / 60)} min`
    : value >= 60 ? `${Math.floor(value / 60)} min` : `${value} sec`
  return <section className="insights" aria-labelledby="insights-heading">
    <div>
      <h2 id="insights-heading">Reading insights</h2>
      <div className="insight-totals">
        <span><strong>{duration(week[6].seconds)}</strong> Today</span>
        <span><strong>{duration(seconds)}</strong> Total time</span>
        <span><strong>{sessions}</strong> Sessions</span>
        <span><strong>{daily.size}</strong> Active days</span>
      </div>
      {mostRead && <p>Most read · {mostRead.title}</p>}
    </div>
    <ul className="insights-week" aria-label="Reading activity over the past seven days">
      {week.map(day => <li key={dayKey(day.date)} aria-label={`${day.date.toLocaleDateString(undefined, { weekday: 'long' })}: ${duration(day.seconds)}`}>
        <span aria-hidden="true" className="insight-track"><i style={{ height: `${day.seconds / peak * 100}%` }} /></span>
        <span aria-hidden="true">{day.date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
      </li>)}
    </ul>
  </section>
}

const layouts = ['single', 'spread', 'scroll'] as const
const papers = ['match', 'parchment', 'white', 'night', 'contrast'] as const
const typefaces = ['literary', 'classic', 'system', 'clean'] as const

function Reader({ book, passages, dark, toggleTheme, save, onBack }: {
  book: Book; passages: string[]; dark: boolean; toggleTheme: () => void; save: (changes: Parameters<typeof updateBook>[1]) => Promise<boolean>; onBack: () => void
}) {
  const [position, setPosition] = useState<Position>({ index: Math.min(book.cursor, passages.length - 1), offset: book.cursorOffset || 0 })
  const cursor = position.index
  useReadingSession(book.id)
  const [panel, setPanel] = useState<'search' | 'notes' | 'original' | 'contents' | null>(null)
  const [query, setQuery] = useState('')
  const [chapterFilter, setChapterFilter] = useState('')
  const [loadedOutline, setLoadedOutline] = useState<OutlineEntry[]>()
  const [sourcePage, setSourcePage] = useState(1)
  const [pageDraft, setPageDraft] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState<{ cursor: number; id?: string }>()
  const [message, setMessage] = useState('')
  const [font, setFont] = usePreference<number>('font-size', 20, [17, 20, 25, 31])
  const [paper, setPaper] = usePreference('paper', 'match' as typeof papers[number], papers)
  const previousTheme = useRef(dark)
  useEffect(() => {
    if (previousTheme.current !== dark) { previousTheme.current = dark; setPaper('match') }
  }, [dark, setPaper])
  const [layout, setLayout] = usePreference('layout', 'single' as typeof layouts[number], layouts)
  const [typeface, setTypeface] = usePreference('typeface', 'literary' as typeof typefaces[number], typefaces)
  const [spacing, setSpacing] = usePreference<number>('line-spacing', 1.65, [1.45, 1.65, 1.9, 2.2])
  const [follow, setFollow] = usePreference<boolean>('follow-narration', true)
  const [focused, setFocused] = useState(false)
  const [collapsed, setCollapsed] = usePreference<boolean>('compact-audio-player', true)
  const [appearance, setAppearance] = useState(false)
  const [turn, setTurn] = useState<{ from: number; to: number; columns: number; leaves: PageFragment[][]; forward: boolean; id: number }>()
  const turnId = useRef(0)
  const lastSwipe = useRef(-Infinity)
  const swipeStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const [scrollTarget, setScrollTarget] = useState({ index: cursor })
  const text = useRef<HTMLDivElement>(null)
  const reader = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(700)
  const trackUntil = useRef(0)
  const structure = useMemo(() => bookStructure(passages, book.headings), [book.headings, passages])
  const chapters = useMemo(() => [...structure.opening], [structure])
  useEffect(() => {
    if (panel !== 'contents' || book.format !== 'PDF' || book.outline || loadedOutline) return
    let active = true
    void (async () => {
      const file = await readOriginal(book.id)
      const outline = file ? await (await import('./pdf')).pdfOutline(file) : []
      if (active) setLoadedOutline(outline)
    })().catch(() => { if (active) setLoadedOutline([]) })
    return () => { active = false }
  }, [book.format, book.id, book.outline, loadedOutline, panel])

  const outline = book.outline || loadedOutline
  const contents = useMemo(() => {
    if (!outline?.length) return chapters.map(([index, title]) => ({ title, index, depth: 0, sourcePage: undefined }))
    const byTitle = new Map(chapters.map(([index, title]) => [title.toLocaleLowerCase().replace(/\s+/g, ' '), index]))
    return outline.map(entry => ({ ...entry,
      index: byTitle.get(entry.title.toLocaleLowerCase().replace(/\s+/g, ' ')) ?? structure.targetFor(entry.title) ?? entry.index,
    }))
  }, [outline, chapters, structure])

  const pageColumns = layout === 'spread' && width >= 570 ? 2 : 1
  const sectionSize = 40
  useEffect(() => {
    if (!reader.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    observer.observe(reader.current)
    return () => observer.disconnect()
  }, [])
  const leafWidth = pageColumns === 2 ? width / 2 : Math.min(670, width)
  const leafMargin = Math.max(24, Math.min(64, leafWidth * .091))
  const paperHeight = Math.max(505, Math.min(785, Math.round(leafWidth * 1.36)))
  const characters = Math.max(14, Math.floor((leafWidth - leafMargin * 2 - 8) / (font * (typeface === 'system' ? .53 : .51))))
  const lines = Math.max(8, Math.floor((paperHeight - 114) / (font * spacing)))
  const pages = useMemo(() => paginate(passages, structure, characters, lines), [characters, lines, passages, structure])
  const leaf = pages.pageAt(cursor, position.offset)
  const page = layout === 'scroll' ? Math.floor(cursor / sectionSize) : Math.floor(leaf / pageColumns)
  const pageCount = layout === 'scroll' ? Math.ceil(passages.length / sectionSize) : Math.ceil(pages.leaves.length / pageColumns)
  const currentChapter = chapters.reduce<number | undefined>((current, [index]) => index <= cursor ? index : current, undefined)
  const nextChapter = chapters.find(([index]) => index > cursor)?.[0]
  const pageTurn = turn?.to === page && turn.leaves === pages.leaves && turn.columns === pageColumns &&
    layout !== 'scroll' && panel !== 'original' ? turn : undefined
  useEffect(() => {
    if (!turn) return
    const timeout = window.setTimeout(() => setTurn(current => current === turn ? undefined : current), 720)
    return () => window.clearTimeout(timeout)
  }, [turn])
  const first = page * sectionSize
  const speakingPosition = useRef<Position | null>(null)
  const searchIndex = useMemo(() => passages.map(passage => passage.toLocaleLowerCase()), [passages])
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return []
    return searchIndex.reduce<number[]>((hits, value, index) => {
      if (value.includes(term) && hits.length < 100) hits.push(index)
      return hits
    }, [])
  }, [query, searchIndex])

  function go(index: number, scroll = true, offset = 0, persist = true) {
    const next = Math.max(0, Math.min(index, passages.length - 1))
    setPosition({ index: next, offset })
    if (scroll) setScrollTarget({ index: next })
    if (persist) void save({ cursor: next, cursorOffset: offset })
  }

  const narration = useNarration(passages, point => {
    speakingPosition.current = point
    if (follow) go(point.index, true, point.offset)
    else void save({ cursor: point.index, cursorOffset: point.offset })
  }, setMessage, index => structure.printedPassages.has(index) || index === structure.printed, nextChapter)

  function jump(index: number, offset = 0) {
    // Page turns and chapter browsing leave an active audiobook running.
    go(index, true, offset, narration.state === 'idle')
  }

  function openPage(target: number) {
    if (!Number.isInteger(target) || target === page || target < 0 || target >= pageCount) return
    setPageDraft('')
    if (layout === 'scroll') jump(target * sectionSize)
    else {
      const fragment = pages.leaves[target * pageColumns][0]
      if (Math.abs(target - page) === 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTurn({ from: page, to: target, columns: pageColumns, leaves: pages.leaves, forward: target > page, id: ++turnId.current })
      } else setTurn(undefined)
      jump(fragment.index, fragment.from)
      if (text.current && text.current.getBoundingClientRect().top < 20) text.current.scrollIntoView({ block: 'start' })
    }
  }

  function listenHere(index: number, offset = 0) {
    if (performance.now() - lastSwipe.current < 350 || window.getSelection()?.toString().trim()) return
    narration.play({ index, offset })
  }

  useEffect(() => {
    if (layout === 'scroll' || panel === 'original') return
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey ||
        (event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea, a, [role="button"]'))) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        openPage(page + (event.key === 'ArrowRight' ? 1 : -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, panel, page, pageCount, pages, narration.stop])

  useEffect(() => {
    trackUntil.current = 0
    if (layout !== 'scroll') return
    text.current?.querySelector(`[data-position="${scrollTarget.index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [scrollTarget, layout, panel])

  useEffect(() => {
    if (follow && layout === 'scroll' && narration.state === 'playing' && narration.boundary) {
      text.current?.querySelector('mark')?.scrollIntoView({ block: 'nearest' })
    }
  }, [follow, layout, narration.boundary, narration.state])

  useEffect(() => {
    if (!focused) return
    function leave(event: KeyboardEvent) { if (event.key === 'Escape') setFocused(false) }
    window.addEventListener('keydown', leave)
    return () => window.removeEventListener('keydown', leave)
  }, [focused])

  useEffect(() => {
    if (layout !== 'scroll' || narration.state !== 'idle' || panel === 'original') return
    let frame = 0
    function enableTracking() { trackUntil.current = performance.now() + 750 }
    function trackKeys(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && event.target.closest('button, input, select, textarea, a')) return
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) enableTracking()
    }
    function track() {
      if (performance.now() > trackUntil.current) return
      enableTracking()
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const visible = Array.from(text.current?.querySelectorAll<HTMLElement>('[data-position]') || [])
        const target = visible.find(item => item.getBoundingClientRect().bottom > 120)
        const next = target ? Number(target.dataset.position) : cursor
        if (next !== cursor && target && target.getBoundingClientRect().top < window.innerHeight * .6) go(next, false)
      })
    }
    window.addEventListener('scroll', track, { passive: true })
    window.addEventListener('wheel', enableTracking, { passive: true })
    window.addEventListener('touchmove', enableTracking, { passive: true })
    window.addEventListener('keydown', trackKeys)
    return () => {
      window.removeEventListener('scroll', track)
      window.removeEventListener('wheel', enableTracking)
      window.removeEventListener('touchmove', enableTracking)
      window.removeEventListener('keydown', trackKeys)
      window.cancelAnimationFrame(frame)
    }
  }, [layout, narration.state, panel, cursor])

  function togglePanel(value: typeof panel) {
    setPanel(current => current === value ? null : value)
  }

  function bookmark() {
    const exists = book.bookmarks.includes(cursor)
    const bookmarks = exists ? book.bookmarks.filter(item => item !== cursor) : [...book.bookmarks, cursor].sort((a, b) => a - b)
    void save({ bookmarks })
    setMessage(exists ? 'Bookmark removed.' : `Bookmarked passage ${cursor + 1}.`)
  }

  async function saveNote() {
    const body = note.trim()
    if (!body) return
    const next = draft?.id
      ? book.notes.map(item => item.id === draft.id ? { ...item, body } : item)
      : [...book.notes, { id: crypto.randomUUID(), cursor: draft?.cursor ?? cursor, body }]
    if (!await save({ notes: next })) return
    setNote('')
    setDraft(undefined)
    setMessage('Note saved.')
  }

  function renderPassage({ index, from: fragmentStart, to: fragmentEnd, rows }: PageFragment, interactive = true) {
    const passage = passages[index]
    const key = index + ':' + fragmentStart
    const tocRows = structure.printedPassages.get(index)
    if (tocRows) return <ul className="printed-contents" key={key} data-position={index}>
      {(rows ? tocRows.slice(...rows) : tocRows).map((row, i) => {
        const target = structure.targetFor(row)
        return <li key={i}>{interactive && target !== undefined
          ? <button onClick={() => jump(target)}>{row}</button>
          : <span>{row}</span>}</li>
      })}
    </ul>
    if (index === structure.printed) return <h2 key={key} className="chapter-opening" data-position={index}>{passage}</h2>

    const Element = structure.opening.has(index) ? 'h2' : 'p'
    const boundary = interactive && index === speakingPosition.current?.index ? narration.boundary : null
    const current = index === cursor && fragmentStart <= position.offset && position.offset < fragmentEnd
    return <Element key={key} className={Element === 'h2' ? 'chapter-opening' : 'book-paragraph'} data-position={index} aria-current={current ? 'location' : undefined}>
      {!interactive ? passage.slice(fragmentStart, fragmentEnd) : splitSentences(passage).flatMap(sentence => {
        const from = Math.max(fragmentStart, sentence.offset)
        const to = Math.min(fragmentEnd, sentence.offset + sentence.text.length)
        if (to <= from) return []
        const displayed = passage.slice(from, to)
        const markStart = boundary && Math.max(from, boundary.start)
        const markEnd = boundary && Math.min(to, boundary.end)
        return <span key={from} className="read-sentence" role="button" tabIndex={0} title="Listen from here"
          onClick={() => listenHere(index, from)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); listenHere(index, from) }
          }}>{boundary && markStart < markEnd
            ? <>{passage.slice(from, markStart)}<mark>{passage.slice(markStart, markEnd)}</mark>{passage.slice(markEnd, to)}</>
            : displayed}</span>
      })}
    </Element>
  }

  const pageNavigation = (label: string, quick = false) => <nav className={`page-controls ${quick ? 'quick-pages' : ''}`} aria-label={label}>
    <button className="secondary compact" disabled={page === 0} onClick={() => openPage(page - 1)}><ChevronLeft size={16} /> Previous</button>
    <label className="position-slider"><span>{layout === 'scroll' ? 'Section' : pageColumns === 2 ? 'Spread' : 'Page'} {page + 1} of {pageCount}</span>
      {pageCount > 1 && <input type="range" aria-label={quick ? 'Quick jump to page' : 'Jump to page'} min={1} max={pageCount} value={page + 1} onChange={event => openPage(Number(event.target.value) - 1)} />}
    </label>
    {quick && pageCount > 1 && <form className="page-jump" onSubmit={event => {
      event.preventDefault()
      if (pageDraft) openPage(Number(pageDraft) - 1)
    }}><input type="number" min={1} max={pageCount} value={pageDraft} placeholder={String(page + 1)} aria-label="Page number" onChange={event => setPageDraft(event.target.value)} />
      <button className="secondary compact" type="submit" disabled={!pageDraft}>Go</button></form>}
    <button className="secondary compact" disabled={page + 1 >= pageCount} onClick={() => openPage(page + 1)}>Next <ChevronRight size={16} /></button>
  </nav>

  function renderLeaf(number: number, interactive = true) {
    const fragments = pages.leaves[number]
    if (!fragments) return null
    return <article className="book-leaf" key={number} aria-label={`Page ${number + 1}`}>
      <div className="leaf-content">{fragments.map(fragment => renderPassage(fragment, interactive))}</div>
      <div className="leaf-folio"><span>{book.title}</span><span>{number + 1}</span></div>
    </article>
  }

  function renderPageTurn() {
    if (!pageTurn) return null
    const { from, to, forward, id, columns } = pageTurn
    const spread = columns === 2
    const oldLeaf = from * columns
    const newLeaf = to * columns
    const cover = (number: number) => renderLeaf(number, false) || <div className="book-endpaper" />
    const turningLeaf = spread ? oldLeaf + (forward ? 1 : 0) : forward ? oldLeaf : newLeaf
    const behindLeaf = spread ? oldLeaf + (forward ? 0 : 1) : oldLeaf
    const otherFace = newLeaf + (forward ? 0 : 1)
    return <div className={`page-turn ${spread ? 'spread-turn' : 'single-turn'} ${forward ? 'turning-forward' : 'turning-back'}`}
      key={id} aria-hidden="true" inert>
      {(spread || !forward) && <div className="turn-underlay">{cover(behindLeaf)}</div>}
      <div className="turn-sheet" onAnimationEnd={event => {
        if (event.target === event.currentTarget) setTurn(current => current?.id === id ? undefined : current)
      }}>
        <div className="turn-face turn-front">{cover(turningLeaf)}</div>
        {spread && <div className="turn-face turn-back">{cover(otherFace)}</div>}
      </div>
    </div>
  }

  const preparing = narration.state === 'loading' || narration.state === 'buffering'
  const actionName = narration.state === 'playing' || preparing ? 'Pause' : narration.state === 'paused' ? 'Resume' : 'Listen'
  const clipSeconds = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
  return <section className={`reader ${layout === "spread" ? "wide-reader" : ""} ${focused ? "reader-focused" : ""}`} aria-label="Document reader" ref={reader}>
    <button className="back" onClick={onBack}><ArrowLeft size={17} /> Back to library</button>
    <div className="reader-heading"><div><span className="kicker">{book.format} · {wordCount.format(book.wordCount)} words</span><h1>{book.title}</h1></div>
      <div className="reader-actions">
        {focused && <button className="icon-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>}
        <button className="icon-button" title="Contents" aria-label="Contents" aria-pressed={panel === 'contents'} onClick={() => togglePanel('contents')}><List size={19} /></button>
        <button className="icon-button" title={focused ? 'Exit focus mode' : 'Focus mode'} aria-label={focused ? 'Exit focus mode' : 'Focus mode'} onClick={() => setFocused(value => !value)}>{focused ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
        <button className="icon-button" title="Find in document" aria-label="Find in document" aria-pressed={panel === 'search'} onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button className="icon-button" title="Toggle bookmark" aria-label="Toggle bookmark" aria-pressed={book.bookmarks.includes(cursor)} onClick={bookmark}><Bookmark size={19} /></button>
        <button className="icon-button" title="Notes and bookmarks" aria-label="Notes and bookmarks" aria-pressed={panel === 'notes'} onClick={() => togglePanel('notes')}><StickyNote size={19} /></button>
        {book.format === 'PDF' && <button className="secondary compact" aria-pressed={panel === 'original'} onClick={() => { setSourcePage(1); togglePanel('original') }}>Original PDF</button>}
      </div>
    </div>
    <div className="reading-progress"><progress value={cursor + 1} max={passages.length} aria-label="Reading progress" /><span>{cursor + 1} / {passages.length} passages</span></div>
    <div className="reader-tools"><label>Layout <select value={layout} onChange={event => { setLayout(event.target.value as typeof layout); setScrollTarget({ index: cursor }) }}><option value="single">Single page</option><option value="spread">Two-page spread</option><option value="scroll">Continuous scroll</option></select></label>
      <button className="secondary compact" aria-expanded={appearance} onClick={() => setAppearance(value => !value)}>Appearance</button>
      {appearance && <div className="appearance-options"><label>Text size <select value={font} onChange={event => setFont(Number(event.target.value))}><option value={17}>Small</option><option value={20}>Medium</option><option value={25}>Large</option><option value={31}>Extra large</option></select></label>
      <label>Paper <select value={paper} onChange={event => setPaper(event.target.value as typeof paper)}><option value="match">Match site</option><option value="parchment">Parchment</option><option value="white">White</option><option value="night">Night</option><option value="contrast">High contrast</option></select></label>
      <label>Typeface <select value={typeface} onChange={event => setTypeface(event.target.value as typeof typeface)}><option value="literary">Literary</option><option value="classic">Classic</option><option value="system">System</option><option value="clean">Clean</option></select></label>
      <label>Line spacing <select value={spacing} onChange={event => setSpacing(Number(event.target.value))}><option value={1.45}>Tight</option><option value={1.65}>Standard</option><option value={1.9}>Relaxed</option><option value={2.2}>Wide</option></select></label></div>}
    </div>
    {panel === 'contents' && <aside className="reader-panel contents-panel">
      <div className="contents-heading"><h2>Contents</h2><button className="icon-button" aria-label="Close contents" onClick={() => setPanel(null)}><X size={17} /></button></div>
      {structure.printedPassages.size > 0 && <button className="secondary compact" onClick={() => {
        setPanel(null)
        jump(structure.printed >= 0 ? structure.printed : [...structure.printedPassages.keys()][0])
      }}>Open the book’s printed contents</button>}
      {!!contents.length && <label className="search"><Search size={16} /><input aria-label="Filter chapters" placeholder="Find a chapter" value={chapterFilter} onChange={event => setChapterFilter(event.target.value)} /></label>}
      {contents.length ? <ol className="contents-list">{contents.filter(({ title }) => title.toLocaleLowerCase().includes(chapterFilter.trim().toLocaleLowerCase())).map(({ index, title, depth, sourcePage }, order) =>
        <li key={order}><button style={{ paddingInlineStart: 10 + Math.min(depth, 4) * 13 }} aria-current={index !== undefined && index === currentChapter ? 'location' : undefined} onClick={() => {
          if (index !== undefined) { setPanel(null); jump(index) }
          else if (sourcePage) { narration.stop(); setSourcePage(sourcePage); setPanel('original') }
        }}><span>{title}</span>
          <small>{index === undefined ? `PDF ${sourcePage}` : layout === 'scroll' ? `Section ${Math.floor(index / sectionSize) + 1}` : `Page ${pages.pageAt(index) + 1}`}</small></button></li>)}</ol>
        : <p>No chapter headings found. Use document search or the page slider to jump ahead.</p>}
    </aside>}
    {panel === 'search' && <aside className="reader-panel"><label className="search"><Search size={17} /><input aria-label="Search document" placeholder="Find a word or phrase" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {query.trim() && <p role="status">{matches.length === 100 ? 'First 100 matches' : `${matches.length} matches`}</p>}
      <div className="search-hits">{matches.map(index => <button key={index} onClick={() => jump(index)}><b>{index + 1}</b> {passages[index].slice(0, 145)}{passages[index].length > 145 ? '…' : ''}</button>)}</div></aside>}
    {panel === 'notes' && <aside className="reader-panel">
      <h2>Notes and bookmarks</h2>
      <label htmlFor="auden-note">{draft?.id ? 'Edit note for passage' : 'Note for passage'} {(draft?.cursor ?? cursor) + 1}</label><textarea id="auden-note" maxLength={4000} value={note} onChange={event => { setDraft(current => current || { cursor }); setNote(event.target.value) }} />
      <div className="note-tools"><button className="primary compact" disabled={!note.trim()} onClick={() => void saveNote()}>Save note</button>
        {draft && <button className="secondary compact" onClick={() => { setDraft(undefined); setNote('') }}>Cancel</button>}
        <button className="secondary compact" disabled={!book.notes.length && !book.bookmarks.length} onClick={() => download('auden-annotations.json', JSON.stringify({ title: book.title, notes: book.notes, bookmarks: book.bookmarks }, null, 2), 'application/json')}><ArrowDownToLine size={16} /> Export annotations</button></div>
      <div className="note-list">{book.bookmarks.map(index => <button className="secondary compact" key={index} onClick={() => jump(index)}><Bookmark size={14}/> Passage {index + 1}</button>)}</div>
      {book.notes.map(item => <div className="saved-note" key={item.id}><button className="back" onClick={() => jump(item.cursor)}>Passage {item.cursor + 1}</button><p>{item.body}</p><div className="saved-note-actions"><button className="icon-button" aria-label="Edit note" onClick={() => { setDraft(item); setNote(item.body); document.getElementById('auden-note')?.focus() }}><Pencil size={15} /></button><button className="icon-button" aria-label="Delete note" onClick={() => { if (draft?.id === item.id) { setDraft(undefined); setNote('') }; void save({ notes: book.notes.filter(entry => entry.id !== item.id) }) }}><Trash2 size={15} /></button></div></div>)}
    </aside>}
    {panel === 'original' ? <Suspense fallback={<p>Opening original PDF…</p>}><OriginalPdf id={book.id} initialPage={sourcePage} /></Suspense>
      : <>
        {pageNavigation('Quick page navigation', true)}
        <div className={`reading-paper book-stage ${paper} ${typeface} ${layout === 'scroll' ? 'scroll-paper' : 'paged-paper'}`}
          ref={text} style={{ fontSize: font, lineHeight: spacing, '--leaf-height': `${paperHeight}px` } as CSSProperties}>
          {layout === 'scroll' ? <div className="scroll-leaf">
            {passages.slice(first, first + sectionSize).map((passage, offset) => renderPassage({ index: first + offset, from: 0, to: passage.length }))}
          </div> : <div className={`book-binding ${pageColumns === 2 ? 'facing-pages' : 'single-leaf'}`}
            onTouchStart={event => {
              if (event.touches.length === 1) swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
              else swipeStart.current = undefined
            }}
            onTouchEnd={event => {
              const start = swipeStart.current
              swipeStart.current = undefined
              if (!start || !event.changedTouches.length || window.getSelection()?.toString().trim()) return
              const dx = event.changedTouches[0].clientX - start.x
              const dy = event.changedTouches[0].clientY - start.y
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.45) {
                lastSwipe.current = performance.now()
                openPage(page + (dx < 0 ? 1 : -1))
              }
            }}
            onClick={event => {
              if (!(event.target instanceof Element) || event.target.closest('button, [role="button"], a, input') ||
                performance.now() - lastSwipe.current < 350 || window.getSelection()?.toString().trim()) return
              const bounds = event.currentTarget.getBoundingClientRect()
              openPage(page + (event.clientX < bounds.left + bounds.width / 2 ? -1 : 1))
            }}>
            <div className="book-leaves">
              {renderLeaf(page * pageColumns)}
              {pageColumns === 2 && (renderLeaf(page * pageColumns + 1) || <div className="book-endpaper" aria-hidden="true" />)}
            </div>
            {renderPageTurn()}
            <button className="book-edge book-edge-left" aria-label="Turn left edge to previous page" disabled={page === 0}
              onClick={() => { if (performance.now() - lastSwipe.current >= 350) openPage(page - 1) }}><ChevronLeft size={16} /></button>
            <button className="book-edge book-edge-right" aria-label="Turn right edge to next page" disabled={page + 1 >= pageCount}
              onClick={() => { if (performance.now() - lastSwipe.current >= 350) openPage(page + 1) }}><ChevronRight size={16} /></button>
          </div>}
        </div>
        {pageNavigation('Reader pages')}
      </>}
    <div className={`player ${collapsed ? '' : 'player-settings-open'}`}>
      <div className="player-main"><span className="player-icon"><Headphones size={19} /></span><div><strong>{narration.speaker === 'natural' ? 'Kokoro' : narration.speaker === 'device' ? 'Device voice' : 'Audiobook'}</strong>
        <small>{preparing ? (narration.state === 'loading' ? 'Preparing narration' : 'Buffering next clip') : `Passage ${(narration.state !== 'idle' && speakingPosition.current ? speakingPosition.current.index : cursor) + 1}`}</small></div>
        <button className="primary compact" disabled={!narration.supported} onClick={() => narration.toggle(position)}>{narration.state === 'playing' || preparing ? <Pause size={16} /> : <Play size={16} />} {actionName}</button>
        <button className="icon-button" disabled={narration.state === 'idle'} aria-label="Stop narration" onClick={() => { narration.stop(); setMessage('') }}><Square size={15} /></button>
        <button className="secondary compact" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Audio settings' : 'Hide settings'}</button>
        <label className="autoplay-toggle"><input type="checkbox" checked={narration.autoplay} onChange={event => narration.setAutoplay(event.target.checked)} /> Autoplay</label></div>
      {narration.clock.duration > 0 && <div className="clip-controls">
        <button className="icon-button" aria-label="Back 10 seconds in this clip" onClick={() => narration.seek(narration.clock.elapsed - 10)}><RotateCcw size={16} /></button>
        <span>{clipSeconds(narration.clock.elapsed)}</span><input type="range" aria-label="Position in current audio clip" min={0} max={narration.clock.duration} step=".1" value={narration.clock.elapsed} onChange={event => narration.seek(Number(event.target.value))} /><span>{clipSeconds(narration.clock.duration)}</span>
      </div>}
      {!collapsed && <>
        <div className="player-options">
          <label>Engine <select value={narration.engine} onChange={event => { narration.stop(); setMessage(''); narration.setEngine(event.target.value as typeof narration.engine) }}><option value="auto">Automatic</option><option value="natural">Kokoro only</option><option value="device">Device speech</option></select></label>
          {narration.engine !== 'device'
            ? <label>Voice <select value={narration.naturalVoice} onChange={event => { narration.stop(); narration.setNaturalVoice(event.target.value as NaturalVoice) }}>{Object.entries(naturalVoices).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
            : <label>Voice <select value={narration.voiceKey} onChange={event => { narration.stop(); narration.setVoiceKey(event.target.value) }}><option value="">Device default</option>{narration.voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></label>}
          <button className="secondary compact" disabled={!narration.supported || narration.state === 'loading'} onClick={() => narration.play(position, true)}>Preview voice</button>
          <label>Speed <select value={narration.rate} onChange={event => narration.setRate(Number(event.target.value))}>{[.75,.8,1,1.15,1.2,1.3,1.5,1.75,2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          <label><Timer size={15} /> Sleep timer <select value={narration.minutes} onChange={event => narration.setSleepTimer(Number(event.target.value))}><option value={0}>Off</option><option value={-1}>End of chapter</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
          <label><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow narration</label>
          {nextChapter !== undefined && <button className="secondary compact" onClick={() => narration.play({ index: nextChapter, offset: 0 })}><SkipForward size={15} /> Listen from next chapter</button>}
        </div>
        {narration.engine !== 'device' && <p className="narration-help">{narration.engine === 'auto'
          ? 'Automatic starts with a device voice when needed and switches to Kokoro when a clip is ready.'
          : 'Kokoro prepares audio on this device. Its first use needs a model download.'}</p>}
      </>}
      {(message || !narration.supported) && <div className="reader-message" role="status"><Check size={14}/>{message || 'Narration is unavailable in this browser.'}</div>}
    </div>
  </section>
}
