import { useEffect, useRef, useState } from 'react'

export function useNarration(passages: string[], onPosition: (index: number) => void, report: (message: string) => void) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceKey, setVoiceKey] = useState('')
  const [rate, setRate] = useState(1)
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [minutes, setMinutes] = useState(0)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!synth) return
    const refresh = () => setVoices(synth.getVoices().filter(voice => voice.localService))
    refresh()
    synth.addEventListener('voiceschanged', refresh)
    return () => {
      synth.removeEventListener('voiceschanged', refresh)
      window.clearTimeout(timer.current)
      if (utterance.current) {
        utterance.current = null
        synth.cancel()
      }
    }
  }, [synth])

  function stop() {
    if (utterance.current) {
      utterance.current = null
      synth?.cancel()
    }
    setState('idle')
  }

  function setSleepTimer(value: number) {
    window.clearTimeout(timer.current)
    setMinutes(value)
    if (value) timer.current = window.setTimeout(() => {
      stop()
      setMinutes(0)
      report('The sleep timer stopped narration.')
    }, value * 60_000)
  }

  function play(index: number) {
    if (!synth || !passages[index]) return
    const voice = voices.find(item => item.voiceURI === voiceKey) || voices.find(item => item.default) || voices[0]
    if (!voice) {
      report('No on-device speech voice is available in this browser.')
      return
    }
    stop()
    const speak = (position: number) => {
      const text = passages[position]
      onPosition(position)
      const item = new SpeechSynthesisUtterance(text)
      item.voice = voice
      item.lang = voice.lang
      item.rate = rate
      item.onend = () => {
        if (utterance.current !== item) return
        if (position + 1 < passages.length) speak(position + 1)
        else {
          utterance.current = null
          setState('idle')
          setSleepTimer(0)
          report('You reached the end of the document.')
        }
      }
      item.onerror = event => {
        if (utterance.current !== item) return
        utterance.current = null
        setState('idle')
        report(`Narration stopped (${event.error}). Try another device voice.`)
      }
      utterance.current = item
      setState('playing')
      synth.speak(item)
    }
    if (synth.paused) synth.resume()
    speak(index)
  }

  function toggle(index: number) {
    if (state === 'playing') {
      synth?.pause()
      setState('paused')
    } else if (state === 'paused') {
      synth?.resume()
      setState('playing')
    } else play(index)
  }

  return { supported: Boolean(synth), voices, voiceKey, setVoiceKey, rate, setRate, state, toggle, stop, play, minutes, setSleepTimer }
}
