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

export const ADDITIONAL_MALE_VOICES = 3
export const VOICE_PROFILES = ['Deep Voice', 'Bass Voice', 'Manly Voice'] as const
const profileVoices = { 'Deep Voice': 'am_adam', 'Bass Voice': 'bm_lewis', 'Manly Voice': 'am_michael' } as const

export const naturalVoiceChoices = {
  'Deep Voice': 'Deep Voice',
  'Bass Voice': 'Bass Voice',
  'Manly Voice': 'Manly Voice',
  ...naturalVoices,
} as const
export type NaturalVoiceChoice = keyof typeof naturalVoiceChoices

export function naturalSpeaker(choice: NaturalVoiceChoice): NaturalVoice {
  return choice in profileVoices ? profileVoices[choice as keyof typeof profileVoices] : choice as NaturalVoice
}
