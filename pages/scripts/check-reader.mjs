import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const temporary = await mkdtemp(join(tmpdir(), 'auden-reader-'))
try {
  for (const name of ['chapters', 'readingLayout', 'playbackClips', 'voiceCatalog', 'qwen', 'narrationAudio']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    await writeFile(join(temporary, name + '.mjs'), outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
  }

  const { paginate, bookStructure } = await import(pathToFileURL(join(temporary, 'readingLayout.mjs')))
  const { makeClip, nextReadable, narrationBatch, batchUtterances, positionInClip, spokenText, deliveryFor, trimAudioPadding, FIRST_BATCH_SIZE, SUBSEQUENT_BATCH_SIZE, TARGET_READY_BUFFER_BATCHES } = await import(pathToFileURL(join(temporary, 'playbackClips.mjs')))
  const { qwenDirection, qwenVoices } = await import(pathToFileURL(join(temporary, 'qwen.mjs')))
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
  assert.equal(FIRST_BATCH_SIZE, 6)
  assert.equal(SUBSEQUENT_BATCH_SIZE, 8)
  assert.equal(TARGET_READY_BUFFER_BATCHES, 3)
  const { ADDITIONAL_MALE_VOICES, VOICE_PROFILES, naturalSpeaker } = await import(pathToFileURL(join(temporary, 'voiceCatalog.mjs')))
  assert.equal(ADDITIONAL_MALE_VOICES, 3)
  assert.deepEqual(VOICE_PROFILES, ['Deep Voice', 'Bass Voice', 'Manly Voice'])
  assert.deepEqual(qwenVoices.slice(0, ADDITIONAL_MALE_VOICES), VOICE_PROFILES)
  assert.equal(new Set(VOICE_PROFILES.map(naturalSpeaker)).size, ADDITIONAL_MALE_VOICES)
  const longSentence = 'This unusually long sentence adds several words to its clauses, '.repeat(9).trimEnd() + ' and then ends.'
  const book = [
    'Title to skip',
    'Rain fell. The lamp glowed.',
    longSentence,
    '“Go away,” he shouted.',
    'Mira went home. The fire was warm.',
    ...Array.from({ length: 33 }, (_, i) => `The lighthouse flashed ${i + 1} times.`),
  ]
  const skipTitle = index => index === 0
  const opening = narrationBatch(book, { index: 0, offset: 0 }, skipTitle, undefined, FIRST_BATCH_SIZE)
  assert.equal(opening.sentences, 6)
  assert.deepEqual(opening.next, { index: 5, offset: 0 })
  assert.equal(opening.parts[2].text, longSentence)
  assert.equal(positionInClip(opening, opening.parts[3].at + 4).part.point.index, 3)
  assert.equal(positionInClip(opening, opening.parts[3].at + 4).offset, 4)
  const tailSizes = []
  let nextStart = opening.next
  while (nextStart.index < book.length) {
    const batch = narrationBatch(book, nextStart, skipTitle)
    tailSizes.push(batch.sentences)
    nextStart = batch.next
    assert(tailSizes.length <= 5)
  }
  assert.deepEqual(tailSizes, [8, 8, 8, 8, 1])
  assert.equal(narrationBatch(book, opening.next, skipTitle, 8).sentences, 3)
  const utterances = batchUtterances(opening.parts.map(part => part.text), 220, deliveryFor)
  assert(utterances.every(item => item.text.length <= 220))
  assert.equal(utterances.map(item => item.text).join(' '), opening.parts.map(part => part.text.trim()).join(' '))
  assert(utterances.some(item => item.direction === 'emphatic' && item.text === '“Go away,” he shouted.'))
  const dialogue = ['The hall was quiet.', '“Go away,” he shouted.', '“I miss her,” she said through tears.']
  assert.equal(deliveryFor(dialogue[1]), 'emphatic')
  assert.equal(deliveryFor(dialogue[2]), 'sad')
  assert.equal(deliveryFor('The window snapped shut.'), 'plain')
  assert.equal(spokenText('Chu chu!', 'The train left the station.'), 'Choo-choo!')
  assert.equal(spokenText('Tuk tuk.', 'She knocked on the door.'), 'Tuck. Tuck.')
  assert.equal(spokenText('Tuk tuk passed by.', 'We were stuck in traffic.'), 'Tuk tuk passed by.')
  assert.equal(qwenDirection('Choo-choo! The train left.'), 'train')
  assert.equal(qwenDirection('Tuck. Tuck. She knocked.'), 'knock')
  assert.equal(qwenDirection(dialogue[2]), 'sad')
  assert.equal(qwenDirection('The train left the station.'), 'plain')
  const signal = new Float32Array(1000)
  signal.fill(.5, 350, 450)
  assert.equal(trimAudioPadding(signal, 1000).length, 235)
  assert.equal(trimAudioPadding(new Float32Array(100), 1000).length, 100)
  const { stretchSpeech, balanceSpeech } = await import(pathToFileURL(join(temporary, 'narrationAudio.mjs')))
  const sampleRate = 24_000
  const pitch = 145
  const tone = Float32Array.from({ length: sampleRate }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * pitch / sampleRate))
  assert.equal(stretchSpeech(tone, sampleRate, 1), tone)
  for (const speed of [.75, 1.15, 1.5, 2]) {
    const stretched = stretchSpeech(tone, sampleRate, speed)
    assert.equal(stretched.length, Math.round(sampleRate / speed))
    let cycles = 0
    for (let i = 1; i < stretched.length; i++) if (stretched[i - 1] <= 0 && stretched[i] > 0) cycles++
    assert(Math.abs(cycles * sampleRate / stretched.length - pitch) < 5)
    assert(stretched.every(Number.isFinite))
  }
  const quiet = new Float32Array(480).fill(.095)
  balanceSpeech(quiet, .115)
  assert(Math.abs(quiet[0] - .115) < .001)
  const sharp = Float32Array.of(.99, .08, .09)
  balanceSpeech(sharp, .115)
  assert(sharp[0] <= .9801)
  console.log('Reader regression checks passed.')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
