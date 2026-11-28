import { deliveryFor } from './playbackClips'
import { VOICE_PROFILES } from './voiceCatalog'

export const voiceEngines = ['auto', 'natural', 'qwen', 'device'] as const
export const voiceEngineLabels = { auto: 'Automatic', natural: 'Kokoro', qwen: 'Qwen3-TTS (local)', device: 'Device speech' } as const
export const permitsDeviceSpeech = (engine: typeof voiceEngines[number]) => engine === 'auto' || engine === 'device'
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
    throw Object.assign(new Error(typeof body?.error === 'string' ? body.error : 'The local Qwen companion returned an error.'), { status: response.status })
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

export async function renderQwen(text: string, voice: QwenVoice, signal: AbortSignal, direction = qwenDirection(text)) {
  const request = () => bridge('/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, direction, speed: 1 }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  for (const delay of [400, 1000, 2200]) {
    try { return await (await request()).arrayBuffer() }
    catch (error) {
      if ((error as { status?: number }).status !== 429) throw error
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, delay)
        function cancel() { clearTimeout(timer); reject(signal.reason) }
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
      })
    }
  }
  return (await request()).arrayBuffer()
}
