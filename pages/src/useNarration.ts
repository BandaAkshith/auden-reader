import { useEffect, useRef, useState } from 'react'
import { makeClip, nextReadable, type Clip, type Position } from './playbackClips'
import { usePreference } from './readerPreferences'
import { naturalVoices, type NaturalVoice } from './voiceCatalog'

export type { Position } from './playbackClips'
type AudioData = { samples: Float32Array; sampleRate: number }
type State = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused'
type Engine = 'auto' | 'natural' | 'device'
type Pending = { resolve: (data?: AudioData) => void; reject: (error: Error) => void; progress: (status: string) => void; timeout: number }
type Prediction = { clip: Clip; rate: number; promise: Promise<AudioData | null>; result?: AudioData | null }

const sample = 'The lights in the reading room flickered. “Did you hear that?” Mira whispered, setting her book down.'
const order = (a: Position, b: Position) => a.index - b.index || a.offset - b.offset

function resumeAudio(context: AudioContext): Promise<void> {
  if (context.state === 'running') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The browser paused audio.')), 2000)
    void context.resume().then(() => {
      window.clearTimeout(timeout)
      if (context.state === 'running') resolve()
      else reject(new Error('The browser paused audio.'))
    }, error => { window.clearTimeout(timeout); reject(error) })
  })
}

function initialEngine(): Engine {
  try { if (localStorage.getItem('auden-pages:engine') === '"device"') return 'device' }
  catch { /* Fall back to automatic voices. */ }
  return 'auto'
}

