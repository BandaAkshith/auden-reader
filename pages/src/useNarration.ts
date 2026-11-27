import { useEffect, useRef, useState } from 'react'
import { batchUtterances, delivery, deliveryFor, FIRST_BATCH_SIZE, makeClip, narrationBatch, nextReadable, positionInClip, spokenText, TARGET_READY_BUFFER_BATCHES, trimAudioPadding, type Clip, type NarrationBatch, type Position } from './playbackClips'
import { profileKey } from './accounts'
import { usePreference } from './readerPreferences'
import { naturalSpeaker, naturalVoiceChoices, type NaturalVoice, type NaturalVoiceChoice } from './voiceCatalog'
import { onQwenCompanion, qwenDirection, qwenVoices, renderQwen, voiceEngines, waitForQwen, type QwenVoice } from './qwen'
import { balanceSpeech, stretchSpeech } from './narrationAudio'

export type { Position } from './playbackClips'
type AudioData = { samples: Float32Array; sampleRate: number }
type State = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused'
type Engine = typeof voiceEngines[number]
type Lane = 0 | 1
type Pending = { lane: Lane; resolve: (data?: AudioData) => void; reject: (error: Error) => void; progress: (status: string) => void; timeout: number }
type SpeechClip = Clip | NarrationBatch
type Prediction = { clip: SpeechClip; voice: string; lane: Lane; promise: Promise<AudioBuffer | null>; result?: AudioBuffer | null }
type PlayingAudio = { buffer: AudioBuffer; voice: string; offset: number; start: number; speed: number; ended: () => void; progress: (seconds: number) => void; schedule: () => void }
type ScheduledAudio = { job: Prediction; node: AudioBufferSourceNode; time: number; rate: number }

const sample = 'The lights in the reading room flickered. “Did you hear that?” Mira whispered, setting her book down.'
const order = (a: Position, b: Position) => a.index - b.index || a.offset - b.offset
const sameClip = (a: SpeechClip, b: SpeechClip) => order(a.point, b.point) === 0 && order(a.next, b.next) === 0

function canRenderInParallel() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const desktopMac = /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints < 2
  return navigator.hardwareConcurrency >= 6 && (memory === undefined ? desktopMac : memory >= 8)
}

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
  if (onQwenCompanion()) return 'qwen'
  try { if (localStorage.getItem(profileKey('engine')) === '"device"') return 'device' }
  catch { /* Fall back to automatic voices. */ }
  return 'auto'
}

