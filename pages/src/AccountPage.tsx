import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react'
import { createAccount, openLibraryAfterAccountChange, signIn } from './accounts'

export function AccountPage({ signup }: { signup: boolean }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (signup) await createAccount(name, email, password)
      else await signIn(email, password)
      openLibraryAfterAccountChange()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The account could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="account-page" aria-labelledby="account-title">
    <div className="account-intro">
      <span className="kicker"><LockKeyhole size={16} /> This browser</span>
      <h1 id="account-title">{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p>Each account has its own library, notes, reading history, and preferences on this browser.</p>
    </div>
    <form className="account-form" onSubmit={submit}>
      {signup && <label>Name <input autoComplete="name" value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label>}
      <label>Email <input type="email" autoComplete="username" value={email} maxLength={254} required onChange={event => setEmail(event.target.value)} /></label>
      <label>Passphrase <input type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password}
        minLength={signup ? 12 : undefined} maxLength={128} required onChange={event => setPassword(event.target.value)} /></label>
      {signup && <small>Use at least 12 characters. Choose a passphrase you can remember.</small>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Opening your account…' : signup ? 'Create account' : 'Log in'} <ArrowRight size={17} /></button>
      <p>{signup ? 'Already have a device account?' : 'New to Auden?'} <a href={signup ? '#login' : '#signup'}>{signup ? 'Log in' : 'Create an account'}</a></p>
      <a className="back" href="#"><ArrowLeft size={16} /> Continue as guest</a>
    </form>
  </section>
}
