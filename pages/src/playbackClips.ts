import { splitSentences } from './readingLayout'

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

export type NaturalClip = Clip & { parts: (Clip & { at: number })[]; sentences: number }

export function naturalClip(passages: string[], start: Position, shouldSkip: (index: number) => boolean, stopAt?: number, maximumSentences = 5): NaturalClip | undefined {
  const parts: NaturalClip['parts'] = []
  let point = nextReadable(passages, start, shouldSkip)
  let text = ''
  let sentences = 0
  while (sentences < maximumSentences && point.index < passages.length && (stopAt === undefined || point.index < stopAt)) {
    const remaining = passages[point.index].slice(point.offset)
    const sentence = splitSentences(remaining)[0]?.text
    if (!sentence) break
    const capacity = 220 - text.length - Number(Boolean(text))
    if (parts.length && sentence.length > capacity) break
    let length = Math.min(sentence.length, capacity)
    if (length < sentence.length) {
      const boundary = sentence.slice(0, length).search(/\s+\S*$/)
      if (boundary > capacity * .6) length = boundary + 1
    }
    const spoken = remaining.slice(0, length)
    const end = point.offset + length
    const next = nextReadable(passages, { index: point.index, offset: end }, shouldSkip)
    if (text) text += ' '
    parts.push({ point, end, next, text: spoken, at: text.length })
    text += spoken
    sentences++
    point = next
  }
  if (!parts.length) return
  return { point: parts[0].point, end: parts[0].end, next: point, text, parts, sentences }
}

export function positionInClip(clip: Clip | NaturalClip, offset: number) {
  const part = 'parts' in clip ? [...clip.parts].reverse().find(item => item.at <= offset) || clip.parts[0] : null
  const source = part || clip
  return { part: source, offset: Math.min(source.end - 1, source.point.offset + offset - (part?.at || 0)) }
}
