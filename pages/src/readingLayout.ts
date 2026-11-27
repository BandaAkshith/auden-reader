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

export type PageFragment = { index: number; from: number; to: number; rows?: [number, number] }

export function paginate(passages: string[], structure: ReturnType<typeof bookStructure>, characters: number, lines: number) {
  const leaves: PageFragment[][] = []
  let fragments: PageFragment[] = []
  let used = 0
  let hasBody = false
  let pendingHeading = false
  let lastBody = passages.length - 1
  while (lastBody >= 0 && (structure.opening.has(lastBody) || lastBody === structure.printed)) lastBody--

  function turn() {
    if (!fragments.length) return
    leaves.push(fragments)
    fragments = []
    used = 0
    hasBody = false
    pendingHeading = false
  }

  function add(index: number, from: number, to: number, cost: number) {
    fragments.push({ index, from, to })
    used += cost
  }

  for (let index = 0; index < passages.length; index++) {
    const text = passages[index]
    const heading = structure.opening.has(index) || index === structure.printed
    const rows = structure.printedPassages.get(index)
    if (heading) {
      const cost = Math.ceil(text.length / Math.max(12, characters * .76)) + 1.75
      const hasFollowingText = index < lastBody
      // Keep a run of headings with its first paragraph. A closing heading
      // stays with the preceding page even when the document ends there.
      if (hasBody && !pendingHeading && hasFollowingText && (used >= lines * .5 || used + cost + 5 > lines)) turn()
      add(index, 0, text.length, cost)
      pendingHeading = true
      continue
    }
    if (rows) {
      let previousEnd = 0
      const offsets = rows.map(row => {
        const offset = Math.max(previousEnd, text.indexOf(row, previousEnd))
        previousEnd = offset + row.length
        return offset
      })
      rows.forEach((row, rowIndex) => {
        const cost = Math.max(1, Math.ceil(row.length / characters)) + .42
        if (hasBody && !pendingHeading && used + cost > lines) turn()
        const last = fragments.at(-1)
        const end = offsets[rowIndex + 1] ?? text.length
        if (last?.index === index && last.rows) {
          last.rows[1] = rowIndex + 1
          last.to = end
          used += cost
        } else {
          add(index, rowIndex ? offsets[rowIndex] : 0, end, cost)
          fragments.at(-1)!.rows = [rowIndex, rowIndex + 1]
        }
        hasBody = true
        pendingHeading = false
      })
      continue
    }

    let from = 0
    while (from < text.length) {
      let available = Math.floor(lines - used - .35)
      if (available < 3 && hasBody && !pendingHeading) { turn(); available = Math.floor(lines - .35) }
      const capacity = Math.max(3, available) * characters
      let to = Math.min(text.length, from + capacity)
      if (to < text.length) {
        // Split at a nearby word boundary while keeping original offsets for
        // existing bookmarks, narration positions, and exact page jumps.
        const window = text.slice(Math.max(from, to - characters), to)
        const boundary = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'))
        if (boundary >= 0) to -= window.length - boundary - 1
      }
      add(index, from, to, Math.max(1, Math.ceil((to - from) / characters)) + .35)
      hasBody = true
      pendingHeading = false
      from = to
      if (from < text.length) turn()
    }
  }
  turn()

  function pageAt(index: number, offset = 0) {
    let start = 0
    let end = leaves.length - 1
    while (start < end) {
      const middle = Math.ceil((start + end) / 2)
      const first = leaves[middle][0]
      if (first.index < index || (first.index === index && first.from <= offset)) start = middle
      else end = middle - 1
    }
    return start
  }

  return { leaves, pageAt }
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null
export function firstSentence(text: string) {
  return segmenter ? segmenter.segment(text)[Symbol.iterator]().next().value?.segment
    : text.match(/^.+?(?:[.!?]+(?=\s|$)\s*|$)/s)?.[0]
}
export function splitSentences(text: string) {
  if (segmenter) return Array.from(segmenter.segment(text), ({ segment, index }) => ({ text: segment, offset: index }))
  return Array.from(text.matchAll(/.+?(?:[.!?]+(?=\s|$)\s*|$)/gs), match => ({ text: match[0], offset: match.index }))
}
