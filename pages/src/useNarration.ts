import { useEffect, useRef, useState } from 'react'
import { splitSentences } from './readingLayout'
import { usePreference } from './readerPreferences'
import { naturalVoices, type NaturalVoice } from './voiceCatalog'

export type Position = { index: number; offset: number }
type Clip = { point: Position; end: number; next: Position; text: string }
type AudioData = { samples: Float32Array; sampleRate: number }
type State = 'idle' | 'loading' | 'playing' | 'paused'
const sample = 'The lights in the reading room flickered. “Did you hear that?” Mira whispered, setting her book down.'

function makeClip(passages: string[], point: Position): Clip | undefined {
  const passage = passages[point.index]
  if (!passage) return
  const remaining = passage.slice(point.offset)
  const sentences = splitSentences(remaining)
  let length = sentences[0]?.text.length || remaining.length
  for (let index = 1; index < sentences.length && length + sentences[index].text.length <= 220; index++) {
    length += sentences[index].text.length
  }
  if (length > 340) length = remaining.slice(0, 340).search(/\s+\S*$/) > 180
    ? remaining.slice(0, 340).search(/\s+\S*$/) + 1 : 340
  const end = point.offset + length
  const next = passage.slice(end).trim() ? { index: point.index, offset: end } : { index: point.index + 1, offset: 0 }
  return { point, end, next, text: passage.slice(point.offset, end) }
}

