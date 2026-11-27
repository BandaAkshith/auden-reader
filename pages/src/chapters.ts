const chapterStart = /^(?:chapter|part|book)\s+(?:\p{N}+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\b.*)?$/iu
const specialHeading = /^(?:prologue|epilogue|preface|introduction|afterword|appendix)(?:\s*[:.—–-].*|\s+[A-Z].*)?$/i
const contentsTitle = /^(?:table of )?contents$/i
const contentsRow = /(?:\.{2,}|…|·{2,})\s*\d+\s*$|^(?:chapter|part|book)\b.+\s\d+\s*$/i

export function looksLikeHeading(text: string) {
  return text.length <= 120 && !text.includes('\n') && !contentsRow.test(text) &&
    (chapterStart.test(text) || specialHeading.test(text))
}

export function chapterIndices(passages: string[], explicit: Set<string> = new Set()) {
  const indices: number[] = []
  let inContents = false
  let foundContentsRows = false
  passages.forEach((passage, index) => {
    const title = passage.trim()
    if (contentsTitle.test(title)) { inContents = true; foundContentsRows = false; return }
    if (contentsRow.test(title)) { foundContentsRows = true; return }
    if (inContents && !explicit.has(title)) {
      const next = passages[index + 1] || ''
      if (title.length < 130 && next.length < 130 && !(foundContentsRows && looksLikeHeading(title) && !looksLikeHeading(next) && !contentsRow.test(next))) return
    }
    inContents = false
    if (explicit.has(title) || looksLikeHeading(title)) indices.push(index)
  })
  return indices
}
