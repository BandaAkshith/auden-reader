export const naturalVoices = {
  am_michael: 'Michael · American',
  af_heart: 'Heart · American',
  af_bella: 'Bella · American',
  af_nicole: 'Nicole · American',
  af_nova: 'Nova · American',
  am_adam: 'Adam · American',
  am_echo: 'Echo · American',
  bm_george: 'George · British',
  bm_lewis: 'Lewis · British',
  bf_emma: 'Emma · British',
  bf_isabella: 'Isabella · British',
} as const

export type NaturalVoice = keyof typeof naturalVoices
