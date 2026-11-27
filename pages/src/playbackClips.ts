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
