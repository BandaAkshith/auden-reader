import { chapterIndices, looksLikeHeading } from './chapters'

const chapterMarker = /\b(?:chapter|part|book)\s+\d+\s*(?=[:.\-–—])/gi
const printedHeader = /^(?:table of |detailed )?contents[: ]*$/i
const leader = /\s*(?:\.{2,}|…+|·{2,})\s*\d+\s*$/
const chapterKey = (value: string) => value.match(/^(chapter|part|book)\s+(\d+)\b/i)?.[0].toLowerCase().replace(/\s+/g, ' ')

export function bookStructure(passages: string[], importedHeadings?: number[]) {
  const frontMatter = passages.slice(0, Math.min(150, Math.max(12, Math.ceil(passages.length * .15))))
  const dense = frontMatter.map((text, index) => (text.match(chapterMarker)?.length || 0) >= 3 ? index : -1).filter(index => index >= 0)
  const printed = frontMatter.findIndex(text => printedHeader.test(text.trim()))
  const printedPassages = new Map<number, string[]>()
  if (dense.length) {
    // Older PDF imports packed several original contents rows into each paragraph.
    const first = printed >= 0 && printed <= dense[0] ? printed + 1 : dense[0]
    let end = dense.at(-1)! + 1
    for (; end < frontMatter.length && !looksLikeHeading(passages[end].trim()); end++) {
      if ((passages[end].match(/[.!?]\s+/g)?.length || 0) >= 3) break
      if (end > dense.at(-1)! + 3) break
    }
    for (let index = first; index < end; index++) {
      const rows = passages[index].split(/\n+|(?=\b(?:chapter|part|book)\s+\d+\s*[:.\-–—])/gi)
        .map(row => row.trim()).filter(Boolean)
      if (rows.length) printedPassages.set(index, rows)
    }
  } else if (printed >= 0) {
    for (let index = printed + 1; index < frontMatter.length; index++) {
      const value = passages[index].trim()
      if (!leader.test(value)) break
      printedPassages.set(index, [value])
    }
  }

  const headings = [...new Set([...(importedHeadings || []), ...chapterIndices(passages)])]
    .filter(index => !printedPassages.has(index) && !printedHeader.test(passages[index]?.trim() || ''))
    .sort((a, b) => a - b)
  const targets = new Map<string, number>()
  const opening = new Map<number, string>()
  for (const index of headings) {
    const title = passages[index].trim()
    opening.set(index, title)
    const key = chapterKey(title)
    if (key && !targets.has(key)) targets.set(key, index)
  }
  return { opening, printedPassages, printed, targetFor: (entry: string) => targets.get(chapterKey(entry) || '') }
}

export function paginate(passages: string[], structure: ReturnType<typeof bookStructure>, characters: number, lines: number) {
  const starts = [0]
  const lookup = new Uint32Array(passages.length)
  let used = 0
  for (let index = 0; index < passages.length; index++) {
    const heading = structure.opening.has(index)
    const rows = structure.printedPassages.get(index)
    const cost = rows
      ? Math.min(lines, rows.reduce((sum, row) => sum + Math.max(1, Math.ceil(row.length / characters)), 0))
      : Math.max(1, Math.ceil(passages[index].length / characters)) + (heading ? 2 : 0.55)
    if (index && (heading || (used + cost > lines && used > 0 && !structure.opening.has(index - 1)))) {
      starts.push(index)
      used = 0
    }
    used += cost
    lookup[index] = starts.length - 1
  }
  return { starts, lookup }
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null
export function splitSentences(text: string) {
  if (segmenter) return Array.from(segmenter.segment(text), ({ segment, index }) => ({ text: segment, offset: index }))
  return Array.from(text.matchAll(/.+?(?:[.!?]+(?=\s|$)\s*|$)/gs), match => ({ text: match[0], offset: match.index }))
}