export function useNarration(passages: string[], onPosition: (point: Position) => void, report: (message: string) => void, shouldSkip: (index: number) => boolean, nextChapter?: number) {
  const synth = window.speechSynthesis
  const [engine, setEngine] = usePreference<'natural' | 'device'>('engine', 'natural', ['natural', 'device'])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceKey, setVoiceKey] = usePreference<string>('voice', '')
  const [naturalVoice, setNaturalVoice] = usePreference<NaturalVoice>('natural-voice', 'am_michael', Object.keys(naturalVoices) as NaturalVoice[])
  const [rate, setRate] = usePreference<number>('rate', 1, [0.75, 0.8, 1, 1.15, 1.2, 1.3, 1.5, 1.75, 2])
  const [state, setState] = useState<State>('idle')
  const [boundary, setBoundary] = useState<{ start: number; end: number } | null>(null)
  const [minutes, setMinutes] = useState(0)
  const [clock, setClock] = useState({ elapsed: 0, duration: 0 })
  const config = useRef({ engine, naturalVoice, voiceKey, voices, rate, onPosition, report, shouldSkip })
  config.current = { engine, naturalVoice, voiceKey, voices, rate, onPosition, report, shouldSkip }
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const chapterStop = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const context = useRef<AudioContext | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const audio = useRef<{ buffer: AudioBuffer; offset: number; start: number; ended: () => void } | null>(null)
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const pending = useRef(new Map<number, { resolve: (data: AudioData) => void; reject: (error: Error) => void; progress: (status: string) => void; timeout: number }>())

  useEffect(() => {
    if (!synth) return
    const refresh = () => setVoices(synth.getVoices().filter(voice => voice.localService))
    refresh()
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [synth])

  useEffect(() => () => {
    generation.current++
    previewAudio.current?.pause()
    previewAudio.current = null
    window.clearTimeout(timer.current)
    if (utterance.current) { utterance.current = null; synth?.cancel() }
    worker.current?.terminate()
    worker.current = null
    for (const request of pending.current.values()) { window.clearTimeout(request.timeout); request.reject(new Error('Narration closed.')) }
    pending.current.clear()
    void context.current?.close()
    context.current = null
  }, [synth])

  useEffect(() => {
    if (state !== 'playing' || engine !== 'natural') return
    const interval = window.setInterval(() => {
      if (audio.current && source.current) {
        setClock({ elapsed: elapsed(), duration: audio.current.buffer.duration })
      }
    }, 200)
    return () => window.clearInterval(interval)
  }, [state, engine])

  function elapsed() {
    const clip = audio.current
    return clip ? Math.min(clip.buffer.duration, clip.offset + (source.current ? (context.current!.currentTime - clip.start) * source.current.playbackRate.value : 0)) : 0
  }

  function stopSource() {
    if (!source.current) return
    source.current.onended = null
    source.current.stop()
    source.current.disconnect()
    source.current = null
  }

  function stop() {
    generation.current++
    previewAudio.current?.pause()
    previewAudio.current = null
    if (utterance.current) { utterance.current = null; synth?.cancel() }
    stopSource()
    audio.current = null
    setClock({ elapsed: 0, duration: 0 })
    setState('idle')
    setBoundary(null)
  }

  function setSleepTimer(value: number) {
    window.clearTimeout(timer.current)
    chapterStop.current = value === -1 ? nextChapter ?? passages.length : undefined
    setMinutes(value)
    if (value > 0) timer.current = window.setTimeout(() => {
      stop()
      setMinutes(0)
      config.current.report('The sleep timer stopped narration.')
    }, value * 60_000)
  }

  function createWorker() {
    const instance = new Worker(new URL('./narration.worker.ts', import.meta.url), { type: 'module' })
    instance.onmessage = ({ data }) => {
      const request = pending.current.get(data.id)
      if (!request) return
      if (typeof data.progress === 'number') { request.progress(`Downloading Kokoro voice model · ${data.progress}%`); return }
      if (data.phase) { request.progress(data.phase); return }
      window.clearTimeout(request.timeout)
      pending.current.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data)
    }
    instance.onerror = () => {
      for (const request of pending.current.values()) { window.clearTimeout(request.timeout); request.reject(new Error('The voice worker could not start.')) }
      pending.current.clear()
      instance.terminate()
      if (worker.current === instance) worker.current = null
    }
    return instance
  }

  function generate(text: string, voice: NaturalVoice, speed: number, token: number, showProgress: boolean) {
    worker.current ??= createWorker()
    const id = ++requestId.current
    return new Promise<AudioData>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.current?.terminate()
        worker.current = null
        for (const request of pending.current.values()) {
          window.clearTimeout(request.timeout)
          request.reject(new Error('The Kokoro voice did not finish preparing.'))
        }
        pending.current.clear()
      }, 180_000)
      pending.current.set(id, { resolve, reject, timeout, progress: status => {
        if (showProgress && token === generation.current) config.current.report(status)
      } })
      worker.current!.postMessage({ id, text, voice, speed })
    })
  }

  function startBuffer(offset: number) {
    const clip = audio.current
    const ctx = context.current
    if (!clip || !ctx) return
    stopSource()
    clip.offset = Math.min(Math.max(0, offset), Math.max(0, clip.buffer.duration - .02))
    clip.start = ctx.currentTime
    const node = ctx.createBufferSource()
    node.buffer = clip.buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (source.current !== node) return
      source.current = null
      node.disconnect()
      clip.ended()
    }
    source.current = node
    node.start(0, clip.offset)
    setClock({ elapsed: clip.offset, duration: clip.buffer.duration })
    setState('playing')
  }

  function skip(point: Position) {
    let { index, offset } = point
    while (index < passages.length && config.current.shouldSkip(index)) { index++; offset = 0 }
    return { index, offset }
  }

  function done(point: Position) {
    if (chapterStop.current !== undefined && point.index >= chapterStop.current) {
      stop()
      setSleepTimer(0)
      config.current.report('Stopped at the end of the chapter.')
      return true
    }
    if (point.index >= passages.length) {
      stop()
      setSleepTimer(0)
      config.current.report('You reached the end of the book.')
      return true
    }
    return false
  }

  function play(point: Position, preview = false) {
    stop()
    const token = generation.current
    const origin = skip(point)
    config.current.report('')
    if (!preview && done(origin)) return
    if (config.current.engine === 'natural') {
      if (preview) {
        const player = new Audio(import.meta.env.BASE_URL + `voice-previews/${config.current.naturalVoice}.mp3`)
        previewAudio.current = player
        player.onended = () => { if (previewAudio.current === player) stop() }
        player.onerror = () => {
          if (previewAudio.current !== player) return
          stop()
          config.current.report('The voice preview could not load.')
        }
        setState('playing')
        void player.play().catch(() => { if (previewAudio.current === player) player.onerror?.(new Event('error')) })
        return
      }
      if (!window.AudioContext) { config.current.report('Choose Device speech to listen in this browser.'); return }
      context.current ??= new AudioContext()
      const ctx = context.current
      void ctx.resume().catch(() => undefined)
      const voice = config.current.naturalVoice
      async function run(clip: Clip, prepared?: Promise<AudioData | null>) {
        setState('loading')
        setClock({ elapsed: 0, duration: 0 })
        audio.current = null
        config.current.onPosition(clip.point)
        setBoundary({ start: clip.point.offset, end: clip.end })
        try {
          const data = (prepared && await prepared) || await generate(clip.text, voice, config.current.rate, token, true)
          if (token !== generation.current) return
          const buffer = ctx.createBuffer(1, data.samples.length, data.sampleRate)
          buffer.getChannelData(0).set(data.samples)
          const next = skip(clip.next)
          const following = (chapterStop.current === undefined || next.index < chapterStop.current)
            ? makeClip(passages, next) : undefined
          const preparedRate = config.current.rate
          const prefetch = following && ctx.state === 'running'
            ? generate(following.text, voice, preparedRate, token, false).catch(() => null) : undefined
          audio.current = { buffer, offset: 0, start: 0, ended: () => {
            if (token !== generation.current || done(next)) return
            const upcoming = following || makeClip(passages, next)
            if (upcoming) void run(upcoming, preparedRate === config.current.rate ? prefetch : undefined)
          } }
          if (ctx.state === 'running') {
            config.current.report('')
            startBuffer(0)
          } else {
            config.current.report('Audio is ready. Press Resume to play.')
            setClock({ elapsed: 0, duration: buffer.duration })
            setState('paused')
          }
        } catch {
          if (token !== generation.current) return
          stop()
          config.current.report('Kokoro audio could not load. Retry on a connection that can reach Hugging Face, or choose Device speech.')
        }
      }
      const clip = makeClip(passages, origin)
      if (clip) {
        config.current.report('Preparing natural narration…')
        void run(clip)
      }
      return
    }

    const voice = config.current.voices.find(item => item.voiceURI === config.current.voiceKey)
      || config.current.voices.find(item => item.default) || config.current.voices[0]
    if (!synth || !voice) { config.current.report('No on-device speech voice is available.'); return }
    const speak = (position: Position) => {
      const text = preview ? sample : passages[position.index].slice(position.offset)
      if (!preview) config.current.onPosition(position)
      setBoundary(null)
      const item = new SpeechSynthesisUtterance(text)
      item.voice = voice
      item.lang = voice.lang
      item.rate = config.current.rate
      item.onboundary = event => {
        const start = event.charIndex
        if (preview || utterance.current !== item || event.name !== 'word' || start < 0 || start >= text.length) return
        const length = event.charLength || text.slice(start).match(/^\S+/)?.[0].length || 1
        setBoundary({ start: position.offset + start, end: position.offset + Math.min(text.length, start + length) })
      }
      item.onend = () => {
        if (utterance.current !== item) return
        if (preview) { stop(); return }
        const next = skip({ index: position.index + 1, offset: 0 })
        if (!done(next)) speak(next)
      }
      item.onerror = event => {
        if (utterance.current !== item) return
        stop()
        config.current.report(`Device speech stopped (${event.error}). Try another voice.`)
      }
      utterance.current = item
      setState('playing')
      synth.speak(item)
    }
    if (synth.paused) synth.resume()
    speak(origin)
  }

  function toggle(point: Position) {
    if (previewAudio.current) {
      if (previewAudio.current.paused) {
        void previewAudio.current.play().then(() => setState('playing')).catch(() => stop())
      } else { previewAudio.current.pause(); setState('paused') }
      return
    }
    if (state === 'loading') { stop(); config.current.report(''); return }
    if (state === 'playing') {
      if (engine === 'natural' && audio.current) {
        audio.current.offset = elapsed()
        stopSource()
      } else synth?.pause()
      setState('paused')
    } else if (state === 'paused') {
      if (engine === 'natural' && audio.current) {
        void context.current?.resume().then(() => {
          if (audio.current) { config.current.report(''); startBuffer(audio.current.offset) }
        }).catch(() => config.current.report('The browser blocked audio. Tap Resume again.'))
      } else { synth?.resume(); setState('playing') }
    } else play(point)
  }

  function seek(seconds: number) {
    if (!audio.current) return
    const offset = Math.max(0, Math.min(audio.current.buffer.duration - .02, seconds))
    if (state === 'playing') startBuffer(offset)
    else { audio.current.offset = offset; setClock({ elapsed: offset, duration: audio.current.buffer.duration }) }
  }

  return { supported: engine === 'natural' ? Boolean(window.AudioContext) : Boolean(synth), voices, voiceKey, setVoiceKey,
    naturalVoice, setNaturalVoice, engine, setEngine, rate, setRate, state, boundary, toggle, stop, play, minutes, setSleepTimer, clock, seek }
}
