import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, FileText, Headphones, LibraryBig, LockKeyhole, Pause, Play, Plus, Search, Square, StickyNote, Timer, Trash2, X } from 'lucide-react'
import { importBook } from './importBook'
import { listBooks, readPassages, removeBook, storeBook, updateBook, type Book } from './library'
import { sample } from './sample'
import { useNarration } from './useNarration'

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

function download(name: string, content: string, type: string) {
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
    } catch {
      setError('Auden could not save your changes in this browser.')
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

  function exportHistory() {
    const rows = [['Title', 'Format', 'Words', 'Current passage', 'Passages', 'Last opened'],
      ...books.map(book => [book.title, book.format, book.wordCount, book.openedAt ? book.cursor + 1 : 0, book.passageCount, book.openedAt ? new Date(book.openedAt).toISOString() : ''])]
    download('auden-reading-history.csv', '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  }

  return <div className="shell">
    <header className="masthead">
      <button className="brand" onClick={() => { setActive(undefined); setError('') }}><span className="brand-mark"><BookOpen size={21} strokeWidth={1.6} /></span>Auden</button>
      <div className="masthead-end"><span><LockKeyhole size={14} /> Device library</span>
        <button className="primary compact" disabled={busy || !loaded} onClick={() => input.current?.click()}><Plus size={17} /> Import<span className="wide-only"> documents</span></button></div>
      <input ref={input} type="file" aria-label="Import documents" accept=".pdf,.epub,.docx,.txt" multiple hidden onChange={event => {
        const files = Array.from(event.currentTarget.files || [])
        event.currentTarget.value = ''
        void add(files)
      }} />
    </header>
    <main className="workspace">
      {error && <div className="notice error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={17} /></button></div>}
      {status && <div className="notice" role="status"><span>{status}</span>{!busy && <button className="icon-button" aria-label="Dismiss status" onClick={() => setStatus('')}><X size={17} /></button>}</div>}
      {selected && active ? <Reader key={selected.id} book={selected} passages={active.passages} save={changes => patch(selected.id, changes)} onBack={() => { setActive(undefined); setStatus(''); window.scrollTo(0, 0) }} />
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
        </>}
      <footer><BookOpen size={15} /> Auden <span>Documents, notes, and progress are stored in this browser.</span></footer>
    </main>
  </div>
}

function Reader({ book, passages, save, onBack }: {
  book: Book; passages: string[]; save: (changes: Parameters<typeof updateBook>[1]) => Promise<void>; onBack: () => void
}) {
  const [cursor, setCursor] = useState(Math.min(book.cursor, passages.length - 1))
  const [panel, setPanel] = useState<'search' | 'notes' | 'original' | null>(null)
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [font, setFont] = useState(20)
  const [paper, setPaper] = useState('parchment')
  const [collapsed, setCollapsed] = useState(false)
  const [anchor, setAnchor] = useState(cursor)
  const spread = 8
  const first = Math.floor(cursor / spread) * spread
  const text = useRef<HTMLDivElement>(null)
  const searchIndex = useMemo(() => passages.map(passage => passage.toLocaleLowerCase()), [passages])
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return []
    return searchIndex.reduce<number[]>((hits, value, index) => {
      if (value.includes(term) && hits.length < 100) hits.push(index)
      return hits
    }, [])
  }, [query, searchIndex])

  function go(index: number) {
    const next = Math.max(0, Math.min(index, passages.length - 1))
    setCursor(next)
    void save({ cursor: next })
  }

  const narration = useNarration(passages, go, setMessage)

  function jump(index: number) {
    narration.stop()
    go(index)
    setAnchor(Math.max(0, Math.min(index, passages.length - 1)))
  }

  useEffect(() => {
    text.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [anchor, cursor, first])

  function togglePanel(value: typeof panel) {
    setPanel(current => current === value ? null : value)
  }

  function bookmark() {
    const exists = book.bookmarks.includes(cursor)
    const bookmarks = exists ? book.bookmarks.filter(item => item !== cursor) : [...book.bookmarks, cursor].sort((a, b) => a - b)
    void save({ bookmarks })
    setMessage(exists ? 'Bookmark removed.' : `Bookmarked passage ${cursor + 1}.`)
  }

  function saveNote() {
    const body = note.trim()
    if (!body) return
    const next = [...book.notes, { id: crypto.randomUUID(), cursor, body }]
    void save({ notes: next })
    setNote('')
    setMessage('Note saved.')
  }

  const actionName = narration.state === 'playing' ? 'Pause' : narration.state === 'paused' ? 'Resume' : 'Listen'
  return <section className="reader" aria-label="Document reader">
    <button className="back" onClick={onBack}><ArrowLeft size={17} /> Back to library</button>
    <div className="reader-heading"><div><span className="kicker">{book.format} · {wordCount.format(book.wordCount)} words</span><h1>{book.title}</h1></div>
      <div className="reader-actions">
        <button className="icon-button" title="Find in document" aria-label="Find in document" aria-pressed={panel === 'search'} onClick={() => togglePanel('search')}><Search size={19} /></button>
        <button className="icon-button" title="Toggle bookmark" aria-label="Toggle bookmark" aria-pressed={book.bookmarks.includes(cursor)} onClick={bookmark}><Bookmark size={19} /></button>
        <button className="icon-button" title="Notes and bookmarks" aria-label="Notes and bookmarks" aria-pressed={panel === 'notes'} onClick={() => togglePanel('notes')}><StickyNote size={19} /></button>
        {book.format === 'PDF' && <button className="secondary compact" aria-pressed={panel === 'original'} onClick={() => togglePanel('original')}>Original PDF</button>}
      </div>
    </div>
    <div className="reading-progress"><progress value={cursor + 1} max={passages.length} aria-label="Reading progress" /><span>{cursor + 1} / {passages.length} passages</span></div>
    <div className="reader-tools"><label>Text size <select value={font} onChange={event => setFont(Number(event.target.value))}><option value={17}>Small</option><option value={20}>Medium</option><option value={25}>Large</option><option value={31}>Extra large</option></select></label>
      <label>Paper <select value={paper} onChange={event => setPaper(event.target.value)}><option value="parchment">Parchment</option><option value="white">White</option><option value="night">Night</option></select></label></div>
    {panel === 'search' && <aside className="reader-panel"><label className="search"><Search size={17} /><input aria-label="Search document" placeholder="Find a word or phrase" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {query.trim() && <p role="status">{matches.length === 100 ? 'First 100 matches' : `${matches.length} matches`}</p>}
      <div className="search-hits">{matches.map(index => <button key={index} onClick={() => jump(index)}><b>{index + 1}</b> {passages[index].slice(0, 145)}{passages[index].length > 145 ? '…' : ''}</button>)}</div></aside>}
    {panel === 'notes' && <aside className="reader-panel">
      <h2>Notes and bookmarks</h2>
      <label htmlFor="auden-note">Note for passage {cursor + 1}</label><textarea id="auden-note" maxLength={4000} value={note} onChange={event => setNote(event.target.value)} />
      <div className="note-tools"><button className="primary compact" disabled={!note.trim()} onClick={saveNote}>Save note</button>
        <button className="secondary compact" disabled={!book.notes.length && !book.bookmarks.length} onClick={() => download('auden-annotations.json', JSON.stringify({ title: book.title, notes: book.notes, bookmarks: book.bookmarks }, null, 2), 'application/json')}><ArrowDownToLine size={16} /> Export annotations</button></div>
      <div className="note-list">{book.bookmarks.map(index => <button className="secondary compact" key={index} onClick={() => jump(index)}><Bookmark size={14}/> Passage {index + 1}</button>)}</div>
      {book.notes.map(item => <div className="saved-note" key={item.id}><button className="back" onClick={() => jump(item.cursor)}>Passage {item.cursor + 1}</button><p>{item.body}</p><button className="icon-button" aria-label="Delete note" onClick={() => void save({notes: book.notes.filter(entry => entry.id !== item.id)})}><Trash2 size={15} /></button></div>)}
    </aside>}
    {panel === 'original' ? <Suspense fallback={<p>Opening original PDF…</p>}><OriginalPdf id={book.id} /></Suspense>
      : <div className={`reading-paper ${paper}`} ref={text} style={{ fontSize: font }}>
        {passages.slice(first, first + spread).map((passage, offset) => {
          const index = first + offset
          return <p key={index} aria-current={index === cursor ? 'location' : undefined}><button aria-label={`Set reading position to passage ${index + 1}`} onClick={() => jump(index)}>{index + 1}</button>{passage}</p>
        })}
        <nav className="page-controls" aria-label="Reader pages"><button className="secondary compact" disabled={first === 0} onClick={() => jump(first - spread)}><ChevronLeft size={16} /> Previous</button>
          <span>{Math.floor(first / spread) + 1} of {Math.ceil(passages.length / spread)}</span>
          <button className="secondary compact" disabled={first + spread >= passages.length} onClick={() => jump(first + spread)}>Next <ChevronRight size={16} /></button></nav>
      </div>}
    <div className="player">
      <div className="player-main"><span className="player-icon"><Headphones size={19} /></span><div><strong>Listen</strong><small>Passage {cursor + 1}</small></div>
        <button className="primary compact" disabled={!narration.supported} onClick={() => narration.toggle(cursor)}>{narration.state === 'playing' ? <Pause size={16} /> : <Play size={16} />} {actionName}</button>
        <button className="icon-button" disabled={narration.state === 'idle'} aria-label="Stop narration" onClick={narration.stop}><Square size={15} /></button>
        <button className="secondary compact" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Show controls' : 'Hide controls'}</button></div>
      {!collapsed && <div className="player-options">
        <label>Voice <select value={narration.voiceKey} onChange={event => narration.setVoiceKey(event.target.value)}><option value="">Device default</option>{narration.voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></label>
        <label>Speed <select value={narration.rate} onChange={event => narration.setRate(Number(event.target.value))}><option value={0.8}>0.8×</option><option value={1}>1×</option><option value={1.2}>1.2×</option><option value={1.5}>1.5×</option></select></label>
        <label><Timer size={15} /> Sleep timer <select value={narration.minutes} onChange={event => narration.setSleepTimer(Number(event.target.value))}><option value={0}>Off</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
      </div>}
      {(message || !narration.supported) && <div className="reader-message" role="status"><Check size={14}/>{message || 'Narration is unavailable in this browser.'}</div>}
    </div>
  </section>
}
