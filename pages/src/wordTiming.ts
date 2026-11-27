export type TimeSpan = { start: number; end: number }
export type WordRange = { start: number; end: number; text: string }
export type TimedWord = TimeSpan & { part: number; from: number; to: number }

export function wordRanges(text: string): WordRange[] {
  return Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu), match => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
  }))
}

// Normalize the alphabet expected by the English acoustic model.
const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
function spellNumber(word: string): string {
  const n = Number(word)
  if ((word.length > 1 && word[0] === '0') || n >= 10_000) return Array.from(word, digit => digits[Number(digit)]).join('|')
  if (n < 10) return digits[n]
  if (n < 20) return teens[n - 10]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '|' + digits[n % 10] : '')
  const scale = n < 1000 ? 100 : 1000
  return spellNumber(String(Math.floor(n / scale))) + (scale === 100 ? '|hundred' : '|thousand') +
    (n % scale ? '|' + spellNumber(String(n % scale)) : '')
}

export function acousticWord(word: string) {
  return (/^[0-9]+$/.test(word) ? spellNumber(word) : word)
    .normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/’/g, "'").replace(/[^A-Z|'0-9]/g, '')
}

export function wordAt(words: TimedWord[], seconds: number) {
  let lo = 0
  let hi = words.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (words[mid].start <= seconds) lo = mid + 1
    else hi = mid
  }
  const word = words[lo - 1]
  return word && seconds < word.end ? word : undefined
}

// Follow the CTC path for the known transcript. Blanks may occur between
// letters and must separate two adjacent instances of the same letter.
export function forcedWordSpans(logits: Float32Array, frames: number, width: number,
  labels: number[], wordOfLabel: number[], wordCount: number, blank: number, duration: number) {
  const spans: (TimeSpan | null)[] = Array(wordCount).fill(null)
  if (!labels.length || frames < labels.length) return spans
  const states = 2 * labels.length + 1
  const trace = new Uint8Array(frames * states)
  let previous = new Float32Array(states).fill(-Infinity)
  let current = new Float32Array(states)
  previous[0] = logits[blank]
  previous[1] = logits[labels[0]]
  for (let frame = 1; frame < frames; frame++) {
    const base = frame * width
    for (let state = 0; state < states; state++) {
      const letter = state & 1
      const index = state >>> 1
      let best = previous[state]
      let move = 0
      if (state && previous[state - 1] > best) { best = previous[state - 1]; move = 1 }
      if (letter && index && labels[index] !== labels[index - 1] && previous[state - 2] > best) {
        best = previous[state - 2]; move = 2
      }
      current[state] = best + logits[base + (letter ? labels[index] : blank)]
      trace[frame * states + state] = move
    }
    const swap = previous
    previous = current
    current = swap
  }
  let state = previous[states - 1] > previous[states - 2] ? states - 1 : states - 2
  if (!Number.isFinite(previous[state])) return spans
  const alignment = new Int32Array(frames)
  for (let frame = frames - 1; frame >= 0; frame--) {
    alignment[frame] = state & 1 ? state >>> 1 : -1
    state -= trace[frame * states + state]
  }
  const seen = new Uint8Array(labels.length)
  const close = new Uint8Array(labels.length)
  for (let frame = 0; frame < frames; frame++) {
    const label = alignment[frame]
    if (label < 0) continue
    const word = wordOfLabel[label]
    if (word < 0) continue
    seen[label] = 1
    const base = frame * width
    let best = -Infinity
    for (let column = 0; column < width; column++) best = Math.max(best, logits[base + column])
    if (best - logits[base + labels[label]] <= 4) close[label] = 1
    const start = .0025 + frame * .02
    const end = Math.min(duration, start + .02)
    const span = spans[word]
    if (!span) spans[word] = { start, end }
    else span.end = end
  }
  const counts = new Uint16Array(wordCount)
  const supported = new Uint16Array(wordCount)
  for (let label = 0; label < labels.length; label++) {
    const word = wordOfLabel[label]
    if (word < 0) continue
    counts[word]++
    if (seen[label] && close[label]) supported[word]++
  }
  return spans.map((span, index) => supported[index] * 2 >= counts[index] ? span : null)
}
