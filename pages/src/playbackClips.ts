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

export function naturalClip(passages: string[], start: Position, shouldSkip: (index: number) => boolean, stopAt?: number, maximumSentences = 5, maximumCharacters = 220): NaturalClip | undefined {
  const parts: NaturalClip['parts'] = []
  let point = nextReadable(passages, start, shouldSkip)
  let text = ''
  let sentences = 0
  while (sentences < maximumSentences && point.index < passages.length && (stopAt === undefined || point.index < stopAt)) {
    const remaining = passages[point.index].slice(point.offset)
    const sentence = splitSentences(remaining)[0]?.text
    if (!sentence) break
    const directed = deliveryFor(sentence) !== 'plain'
    if (directed && parts.length) break
    const capacity = maximumCharacters - text.length - Number(Boolean(text))
    if (capacity <= 0) break
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
    if (directed) break
  }
  if (!parts.length) return
  return { point: parts[0].point, end: parts[0].end, next: point, text, parts, sentences }
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

export function positionInClip(clip: Clip | NaturalClip, offset: number) {
  const part = 'parts' in clip ? [...clip.parts].reverse().find(item => item.at <= offset) || clip.parts[0] : null
  const source = part || clip
  return { part: source, offset: Math.min(source.end - 1, source.point.offset + offset - (part?.at || 0)) }
}
