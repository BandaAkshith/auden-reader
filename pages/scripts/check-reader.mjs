import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const temporary = await mkdtemp(join(tmpdir(), 'auden-reader-'))
try {
  for (const name of ['chapters', 'readingLayout', 'playbackClips']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    await writeFile(join(temporary, name + '.mjs'), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
  }

  const { paginate, bookStructure } = await import(pathToFileURL(join(temporary, 'readingLayout.mjs')))
  const { makeClip, nextReadable, naturalClip, positionInClip } = await import(pathToFileURL(join(temporary, 'playbackClips.mjs')))
  const passages = ['Chapter 1: Arrival', 'Part I: The Harbor', 'A long line with words in it. '.repeat(90),
    'Chapter 2: Departure', 'Part II: The Coast', 'Then the ship left. '.repeat(80), 'Afterword', 'Appendix']
  const structure = bookStructure(passages)

  for (const width of [14, 24, 45, 67]) for (const height of [8, 11, 17, 29]) {
    const { leaves, pageAt } = paginate(passages, structure, width, height)
    const rebuilt = passages.map(() => '')
    for (const [page, leaf] of leaves.entries()) {
      assert(leaf.some(part => !structure.opening.has(part.index)), 'A leaf contains headings without body text')
      for (const part of leaf) {
        assert.equal(pageAt(part.index, part.from), page)
        rebuilt[part.index] += passages[part.index].slice(part.from, part.to)
      }
    }
    assert.deepEqual(rebuilt, passages)
  }

  const contents = Array.from({ length: 24 }, (_, index) => `Chapter ${index + 1}: A chapter title`).join(' ')
  const withContents = ['Contents', contents, 'Chapter 1: A chapter title', 'The first chapter begins here.']
  const printed = bookStructure(withContents)
  const printedPages = paginate(withContents, printed, 26, 9)
  const splitRows = printedPages.leaves.flatMap(leaf => leaf.filter(part => part.rows))
  assert(splitRows.length > 1, 'A long table of contents should turn across several leaves')
  assert.equal(splitRows.flatMap(({ rows }) => printed.printedPassages.get(1).slice(...rows)).length, 24)
  assert.equal(splitRows.map(part => contents.slice(part.from, part.to)).join(''), contents)

  const segments = ['Contents to skip', 'The red fox ran. '.repeat(38), 'A new line.']
  const shouldSkip = index => index === 0
  let position = nextReadable(segments, { index: 0, offset: 0 }, shouldSkip)
  let transcript = ''
  let clips = 0
  while (position.index < segments.length) {
    const clip = makeClip(segments, position)
    assert(clip && clip.text.length <= 300)
    transcript += clip.text
    position = nextReadable(segments, clip.next, shouldSkip)
    assert(++clips < 20, 'Playback position did not advance')
  }
  assert.equal(transcript.trim(), (segments[1] + segments[2]).trim())
  assert(clips > 2)
  const short = ['Rain fell.', 'The lamp glowed.', 'A bell rang.', 'The ferry arrived.', 'Mira went home.', 'The fire was warm.']
  const group = naturalClip(short, { index: 0, offset: 0 }, () => false)
  assert.equal(group.sentences, 5)
  assert.equal(naturalClip(short, { index: 0, offset: 0 }, () => false, undefined, 1).sentences, 1)
  assert.deepEqual(group.next, { index: 5, offset: 0 })
  assert.equal(positionInClip(group, group.parts[3].at + 4).part.point.index, 3)
  assert.equal(positionInClip(group, group.parts[3].at + 4).offset, 4)
  assert.equal(naturalClip(short, { index: 0, offset: 0 }, () => false, 2).sentences, 2)
  assert.equal(naturalClip(short, { index: 0, offset: 0 }, index => index === 2).parts[2].point.index, 3)
  console.log('Reader regression checks passed.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
