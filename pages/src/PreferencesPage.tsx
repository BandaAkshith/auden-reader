import { ArrowLeft, BookOpen, Headphones, UserRound } from 'lucide-react'
import { profile } from './accounts'
import { usePreference } from './readerPreferences'
import { naturalVoices, type NaturalVoice } from './voiceCatalog'
import { ProfileAppearance, type Constellation } from './ProfileAppearance'
import { qwenVoices, voiceEngineLabels, voiceEngines, type QwenVoice } from './qwen'

export const layouts = ['single', 'spread', 'scroll'] as const
export const papers = ['match', 'parchment', 'white', 'night', 'contrast'] as const
export const typefaces = ['literary', 'classic', 'system', 'clean'] as const
export const readingRates = [.75, .8, 1, 1.15, 1.2, 1.3, 1.5, 1.75, 2]

type PreferencesProps = {
  dark: boolean
  setDark: (dark: boolean) => void
  logout: () => void
  constellation: Constellation
  setConstellation: (value: Constellation) => void
}

export function PreferencesPage({ dark, setDark, logout, constellation, setConstellation }: PreferencesProps) {
  const [layout, setLayout] = usePreference<typeof layouts[number]>('layout', 'single', layouts)
  const [paper, setPaper] = usePreference<typeof papers[number]>('paper', 'match', papers)
  const [font, setFont] = usePreference<number>('font-size', 20, [17, 20, 25, 31])
  const [typeface, setTypeface] = usePreference<typeof typefaces[number]>('typeface', 'literary', typefaces)
  const [spacing, setSpacing] = usePreference<number>('line-spacing', 1.65, [1.45, 1.65, 1.9, 2.2])
  const [follow, setFollow] = usePreference<boolean>('follow-narration', true)
  const [engine, setEngine] = usePreference<typeof voiceEngines[number]>('playback-engine', 'auto', voiceEngines)
  const [voice, setVoice] = usePreference<NaturalVoice>('natural-voice', 'am_michael', Object.keys(naturalVoices) as NaturalVoice[])
  const [qwenVoice, setQwenVoice] = usePreference<QwenVoice>('qwen-voice', 'Ryan', qwenVoices)
  const [rate, setRate] = usePreference<number>('rate', 1, readingRates)
  const [autoplay, setAutoplay] = usePreference<boolean>('playback-autoplay', true)

  return <section className="preferences-page">
    <a className="back" href="#"><ArrowLeft size={16} /> Back to library</a>
    <h1>Preferences</h1>
    <p>Changes are saved as you make them.</p>
    <ProfileAppearance sign={constellation} choose={setConstellation} name={profile?.name || 'Guest reader'} />
    <section className="preferences-card" aria-labelledby="reading-preferences">
      <h2 id="reading-preferences"><BookOpen size={20} /> Reading</h2>
      <div className="preferences-grid">
        <label>Site theme <select value={dark ? 'dark' : 'light'} onChange={event => setDark(event.target.value === 'dark')}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Layout <select value={layout} onChange={event => setLayout(event.target.value as typeof layout)}><option value="single">Single page</option><option value="spread">Two-page spread</option><option value="scroll">Continuous scroll</option></select></label>
        <label>Paper <select value={paper} onChange={event => setPaper(event.target.value as typeof paper)}><option value="match">Match site</option><option value="parchment">Parchment</option><option value="white">White</option><option value="night">Night</option><option value="contrast">High contrast</option></select></label>
        <label>Typeface <select value={typeface} onChange={event => setTypeface(event.target.value as typeof typeface)}><option value="literary">Literary</option><option value="classic">Classic</option><option value="system">System</option><option value="clean">Clean</option></select></label>
        <label>Text size <select value={font} onChange={event => setFont(Number(event.target.value))}><option value={17}>Small</option><option value={20}>Medium</option><option value={25}>Large</option><option value={31}>Extra large</option></select></label>
        <label>Line spacing <select value={spacing} onChange={event => setSpacing(Number(event.target.value))}><option value={1.45}>Tight</option><option value={1.65}>Standard</option><option value={1.9}>Relaxed</option><option value={2.2}>Wide</option></select></label>
      </div>
    </section>
    <section className="preferences-card" aria-labelledby="audio-preferences">
      <h2 id="audio-preferences"><Headphones size={20} /> Narration</h2>
      <div className="preferences-grid">
        <label>Voice engine <select value={engine} onChange={event => setEngine(event.target.value as typeof engine)}>{voiceEngines.map(value => <option key={value} value={value}>{voiceEngineLabels[value]}</option>)}</select></label>
        {engine === 'qwen' ? <label>Qwen voice <select value={qwenVoice} onChange={event => setQwenVoice(event.target.value as QwenVoice)}>{qwenVoices.map(value => <option key={value}>{value}</option>)}</select></label>
          : engine !== 'device' && <label>Kokoro voice <select value={voice} onChange={event => setVoice(event.target.value as NaturalVoice)}>{Object.entries(naturalVoices).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>}
        <label>Speaking speed <select value={rate} onChange={event => setRate(Number(event.target.value))}>{readingRates.map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
        <label className="settings-check"><input type="checkbox" checked={autoplay} onChange={event => setAutoplay(event.target.checked)} /> Autoplay</label>
        <label className="settings-check"><input type="checkbox" checked={follow} onChange={event => setFollow(event.target.checked)} /> Follow narration</label>
      </div>
      {engine === 'qwen' && <p className="narration-help">Qwen3-TTS uses the free Auden companion on your Mac. <a href="https://github.com/BandaAkshith/auden-reader#qwen3-tts-on-apple-silicon" target="_blank" rel="noreferrer">Local setup</a></p>}
    </section>
    <section className="preferences-card" aria-labelledby="device-preferences">
      <h2 id="device-preferences"><UserRound size={20} /> Device account</h2>
      {profile ? <><p>{profile.name} · {profile.email}</p><button className="secondary compact" onClick={logout}>Sign out</button></>
        : <p><a href="#login">Log in</a> or <a href="#signup">create an account</a> for a separate library on this browser.</p>}
      <small>Libraries stay in this browser. The passphrase switches profiles in Auden. Use separate browser profiles for privacy on a shared device.</small>
    </section>
  </section>
}
