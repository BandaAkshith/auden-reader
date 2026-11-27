import { deliveryFor } from './playbackClips'
import { VOICE_PROFILES } from './voiceCatalog'

export const voiceEngines = ['auto', 'natural', 'qwen', 'device'] as const
export const voiceEngineLabels = { auto: 'Automatic', natural: 'Kokoro only', qwen: 'Qwen3-TTS (local)', device: 'Device speech' } as const
export const qwenVoices = [...VOICE_PROFILES, 'Ryan', 'Aiden'] as const
export type QwenVoice = typeof qwenVoices[number]

export const qwenLocalUrl = 'http://127.0.0.1:8776/'
const host = qwenLocalUrl + 'v1'
export const onQwenCompanion = () => window.location.origin + '/' === qwenLocalUrl

async function bridge(path: string, options: RequestInit) {
  let response: Response
  try {
    response = await fetch(host + path, { ...options, cache: 'no-store', credentials: 'omit', redirect: 'error' })
  } catch (error) {
    if (options.signal?.aborted && options.signal.reason?.name === 'AbortError') throw error
    throw new Error('Could not reach Auden Qwen. Start the companion on this Mac, or try Open local Auden in Audio settings.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.error === 'string' ? body.error : 'The local Qwen companion returned an error.')
  }
  return response
}

export async function waitForQwen(signal: AbortSignal, loading: () => void) {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const response = await bridge('/health', { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
    if ((await response.json()).state === 'ready') return
    loading()
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, 1500)
      function abort() { window.clearTimeout(timer); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  throw new Error('Qwen is still loading. Wait until the companion says Qwen3-TTS ready, then try again.')
}

export function qwenDirection(text: string) {
  if (/^[\s“"‘']*choo[\s-]+choo\b/i.test(text)) return 'train'
  if (/^[\s“"‘']*tuck\. tuck\b/i.test(text)) return 'knock'
  return deliveryFor(text)
}

export async function renderQwen(text: string, voice: QwenVoice, speed: number, signal: AbortSignal, direction = qwenDirection(text)) {
  const response = await bridge('/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, direction, speed }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  return response.arrayBuffer()
}