export function useNarration(passages: string[], onPosition: (point: Position) => void, report: (message: string) => void, shouldSkip: (index: number) => boolean, nextChapter?: number) {
  const synth = window.speechSynthesis
  const [engine, setEngine] = usePreference<Engine>('playback-engine', initialEngine(), ['auto', 'natural', 'device'])
  const [autoplay, setAutoplay] = usePreference<boolean>('playback-autoplay', true)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceKey, setVoiceKey] = usePreference<string>('voice', '')
  const [naturalVoice, setNaturalVoice] = usePreference<NaturalVoice>('natural-voice', 'am_michael', Object.keys(naturalVoices) as NaturalVoice[])
  const [rate, setRate] = usePreference<number>('rate', 1, [0.75, 0.8, 1, 1.15, 1.2, 1.3, 1.5, 1.75, 2])
  const [state, setState] = useState<State>('idle')
  const [speaker, setSpeaker] = useState<'device' | 'natural' | null>(null)
  const [boundary, setBoundary] = useState<{ start: number; end: number } | null>(null)
  const [minutes, setMinutes] = useState(0)
  const [clock, setClock] = useState({ elapsed: 0, duration: 0 })
  const config = useRef({ autoplay, rate, onPosition, report, shouldSkip })
  config.current = { autoplay, rate, onPosition, report, shouldSkip }
  const transport = useRef<{ paused: boolean; pause: () => void; resume: () => void } | undefined>(undefined)
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const chapterStop = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const context = useRef<AudioContext | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const audio = useRef<{ buffer: AudioBuffer; offset: number; start: number; ended: () => void } | null>(null)
  const worker = useRef<Worker | null>(null)
  const warm = useRef<Promise<void> | null>(null)
  const warmReady = useRef(false)
  const requestId = useRef(0)
  const pending = useRef(new Map<number, Pending>())

  useEffect(() => {
    if (!synth) return
    const refresh = () => setVoices(synth.getVoices().filter(voice => voice.localService))
    refresh()
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [synth])

  useEffect(() => () => {
    generation.current++
    window.clearTimeout(timer.current)
    previewAudio.current?.pause()
    if (utterance.current) { utterance.current = null; synth?.cancel() }
    stopSource()
    releaseWorker(new Error('Narration closed.'))
    void context.current?.close()
    context.current = null
  }, [synth])

  useEffect(() => {
    if (state !== 'playing' || speaker !== 'natural') return
    const interval = window.setInterval(() => {
      if (audio.current && source.current) setClock({ elapsed: elapsed(), duration: audio.current.buffer.duration })
    }, 200)
    return () => window.clearInterval(interval)
  }, [state, speaker])

  function elapsed() {
    const sound = audio.current
    return sound ? Math.min(sound.buffer.duration, sound.offset + (source.current ? context.current!.currentTime - sound.start : 0)) : 0
  }

  function stopSource() {
    if (!source.current) return
    source.current.onended = null
    source.current.stop()
    source.current.disconnect()
    source.current = null
  }

  function cancelUtterance() {
    if (!utterance.current) return
    utterance.current = null
    synth?.cancel()
  }

  function stop() {
    worker.current?.postMessage({ kind: 'cancel', session: generation.current })
    generation.current++
    transport.current = undefined
    previewAudio.current?.pause()
    previewAudio.current = null
    cancelUtterance()
    stopSource()
    audio.current = null
    setClock({ elapsed: 0, duration: 0 })
    setState('idle')
    setSpeaker(null)
    setBoundary(null)
  }

  function setSleepTimer(value: number) {
    window.clearTimeout(timer.current)
    chapterStop.current = value === -1 ? nextChapter ?? passages.length : undefined
    setMinutes(value)
    if (value > 0) timer.current = window.setTimeout(() => {
      stop()
      setSleepTimer(0)
      config.current.report('The sleep timer stopped narration.')
    }, value * 60_000)
  }

  function releaseWorker(error: Error) {
    worker.current?.terminate()
    worker.current = null
    warm.current = null
    warmReady.current = false
    for (const request of pending.current.values()) {
      window.clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.current.clear()
  }

  function request(kind: 'prepare' | 'synthesize', session: number, voice: NaturalVoice, reportStatus: boolean, text?: string, speed?: number) {
    if (!worker.current) {
      const instance = new Worker(new URL('./narration.worker.ts', import.meta.url), { type: 'module' })
      instance.onmessage = ({ data }) => {
        const request = pending.current.get(data.id)
        if (!request) return
        if (typeof data.progress === 'number') { request.progress(`Downloading Kokoro · ${data.progress}%`); return }
        if (data.phase) { request.progress(data.phase); return }
        window.clearTimeout(request.timeout)
        pending.current.delete(data.id)
        if (data.error) request.reject(new Error(data.error))
        else request.resolve(data.samples ? data : undefined)
      }
      instance.onerror = () => { if (worker.current === instance) releaseWorker(new Error('The voice worker could not start.')) }
      worker.current = instance
    }
    const id = ++requestId.current
    return new Promise<AudioData | undefined>((resolve, reject) => {
      const timeout = window.setTimeout(() => releaseWorker(new Error('Kokoro took too long to prepare.')), 150_000)
      pending.current.set(id, { resolve, reject, timeout, progress: status => {
        if (reportStatus && session === generation.current) config.current.report(status)
      } })
      worker.current!.postMessage({ kind, id, session, text, voice, speed })
    })
  }

  function prepareModel(session: number, showProgress: boolean) {
    if (!warm.current) {
      warm.current = request('prepare', session, naturalVoice, showProgress).then(() => { warmReady.current = true })
        .catch(error => { warm.current = null; throw error })
    }
    return warm.current
  }

  function startBuffer(offset: number) {
    const sound = audio.current
    const ctx = context.current
    if (!sound || !ctx) return
    stopSource()
    sound.offset = Math.min(Math.max(0, offset), Math.max(0, sound.buffer.duration - .02))
    sound.start = ctx.currentTime
    const node = ctx.createBufferSource()
    node.buffer = sound.buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (source.current !== node) return
      source.current = null
      node.disconnect()
      sound.ended()
    }
    source.current = node
    node.start(0, sound.offset)
    setClock({ elapsed: sound.offset, duration: sound.buffer.duration })
    setSpeaker('natural')
    setState('playing')
  }

  function playPreview() {
    if (engine === 'device') {
      const voice = deviceVoice()
      if (!synth || !voice) { report('No on-device voice is available.'); return }
      const item = new SpeechSynthesisUtterance(sample)
      item.voice = voice
      item.rate = rate
      utterance.current = item
      item.onend = () => { if (utterance.current === item) { utterance.current = null; stop() } }
      item.onerror = () => { if (utterance.current === item) { stop(); report('The voice preview could not play.') } }
      transport.current = { paused: false, pause: () => { synth.pause(); setState('paused') }, resume: () => { synth.resume(); setState('playing') } }
      setState('playing')
      synth.speak(item)
      return
    }
    const player = new Audio(import.meta.env.BASE_URL + `voice-previews/${naturalVoice}.mp3`)
    previewAudio.current = player
    player.onended = () => { if (previewAudio.current === player) stop() }
    const failed = () => { if (previewAudio.current === player) { stop(); report('The voice preview could not load.') } }
    player.onerror = failed
    const resume = () => { void player.play().then(() => {
      if (previewAudio.current === player && !transport.current?.paused) setState('playing')
    }).catch(failed) }
    transport.current = { paused: false, pause: () => { player.pause(); setState('paused') }, resume }
    resume()
  }

  function deviceVoice() {
    const available = voices.length ? voices : synth?.getVoices().filter(item => item.localService) || []
    return available.find(item => item.voiceURI === voiceKey)
      || available.find(item => item.default && /^en\b/i.test(item.lang))
      || available.find(item => item.name === 'Samantha' && /^en\b/i.test(item.lang))
      || available.find(item => /^en\b/i.test(item.lang)) || available.find(item => item.default) || available[0]
  }

  function play(point: Position, preview = false) {
    stop()
    config.current.report('')
    if (preview) { playPreview(); return }
    const session = generation.current
    const stillHere = () => session === generation.current
    const voice = deviceVoice()
    const natural = engine !== 'device' && Boolean(window.AudioContext)
    const automatic = natural && engine === 'auto' && Boolean(voice)
    const useDevice = engine === 'device' || automatic || (engine === 'auto' && !natural)
    let modelFailed = false
    let current: Clip
    let prediction: Prediction | undefined
    let lookahead = 1
    let completed = false
    let resumeStep = () => {}
    let pauseStep = () => {}
    let paused = false
    let usedDevice = false

    if (!natural && (!useDevice || !voice || !synth)) {
      config.current.report('Narration is unavailable in this browser.')
      return
    }
    if (natural) {
      context.current ??= new AudioContext()
      void context.current.resume().catch(() => undefined)
    }

    function nextClip(origin: Position) {
      const next = nextReadable(passages, origin, config.current.shouldSkip)
      if (chapterStop.current !== undefined && next.index >= chapterStop.current) return
      return makeClip(passages, next)
    }

    function finish() {
      const chapter = chapterStop.current !== undefined
      stop()
      setSleepTimer(0)
      config.current.report(chapter ? 'Stopped at the end of the chapter.' : 'You reached the end of the book.')
    }

    function queue(clip: Clip, visible: boolean): Prediction {
      const requestedRate = config.current.rate
      const job = {
        clip, rate: requestedRate,
        promise: request('synthesize', session, naturalVoice, visible, clip.text, requestedRate)
          .then(data => data || null).catch(() => null),
      } as Prediction
      void job.promise.then(data => {
        job.result = data
        if (!stillHere() || !automatic || prediction !== job || !current) return
        if (order(job.clip.point, current.point) <= 0 && usedDevice) {
          prediction = undefined
          lookahead = Math.min(lookahead + 1, 3)
          prefetch()
        }
      })
      return job
    }

    function prefetch() {
      if (!stillHere() || !current || !natural || modelFailed || !warmReady.current || !config.current.autoplay) return
      if (prediction && (prediction.result === undefined || order(prediction.clip.point, current.point) > 0)) return
      let candidate = nextClip(current.next)
      for (let ahead = 1; automatic && candidate && ahead < lookahead; ahead++) candidate = nextClip(candidate.next)
      prediction = candidate ? queue(candidate, false) : undefined
    }

    function complete(clip: Clip) {
      if (!stillHere()) return
      const next = nextClip(clip.next)
      if (!next) { finish(); return }
      if (config.current.autoplay) { advance(next); return }
      completed = true
      audio.current = null
      setClock({ elapsed: 0, duration: 0 })
      if (transport.current) transport.current.paused = true
      resumeStep = () => { completed = false; advance(next) }
      setState('paused')
      config.current.report('Autoplay is off.')
    }

    function speak(clip: Clip, offset = clip.point.offset, allowFallback = false) {
      usedDevice = true
      if (!synth || !voice) { stop(); report('No on-device voice is available.'); return }
      let spoken = offset
      const item = new SpeechSynthesisUtterance(passages[clip.point.index].slice(offset, clip.end))
      item.voice = voice
      item.lang = voice.lang
      item.rate = config.current.rate
      item.onboundary = event => {
        if (utterance.current !== item || event.name !== 'word' || event.charIndex < 0 || event.charIndex >= item.text.length) return
        spoken = offset + event.charIndex
        const length = event.charLength || item.text.slice(event.charIndex).match(/^\S+/)?.[0].length || 1
        setBoundary({ start: spoken, end: Math.min(clip.end, spoken + length) })
      }
      item.onend = () => { if (utterance.current === item) { utterance.current = null; complete(clip) } }
      item.onerror = () => {
        if (utterance.current !== item || !stillHere()) return
        utterance.current = null
        if (allowFallback) { startNatural(clip); return }
        stop()
        report('Device speech could not continue. Try a different voice.')
      }
      pauseStep = () => { cancelUtterance(); resumeStep = () => speak(clip, spoken, allowFallback) }
      resumeStep = () => speak(clip, spoken, allowFallback)
      utterance.current = item
      setSpeaker('device')
      setState('playing')
      if (synth.paused) synth.resume()
      synth.speak(item)
      prefetch()
    }

    function startNatural(clip: Clip, job?: Prediction) {
      usedDevice = false
      const ctx = context.current!
      setSpeaker(null)
      setState(paused ? 'paused' : clip === first ? 'loading' : 'buffering')
      pauseStep = () => {}
      resumeStep = () => setState(clip === first ? 'loading' : 'buffering')
      void prepareModel(session, !automatic).then(() => {
        if (!stillHere()) return null
        return (job?.rate === config.current.rate ? job : queue(clip, !automatic)).promise
      }).then(data => {
        if (!stillHere()) return
        if (!data) throw new Error('Audio could not be rendered.')
        const buffer = ctx.createBuffer(1, data.samples.length, data.sampleRate)
        buffer.getChannelData(0).set(data.samples)
        audio.current = { buffer, offset: 0, start: 0, ended: () => complete(clip) }
        resumeStep = () => {
          void resumeAudio(ctx).then(() => {
            if (stillHere() && !paused && current === clip && audio.current) {
              config.current.report('')
              startBuffer(audio.current.offset)
            }
          }).catch(() => {
            if (!stillHere()) return
            if (automatic) {
              audio.current = null
              setClock({ elapsed: 0, duration: 0 })
              if (paused) resumeStep = () => speak(clip)
              else speak(clip)
            }
            else {
              paused = true
              if (transport.current) transport.current.paused = true
              setState('paused')
              config.current.report('Press Resume to allow audio playback.')
            }
          })
        }
        pauseStep = () => { if (audio.current) audio.current.offset = elapsed(); stopSource() }
        setClock({ elapsed: 0, duration: buffer.duration })
        setBoundary({ start: clip.point.offset, end: clip.end })
        if (!paused) resumeStep()
        prefetch()
      }).catch(() => {
        if (!stillHere()) return
        if (automatic) {
          modelFailed = true
          config.current.report('Kokoro is unavailable. Continuing with the device voice.')
          resumeStep = () => speak(clip)
          if (!paused) resumeStep()
        } else {
          stop()
          config.current.report('Kokoro audio could not load. Try Automatic or Device speech.')
        }
      })
    }

    function advance(clip: Clip) {
      if (!stillHere()) return
      current = clip
      audio.current = null
      setClock({ elapsed: 0, duration: 0 })
      setBoundary({ start: clip.point.offset, end: clip.end })
      config.current.onPosition(clip.point)
      const job = prediction
      const match = job && order(job.clip.point, clip.point) === 0 && job.rate === config.current.rate ? job : undefined
      if (match && (match.result !== undefined || !automatic)) prediction = undefined
      if (natural && (!automatic || match?.result)) { startNatural(clip, match); return }
      if (automatic) config.current.report(modelFailed ? 'Using device voice.' : warmReady.current ? 'Device voice while Kokoro buffers.' : 'Device voice while Kokoro loads.')
      speak(clip, clip.point.offset, automatic && !modelFailed)
    }

    const first = nextClip(point)
    if (!first) { finish(); return }
    transport.current = {
      paused: false,
      pause: () => { paused = true; pauseStep(); setState('paused') },
      resume: () => {
        paused = false
        if (completed) config.current.report('')
        resumeStep()
      },
    }
    if (automatic) void prepareModel(session, false).then(prefetch).catch(() => {
      if (!stillHere()) return
      modelFailed = true
      config.current.report('Kokoro could not load. Continuing with the device voice.')
    })
    advance(first)
  }

  function toggle(point: Position) {
    const controls = transport.current
    if (!controls) { play(point); return }
    controls.paused = !controls.paused
    if (controls.paused) controls.pause()
    else controls.resume()
  }

  function seek(seconds: number) {
    if (!audio.current) return
    const offset = Math.max(0, Math.min(audio.current.buffer.duration - .02, seconds))
    if (state === 'playing') startBuffer(offset)
    else { audio.current.offset = offset; setClock({ elapsed: offset, duration: audio.current.buffer.duration }) }
  }

  const supported = (engine !== 'device' && Boolean(window.AudioContext)) || (engine !== 'natural' && Boolean(synth))
  return { supported, voices, voiceKey, setVoiceKey, naturalVoice, setNaturalVoice, engine, setEngine, autoplay, setAutoplay,
    rate, setRate, state, speaker, boundary, toggle, stop, play, minutes, setSleepTimer, clock, seek }
}
