import type { ImportedBook } from './library'

const passages = [
  'At half past six, the reading room was still empty. Rain drew thin lines down the tall windows, and the lamps cast small circles of light across the oak tables.',
  'Mira took the chair closest to the window. In the drawer beside it, behind a card that said PLEASE RETURN ALL PENCILS, she found an envelope with her name on it.',
  'Inside was a map of the city with a single street missing. Someone had written in the margin: Walk there before you decide it was never here.',
  'She folded the map into her book. There were still a few pages left in the chapter, and the rain was beginning to sound like applause.',
  'By the time she stepped outside, the gutters had quieted. She turned toward the river, carrying a book she had nearly finished and a map she had only just begun to read.',
]

export const sample: ImportedBook = {
  book: {
    id: 'auden-reading-room-sample', title: 'The Room Before Rain', format: 'TXT',
    wordCount: passages.join(' ').split(/\s+/).length, passageCount: passages.length,
    addedAt: 0, cursor: 0, bookmarks: [], notes: [],
  },
  passages,
}
