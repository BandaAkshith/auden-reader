import { firstSentence, splitSentences } from './readingLayout'

export const FIRST_BATCH_SIZE = 6
export const SUBSEQUENT_BATCH_SIZE = 8
export const TARGET_READY_BUFFER_BATCHES = 3

export type Position = { index: number; offset: number }
export type Clip = { point: Position; end: number; next: Position; text: string }

export function nextReadable(passages: string[], point: Position, shouldSkip: (index: number) => boolean): Position {
  let { index, offset } = point
  while (index < passages.length && (shouldSkip(index) || !passages[index].slice(offset).trim())) {
    index++
    offset = 0
  }
  return { index, offset }
}

export function makeClip(passages: string[], point: Position): Clip | undefined {
  const remaining = passages[point.index]?.slice(point.offset)
  if (!remaining?.trim()) return
  const sentences = splitSentences(remaining)
  let length = sentences[0]?.text.length || remaining.length
  for (let index = 1; index < sentences.length && length + sentences[index].text.length <= 240; index++) {
    length += sentences[index].text.length
  }
  if (length > 300) {
    const boundary = remaining.slice(0, 300).search(/\s+\S*$/)
    length = boundary > 150 ? boundary + 1 : 300
  }
  const end = point.offset + length
  const next = passages[point.index].slice(end).trim()
    ? { index: point.index, offset: end }
    : { index: point.index + 1, offset: 0 }
  return { point, end, next, text: remaining.slice(0, length) }
}

export type NarrationBatch = Clip & { parts: (Clip & { at: number })[]; sentences: number }

export function narrationBatch(passages: string[], start: Position, shouldSkip: (index: number) => boolean, stopAt?: number, maximumSentences = SUBSEQUENT_BATCH_SIZE): NarrationBatch | undefined {
  const parts: NarrationBatch['parts'] = []
  let point = nextReadable(passages, start, shouldSkip)
  let text = ''
  while (parts.length < maximumSentences && point.index < passages.length && (stopAt === undefined || point.index < stopAt)) {
    const remaining = passages[point.index].slice(point.offset)
    const sentence = firstSentence(remaining)
    if (!sentence) break
    const end = point.offset + sentence.length
    const next = nextReadable(passages, { index: point.index, offset: end }, shouldSkip)
    if (text) text += ' '
    parts.push({ point, end, next, text: sentence, at: text.length })
    text += sentence
    point = next
  }
  if (!parts.length) return
  return { point: parts[0].point, end: parts[0].end, next: point, text, parts, sentences: parts.length }
}

// Model input can be smaller than a batch. Stitch the rendered pieces before
// counting the batch as ready so long sentences never change its boundaries.
export function batchUtterances<Direction extends string>(sentences: string[], maximumCharacters: number, deliveryOf: (text: string) => Direction) {
  const utterances: { text: string; direction: Direction; ranges: { part: number; from: number; to: number }[] }[] = []
  for (const [part, sentence] of sentences.entries()) {
    const direction = deliveryOf(sentence)
    let remaining = sentence.trim()
    let from = sentence.length - sentence.trimStart().length
    while (remaining) {
      const previous = utterances.at(-1)
      if (previous?.direction === direction && previous.text.length + 1 + remaining.length <= maximumCharacters) {
        previous.text += ' ' + remaining
        previous.ranges.push({ part, from, to: from + remaining.length })
        break
      }
      let end = Math.min(remaining.length, maximumCharacters)
      if (end < remaining.length) {
        const window = remaining.slice(0, end)
        const boundary = window.search(/\s+\S*$/)
        if (boundary > end * .5) end = boundary
        else if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--
      }
      utterances.push({ text: remaining.slice(0, end).trimEnd(), direction, ranges: [{ part, from, to: from + end }] })
      const rest = remaining.slice(end)
      remaining = rest.trimStart()
      from += end + rest.length - remaining.length
    }
  }
  return utterances
}

export function spokenText(text: string, context: string) {
  if (/\b(?:train|locomotive|steam engine|railway)\b/i.test(context)) {
    text = text.replace(/^([\s“"‘']*)chu[\s-]+chu\b/i, '$1Choo-choo')
  }
  if (/\b(?:door|knock(?:ed|ing|s)?|rap(?:ped|ping|s)?)\b/i.test(context)) {
    text = text.replace(/^([\s“"‘']*)tuk[\s-]+tuk\b/i, '$1Tuck. Tuck')
  }
  return text
}

export function deliveryFor(text: string) {
  if (!/["“”]/.test(text)) return 'plain'
  if (/\b(?:whispered|said softly)\b/i.test(text)) return 'quiet'
  if (/\b(?:said angrily|shouted|snapped|yelled)\b/i.test(text)) return 'emphatic'
  if (/\b(?:said sadly|said through tears|sobbed)\b/i.test(text)) return 'sad'
  return 'plain'
}

export const delivery = {
  plain: { pace: 1, pitch: 1, volume: 1 },
  quiet: { pace: .93, pitch: .94, volume: .75 },
  emphatic: { pace: 1.08, pitch: 1.05, volume: 1 },
  sad: { pace: .89, pitch: .93, volume: .88 },
}

export function trimAudioPadding(samples: Float32Array, sampleRate: number) {
  // Look for speech in both directions and retain a small punctuation pause.
  const threshold = .004
  let start = 0
  let end = samples.length
  while (start < end && Math.abs(samples[start]) < threshold) start++
  if (start === end) return samples
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--
  return samples.subarray(Math.max(0, start - Math.round(sampleRate * .035)),
    Math.min(samples.length, end + Math.round(sampleRate * .1)))
}

export function positionInClip(clip: Clip | NarrationBatch, offset: number) {
  const part = 'parts' in clip ? [...clip.parts].reverse().find(item => item.at <= offset) || clip.parts[0] : null
  const source = part || clip
  return { part: source, offset: Math.min(source.end - 1, source.point.offset + offset - (part?.at || 0)) }
}