export function useNarration(passages: string[], onPosition: (point: Position) => void, report: (message: string) => void, shouldSkip: (index: number) => boolean, nextChapter?: number) {
  const synth = window.speechSynthesis
  const [engine, setEngine] = usePreference<Engine>('playback-engine', initialEngine(), voiceEngines)
  const [autoplay, setAutoplay] = usePreference<boolean>('playback-autoplay', true)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceKey, setVoiceKey] = usePreference<string>('voice', '')
  const [naturalVoice, setNaturalVoice] = usePreference<NaturalVoiceChoice>('natural-voice', 'am_michael', Object.keys(naturalVoiceChoices) as NaturalVoiceChoice[])
  const [qwenVoice, setQwenVoice] = usePreference<QwenVoice>('qwen-voice', 'Ryan', qwenVoices)
  const [rate, setRate] = usePreference<number>('rate', 1, [0.75, 0.8, 1, 1.15, 1.2, 1.3, 1.5, 1.75, 2])
  const [state, setState] = useState<State>('idle')
  const [speaker, setSpeaker] = useState<'device' | 'natural' | null>(null)
  const [playingVoice, setPlayingVoice] = useState<string>()
  const [boundary, setBoundary] = useState<{ start: number; end: number } | null>(null)
  const [minutes, setMinutes] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [preparation, setPreparation] = useState<'idle' | 'preparing' | 'ready'>('idle')
  const [qwenPreparation, setQwenPreparation] = useState(false)
  const [clock, setClock] = useState({ elapsed: 0, duration: 0 })
  const config = useRef({ autoplay, rate, naturalVoice, qwenVoice, onPosition, report, shouldSkip })
  config.current = { autoplay, rate, naturalVoice, qwenVoice, onPosition, report, shouldSkip }
  const transport = useRef<{ paused: boolean; pause: () => void; resume: () => void; changeDeviceRate?: () => void } | undefined>(undefined)
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const chapterStop = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const context = useRef<AudioContext | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)
  const audio = useRef<PlayingAudio | null>(null)
  const scheduled = useRef<ScheduledAudio | null>(null)
  const stretched = useRef(new WeakMap<AudioBuffer, { rate: number; buffer: AudioBuffer }>())
  const workers = useRef<[Worker | null, Worker | null]>([null, null])
  const parallelFailed = useRef(false)
  const warm = useRef<Promise<void> | null>(null)
  const warmReady = useRef(false)
  const requestId = useRef(0)
  const qwenRequest = useRef<AbortController | null>(null)
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
    qwenRequest.current?.abort()
    if (utterance.current) { utterance.current = null; synth?.cancel() }
    stopSource()
    releaseWorker(new Error('Narration closed.'))
    void context.current?.close()
    context.current = null
  }, [synth])

  useEffect(() => {
    if (state !== 'playing' || speaker !== 'natural') return
    const interval = window.setInterval(() => {
      if (audio.current && source.current) {
        const seconds = elapsed()
        setClock({ elapsed: seconds, duration: audio.current.buffer.duration })
        audio.current.progress(seconds)
      }
    }, 200)
    return () => window.clearInterval(interval)
  }, [state, speaker])

  useEffect(() => {
    audio.current?.schedule()
  }, [autoplay])

  useEffect(() => {
    if (previewAudio.current) previewAudio.current.playbackRate = rate
    if (transport.current?.paused) return
    if (audio.current && source.current) {
      atSpeed(audio.current.buffer)
      const position = elapsed()
      if (audio.current.buffer.duration - position > .025) startBuffer(position)
      else audio.current.schedule()
    } else transport.current?.changeDeviceRate?.()
  }, [rate])

  function elapsed() {
    const sound = audio.current
    return sound ? Math.min(sound.buffer.duration, sound.offset + (source.current ? (context.current!.currentTime - sound.start) * sound.speed : 0)) : 0
  }

  function cancelScheduled() {
    const queued = scheduled.current
    if (!queued) return
    queued.node.stop()
    queued.node.disconnect()
    scheduled.current = null
  }

  function stopSource() {
    cancelScheduled()
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
    for (const worker of workers.current) worker?.postMessage({ kind: 'cancel', session: generation.current })
    generation.current++
    qwenRequest.current?.abort()
    qwenRequest.current = null
    setQwenPreparation(false)
    transport.current = undefined
    previewAudio.current?.pause()
    previewAudio.current = null
    cancelUtterance()
    stopSource()
    audio.current = null
    setClock({ elapsed: 0, duration: 0 })
    setState('idle')
    setSpeaker(null)
    setPlayingVoice(undefined)
    setBoundary(null)
    setBuffered(0)
  }

  function setSleepTimer(value: number) {
    window.clearTimeout(timer.current)
    chapterStop.current = value === -1 ? nextChapter ?? passages.length : undefined
    audio.current?.schedule()
    setMinutes(value)
    if (value > 0) timer.current = window.setTimeout(() => {
      stop()
      setSleepTimer(0)
      config.current.report('The sleep timer stopped narration.')
    }, value * 60_000)
  }

  function releaseWorker(error: Error, lane?: Lane) {
    if (lane !== 1) {
      workers.current[0]?.terminate()
      workers.current[0] = null
      warm.current = null
      warmReady.current = false
    }
    if (lane !== 0) {
      workers.current[1]?.terminate()
      workers.current[1] = null
    }
    for (const [id, request] of pending.current) {
      if (lane !== undefined && request.lane !== lane) continue
      window.clearTimeout(request.timeout)
      request.reject(error)
      pending.current.delete(id)
    }
  }

  function request(kind: 'prepare' | 'synthesize', session: number, voice: NaturalVoice, reportStatus: boolean, text?: string, speed?: number, lane: Lane = 0) {
    if (!workers.current[lane]) {
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
      instance.onerror = () => {
        if (workers.current[lane] !== instance) return
        releaseWorker(new Error('The voice worker could not start.'), lane)
        if (lane === 0) setPreparation('idle')
      }
      workers.current[lane] = instance
    }
    const id = ++requestId.current
    return new Promise<AudioData | undefined>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        releaseWorker(new Error('Kokoro took too long to prepare.'), lane)
        if (lane === 0) setPreparation('idle')
      }, 150_000)
      pending.current.set(id, { lane, resolve, reject, timeout, progress: status => {
        if (reportStatus && session === generation.current) config.current.report(status)
      } })
      workers.current[lane]!.postMessage({ kind, id, session, text, voice, speed })
    })
  }

  function prepareModel(session: number, showProgress: boolean) {
    if (!warm.current) {
      setPreparation('preparing')
      warm.current = request('prepare', session, naturalSpeaker(config.current.naturalVoice), showProgress).then(() => {
        warmReady.current = true
        setPreparation('ready')
      }).catch(error => {
        warm.current = null
        setPreparation('idle')
        throw error
      })
    }
    return warm.current
  }

  async function prepareKokoro() {
    const session = generation.current
    config.current.report('Preparing the Kokoro model…')
    try {
      await prepareModel(session, true)
      if (session === generation.current) config.current.report('Kokoro is ready to start.')
    } catch {
      if (session === generation.current) config.current.report('Kokoro could not load. Try again or switch to Device speech.')
    }
  }

  async function prepareQwen() {
    qwenRequest.current?.abort()
    const request = new AbortController()
    qwenRequest.current = request
    setQwenPreparation(true)
    try {
      await waitForQwen(request.signal, () => config.current.report('Qwen is loading on this Mac…'))
      if (!request.signal.aborted) config.current.report('Qwen3-TTS is ready.')
    } catch (error) {
      if (!request.signal.aborted) config.current.report((error as Error).message)
    } finally {
      if (qwenRequest.current === request) {
        qwenRequest.current = null
        setQwenPreparation(false)
      }
    }
  }

  function atSpeed(original: AudioBuffer) {
    const rate = config.current.rate
    if (rate === 1) return original
    const cached = stretched.current.get(original)
    if (cached?.rate === rate) return cached.buffer
    const samples = stretchSpeech(original.getChannelData(0), original.sampleRate, rate)
    const buffer = context.current!.createBuffer(1, samples.length, original.sampleRate)
    buffer.getChannelData(0).set(samples)
    stretched.current.set(original, { rate, buffer })
    return buffer
  }

  function startBuffer(offset: number, prepared?: ScheduledAudio) {
    const sound = audio.current
    const ctx = context.current
    if (!sound || !ctx) return
    if (prepared) scheduled.current = null
    else stopSource()
    sound.offset = Math.min(Math.max(0, offset), Math.max(0, sound.buffer.duration - .02))
    const node = prepared?.node ?? ctx.createBufferSource()
    if (!prepared) {
      node.buffer = atSpeed(sound.buffer)
      node.connect(ctx.destination)
    }
    sound.speed = sound.buffer.duration / node.buffer!.duration
    sound.start = prepared?.time ?? ctx.currentTime
    node.onended = () => {
      if (source.current !== node) return
      source.current = null
      node.disconnect()
      sound.ended()
    }
    source.current = node
    if (!prepared) node.start(sound.start, sound.offset / sound.speed)
    setClock({ elapsed: sound.offset, duration: sound.buffer.duration })
    setSpeaker('natural')
    setPlayingVoice(sound.voice)
    setState('playing')
    sound.schedule()
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
    const player = new Audio(import.meta.env.BASE_URL + `voice-previews/${naturalSpeaker(naturalVoice)}.mp3`)
    player.playbackRate = rate
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
    const qwen = engine === 'qwen'
    if (preview && !qwen) { playPreview(); return }
    const session = generation.current
    const qwenSession = qwen ? new AbortController() : null
    if (qwenSession) qwenRequest.current = qwenSession
    let qwenReady = false
    let renderError = ''
    const stillHere = () => session === generation.current
    const voice = deviceVoice()
    const natural = engine !== 'device' && Boolean(window.AudioContext)
    const automatic = natural && engine === 'auto' && Boolean(voice)
    const useDevice = engine === 'device' || automatic || (engine === 'auto' && !natural)
    let modelFailed = false
    let current: SpeechClip
    let bufferQueue: Prediction[] = []
    const inFlight: [Prediction?, Prediction?] = []
    let highlighted: Position | undefined
    let completed = false
    let resumeStep = () => {}
    let pauseStep = () => {}
    let rateStep: (() => void) | undefined
    let paused = false

    if (!natural && (!useDevice || !voice || !synth)) {
      config.current.report('Narration is unavailable in this browser.')
      return
    }
    if (natural) {
      context.current ??= new AudioContext()
      void context.current.resume().catch(() => undefined)
    }

    function nextClip(origin: Position, maximumSentences?: number) {
      if (preview) return origin.index === 0 ? { point: origin, end: sample.length, next: { index: 1, offset: 0 }, text: sample } : undefined
      const next = nextReadable(passages, origin, config.current.shouldSkip)
      if (chapterStop.current !== undefined && next.index >= chapterStop.current) return
      return natural ? narrationBatch(passages, next, config.current.shouldSkip, chapterStop.current, maximumSentences) : makeClip(passages, next)
    }

    function finish() {
      const chapter = chapterStop.current !== undefined
      stop()
      if (preview) return
      setSleepTimer(0)
      config.current.report(chapter ? 'Stopped at the end of the chapter.' : 'You reached the end of the book.')
    }

    function updateBuffer() {
      let next = nextClip(current.next)
      let ready = 0
      while (next) {
        const clip = next
        const job = bufferQueue.find(item => item.result && sameClip(item.clip, clip))
        if (!job) break
        ready++
        next = nextClip(job.clip.next)
      }
      setBuffered(ready)
    }

    function queue(clip: SpeechClip, visible: boolean, lane: Lane = 0): Prediction {
      const { naturalVoice: chosenNatural, qwenVoice: chosenQwen } = config.current
      const parts = 'parts' in clip ? clip.parts : [clip]
      const sentences = preview ? [sample] : parts.map(part => {
        const index = part.point.index
        const nearby = passages[index].slice(Math.max(0, part.point.offset - 100), part.end + 180)
        return spokenText(part.text, nearby + ' ' + (passages[index + 1]?.slice(0, 120) || ''))
      })
      const job: Prediction = {
        clip, lane, voice: qwen ? chosenQwen : naturalVoiceChoices[chosenNatural],
        promise: Promise.resolve().then(async () => {
          const ctx = context.current!
          const pieces: Float32Array[] = []
          let sampleRate = 0
          if (qwenSession) {
            for (const item of batchUtterances(sentences, 410, qwenDirection)) {
              if (!stillHere()) return null
              const wav = await renderQwen(item.text, chosenQwen, qwenSession.signal, item.direction)
              if (!stillHere()) return null
              const decoded = await ctx.decodeAudioData(wav)
              sampleRate = decoded.sampleRate
              const samples = trimAudioPadding(decoded.getChannelData(0), sampleRate)
              balanceSpeech(samples, item.direction === 'quiet' ? .078 : .115)
              pieces.push(samples)
            }
          } else {
            for (const item of batchUtterances(sentences, 220, deliveryFor)) {
              if (!stillHere()) return null
              const style = delivery[item.direction]
              const data = await request('synthesize', session, naturalSpeaker(chosenNatural), visible, item.text, style.pace, lane)
              if (!data || !stillHere()) return null
              sampleRate = data.sampleRate
              const samples = trimAudioPadding(data.samples, sampleRate)
              if (style.volume !== 1) {
                for (let i = 0; i < samples.length; i++) samples[i] *= style.volume
              }
              pieces.push(samples)
            }
          }
          if (!stillHere() || !pieces.length) return null
          const buffer = ctx.createBuffer(1, pieces.reduce((length, piece) => length + piece.length, 0), sampleRate)
          const channel = buffer.getChannelData(0)
          let offset = 0
          for (const samples of pieces) {
            channel.set(samples, offset)
            offset += samples.length
          }
          return buffer
        }).catch(error => {
          if (qwen && visible && stillHere()) renderError = (error as Error).message
          if (lane === 1 && stillHere()) {
            parallelFailed.current = true
            releaseWorker(new Error('Parallel rendering is unavailable.'), lane)
          }
          return null
        }),
      }
      inFlight[lane] = job
      void job.promise.then(data => {
        job.result = data
        if (inFlight[lane] === job) inFlight[lane] = undefined
        if (!stillHere() || !current) return
        if (data || lane === 1) prefetch()
        else updateBuffer()
      })
      return job
    }

    function prefetch() {
      if (!stillHere() || !current || preview || !natural || modelFailed || !(qwen ? qwenReady : warmReady.current)) return
      bufferQueue = bufferQueue.filter(job => order(job.clip.point, current.point) > 0 && job.result !== null &&
        (chapterStop.current === undefined || ('parts' in job.clip ? job.clip.parts.at(-1)!.point.index : job.clip.point.index) < chapterStop.current))
      // A chapter timer can change a previously planned batch boundary.
      const planned: SpeechClip[] = []
      let candidate = nextClip(current.next)
      while (candidate && planned.length < TARGET_READY_BUFFER_BATCHES) {
        planned.push(candidate)
        candidate = nextClip(candidate.next)
      }
      bufferQueue = bufferQueue.filter(item => planned.some(clip => sameClip(item.clip, clip)))
      updateBuffer()
      scheduleNext()
      if (!config.current.autoplay || bufferQueue.length >= TARGET_READY_BUFFER_BATCHES) return
      const parallel = !qwen && !automatic && !parallelFailed.current && canRenderInParallel()
      for (const lane of parallel ? [0, 1] as const : [0] as const) {
        if (inFlight[lane]) continue
        const candidate = planned.find(clip => !bufferQueue.some(item => sameClip(item.clip, clip)))
        if (candidate) bufferQueue.push(queue(candidate, false, lane))
      }
    }

    function scheduleNext() {
      const ctx = context.current
      const sound = audio.current
      const playing = source.current
      const next = config.current.autoplay && nextClip(current.next)
      const job = next && bufferQueue.find(item => item.result && sameClip(item.clip, next))
      if (scheduled.current?.job === job && scheduled.current?.rate === config.current.rate) return
      cancelScheduled()
      if (!ctx || !sound || !playing || paused || !job || !job.result) return
      const time = sound.start + (sound.buffer.duration - sound.offset) / sound.speed
      if (time <= ctx.currentTime) return
      const node = ctx.createBufferSource()
      node.buffer = atSpeed(job.result)
      if (time <= ctx.currentTime) return
      node.connect(ctx.destination)
      node.start(time)
      scheduled.current = { job, node, time, rate: config.current.rate }
    }

    function highlight(clip: SpeechClip, offset: number, wordLength?: number) {
      if (preview) return
      const { part, offset: sourceOffset } = positionInClip(clip, offset)
      if (!highlighted || order(highlighted, part.point) !== 0) {
        highlighted = part.point
        config.current.onPosition(part.point)
      }
      setBoundary(wordLength
        ? { start: sourceOffset, end: Math.min(part.end, sourceOffset + wordLength) }
        : { start: part.point.offset, end: part.end })
    }

    function complete(clip: SpeechClip) {
      if (!stillHere()) return
      const next = nextClip(clip.next)
      if (!next) { finish(); return }
      if (config.current.autoplay) { advance(next); return }
      cancelScheduled()
      completed = true
      audio.current = null
      setClock({ elapsed: 0, duration: 0 })
      if (transport.current) transport.current.paused = true
      resumeStep = () => { completed = false; advance(next) }
      setState('paused')
      config.current.report('Autoplay is off.')
    }

    function speak(clip: SpeechClip, offset = 0, allowFallback = false) {
      if (!synth || !voice) { stop(); report('No on-device voice is available.'); return }
      let spoken = offset
      const item = new SpeechSynthesisUtterance(clip.text.slice(offset))
      const style = delivery[deliveryFor(clip.text)]
      highlight(clip, offset)
      item.voice = voice
      item.lang = voice.lang
      item.rate = config.current.rate * style.pace
      item.pitch = style.pitch
      item.volume = style.volume
      item.onboundary = event => {
        if (utterance.current !== item || event.name !== 'word' || event.charIndex < 0 || event.charIndex >= item.text.length) return
        spoken = offset + event.charIndex
        const length = event.charLength || item.text.slice(event.charIndex).match(/^\S+/)?.[0].length || 1
        highlight(clip, spoken, length)
      }
      item.onend = () => {
        if (utterance.current !== item) return
        utterance.current = null
        complete(clip)
      }
      item.onerror = () => {
        if (utterance.current !== item || !stillHere()) return
        utterance.current = null
        if (allowFallback) { startNatural(clip); return }
        stop()
        report('Device speech could not continue. Try a different voice.')
      }
      pauseStep = () => { cancelUtterance(); resumeStep = () => speak(clip, spoken, allowFallback) }
      resumeStep = () => speak(clip, spoken, allowFallback)
      rateStep = () => { cancelUtterance(); resumeStep() }
      utterance.current = item
      setSpeaker('device')
      setState('playing')
      if (synth.paused) synth.resume()
      synth.speak(item)
      prefetch()
    }

    function startNatural(clip: SpeechClip, job?: Prediction) {
      rateStep = undefined
      const ctx = context.current!
      const prepared = scheduled.current?.job === job && scheduled.current ? scheduled.current : undefined
      if (!prepared) {
        setSpeaker(null)
        setState(paused ? 'paused' : clip === first ? 'loading' : 'buffering')
      }
      pauseStep = () => {}
      resumeStep = () => setState(clip === first ? 'loading' : 'buffering')
      function useBuffer(buffer: AudioBuffer, voice: string) {
        let prior = -1
        audio.current = { buffer, voice, offset: 0, start: 0, speed: 1, ended: () => complete(clip), schedule: prefetch, progress: seconds => {
          if (!('parts' in clip)) return
          const offset = Math.floor(clip.text.length * Math.min(.999, seconds / buffer.duration))
          const { part } = positionInClip(clip, offset)
          const at = clip.parts.indexOf(part as NarrationBatch['parts'][number])
          if (at !== prior) { prior = at; highlight(clip, offset) }
        } }
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
        updateBuffer()
        if (prepared) startBuffer(0, prepared)
        else if (!paused) resumeStep()
        prefetch()
      }
      if (job?.result) { useBuffer(job.result, job.voice); return }
      const ready = qwenSession ? (qwenReady ? Promise.resolve() : waitForQwen(qwenSession.signal, () => {
        if (stillHere()) config.current.report('Qwen is loading on this Mac…')
      }).then(() => { qwenReady = true })) : prepareModel(session, !automatic)
      let active = job
      void ready.then(() => {
        if (!stillHere()) return null
        if (!job) {
          active = queue(clip, !automatic)
          prefetch()
          return active.promise
        }
        return job.promise.then(buffer => {
          if (buffer || !stillHere() || (!qwen && job.lane !== 1)) return buffer
          active = queue(clip, !automatic)
          return active.promise
        })
      }).then(buffer => {
        if (!stillHere()) return
        if (!buffer || !active) throw new Error(renderError || 'Audio could not be rendered.')
        useBuffer(buffer, active.voice)
      }).catch(error => {
        if (!stillHere()) return
        if (automatic) {
          modelFailed = true
          config.current.report('Kokoro is unavailable. Continuing with the device voice.')
          resumeStep = () => speak(clip)
          if (!paused) resumeStep()
        } else {
          stop()
          config.current.report(qwen ? (error as Error).message : 'Kokoro audio could not load. Try Automatic or Device speech.')
        }
      })
    }

    function advance(clip: SpeechClip) {
      if (!stillHere()) return
      current = clip
      audio.current = null
      setClock({ elapsed: 0, duration: 0 })
      highlight(clip, 0)
      const match = bufferQueue.find(job => sameClip(job.clip, clip))
      bufferQueue = bufferQueue.filter(job => order(job.clip.point, clip.point) > 0)
      updateBuffer()
      if (natural && (!automatic || clip === first || match?.result)) { startNatural(clip, match); return }
      if (automatic) config.current.report(modelFailed ? 'Using device voice.' : warmReady.current ? 'Device voice while Kokoro buffers.' : 'Device voice while Kokoro loads.')
      speak(clip, 0, automatic && !modelFailed)
    }

    const first = nextClip(preview ? { index: 0, offset: 0 } : point, FIRST_BATCH_SIZE)
    if (!first) { finish(); return }
    transport.current = {
      paused: false,
      changeDeviceRate: () => { rateStep?.() },
      pause: () => { paused = true; pauseStep(); setState('paused') },
      resume: () => {
        paused = false
        if (completed) config.current.report('')
        resumeStep()
      },
    }
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

  const supported = (engine !== 'device' && Boolean(window.AudioContext)) || ((engine === 'device' || engine === 'auto') && Boolean(synth))
  return { supported, voices, voiceKey, setVoiceKey, naturalVoice, setNaturalVoice, engine, setEngine, autoplay, setAutoplay,
    rate, setRate, state, speaker, playingVoice, boundary, toggle, stop, play, minutes, setSleepTimer, clock, seek, buffered,
    preparation, prepareKokoro, qwenVoice, setQwenVoice, qwenPreparation, prepareQwen }
}
