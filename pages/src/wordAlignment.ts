import { type TimeSpan, type TimedWord, wordRanges } from './wordTiming'

export function utteranceWords(original: string[], spoken: string[], ranges: { part: number; from: number; to: number }[]) {
  return ranges.flatMap(({ part, from, to }) => {
    const source = wordRanges(original[part])
    return wordRanges(spoken[part]).flatMap((word, index) => word.start >= from && word.end <= to && source[index]
      ? [{ text: word.text, part, from: source[index].start, to: source[index].end }] : [])
  })
}

export function createWordAligner() {
  let worker: Worker | undefined
  let sequence = 0
  let disabled = false
  const pending = new Map<number, { finish: (spans: (TimeSpan | null)[]) => void; timer: number }>()

  function close() {
    worker?.terminate()
    worker = undefined
    for (const { finish, timer } of pending.values()) { window.clearTimeout(timer); finish([]) }
    pending.clear()
  }

  function prepare() {
    if (worker || disabled) return
    try {
      worker = new Worker(new URL('./alignment.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = () => { disabled = true; close() }
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id)
        if (request) {
          pending.delete(data.id)
          window.clearTimeout(request.timer)
          request.finish(data.spans || [])
        }
        if (data.failed) { disabled = true; close() }
      }
      worker.postMessage({ id: 0, samples: new Float32Array(), words: [] })
    } catch {
      disabled = true
      close()
    }
  }

  async function align(samples: Float32Array, sampleRate: number, words: ReturnType<typeof utteranceWords>, offset: number): Promise<TimedWord[]> {
    if (disabled || !words.length || samples.length / sampleRate > 48) return []
    try {
      prepare()
      if (!worker) return []
      let audio = samples
      if (sampleRate !== 16000) {
        const scale = sampleRate / 16000
        audio = Float32Array.from({ length: Math.ceil(samples.length / scale) }, (_, i) => {
          const at = i * scale
          const left = Math.floor(at)
          return samples[left] + ((samples[left + 1] ?? samples[left]) - samples[left]) * (at - left)
        })
      } else audio = samples.slice()
      const id = ++sequence
      const spans = await new Promise<(TimeSpan | null)[]>(resolve => {
        const timer = window.setTimeout(() => { disabled = true; close() }, 40_000)
        pending.set(id, { finish: resolve, timer })
        worker!.postMessage({ id, samples: audio, words: words.map(word => word.text) }, [audio.buffer])
      })
      return spans.flatMap((span, index) => span && words[index]
        ? [{ ...words[index], start: span.start + offset, end: span.end + offset }] : [])
    } catch {
      disabled = true
      close()
      return []
    }
  }

  return { align, close, prepare }
}
