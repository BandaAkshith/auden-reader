import { useEffect, useRef, useState } from 'react'
import { usePreference } from './readerPreferences'

export function useNarration(passages: string[], onPosition: (index: number) => void, report: (message: string) => void) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceKey, setVoiceKey] = usePreference<string>('voice', '')
  const [rate, setRate] = usePreference<number>('rate', 1, [0.8, 1, 1.2, 1.5])
  const [boundary, setBoundary] = useState<{ start: number; end: number } | null>(null)
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [minutes, setMinutes] = useState(0)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const preferences = useRef({ voiceKey, rate, voices })
  const callbacks = useRef({ onPosition, report })
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => { preferences.current = { voiceKey, rate, voices }; callbacks.current = { onPosition, report } }, [voiceKey, rate, voices, onPosition, report])

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
    setBoundary(null)
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
    const currentVoice = () => {
      const config = preferences.current
      return config.voices.find(item => item.voiceURI === config.voiceKey) || config.voices.find(item => item.default) || config.voices[0]
    }
    const voice = currentVoice()
    if (!voice) {
      report('No on-device speech voice is available in this browser.')
      return
    }
    stop()
    const speak = (position: number) => {
      const text = passages[position]
      callbacks.current.onPosition(position)
      setBoundary(null)
      const item = new SpeechSynthesisUtterance(text)
      item.voice = currentVoice() || voice
      item.lang = item.voice.lang
      item.rate = preferences.current.rate
      item.onboundary = event => {
        const start = event.charIndex
        if (utterance.current !== item || event.name !== 'word' || start < 0 || start >= text.length) return
        const length = event.charLength || text.slice(start).match(/^\S+/)?.[0].length || 1
        setBoundary({ start, end: Math.min(text.length, start + length) })
      }
      item.onend = () => {
        if (utterance.current !== item) return
        if (position + 1 < passages.length) speak(position + 1)
        else {
          utterance.current = null
          setState('idle')
          setBoundary(null)
          setSleepTimer(0)
          report('You reached the end of the document.')
        }
      }
      item.onerror = event => {
        if (utterance.current !== item) return
        utterance.current = null
        setState('idle')
        setBoundary(null)
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

  return { supported: Boolean(synth), voices, voiceKey, setVoiceKey, rate, setRate, state, boundary, toggle, stop, play, minutes, setSleepTimer }
}
