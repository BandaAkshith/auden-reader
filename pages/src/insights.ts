import { useEffect } from 'react'
import { profileKey } from './accounts'

type Day = { seconds: number; sessions: number }
export type Insights = Record<string, Record<string, Day>>

export function dayKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-')
}

const key = profileKey('reading-insights')
export function loadInsights(): Insights {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {} }
  catch { return {} }
}

function record(bookId: string, seconds: number, sessions: number) {
  const days = loadInsights()
  const day = days[dayKey()] ??= {}
  const item = day[bookId] ??= { seconds: 0, sessions: 0 }
  item.seconds += seconds
  item.sessions += sessions
  try {
    localStorage.setItem(key, JSON.stringify(days))
    window.dispatchEvent(new Event('auden-reading-activity'))
  }
  catch { /* Reading remains available when storage is restricted. */ }
}

export function useReadingSession(bookId: string) {
  useEffect(() => {
    let start = performance.now()
    let visible = !document.hidden
    let first = true

    function flush() {
      const now = performance.now()
      const seconds = Math.round((now - start) / 1000)
      start = now
      if (!visible || !seconds) return
      // Bound elapsed time when a device sleeps while a tab is open.
      record(bookId, Math.min(35, seconds), Number(first))
      first = false
    }

    function visibility() {
      flush()
      visible = !document.hidden
    }

    const interval = window.setInterval(flush, 15_000)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', flush)
    return () => {
      flush()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [bookId])
}

export function summarizeInsights(insights: Insights) {
  let seconds = 0
  let sessions = 0
  const totals = new Map<string, number>()
  const daily = new Map<string, number>()
  for (const [date, books] of Object.entries(insights)) {
    for (const [id, item] of Object.entries(books)) {
      seconds += item.seconds
      sessions += item.sessions
      totals.set(id, (totals.get(id) || 0) + item.seconds)
      daily.set(date, (daily.get(date) || 0) + item.seconds)
    }
  }
  return { seconds, sessions, totals, daily }
}
