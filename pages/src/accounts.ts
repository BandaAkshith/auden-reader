export type Profile = { id: string; name: string; email: string }
type Account = Profile & { salt: string; verifier: string }
const registry = 'auden-pages:device-accounts'
const session = 'auden-pages:active-account'
const encoder = new TextEncoder()
const normalizeEmail = (email: string) => email.trim().toLowerCase()

function readAccounts(): Account[] {
  const value = JSON.parse(localStorage.getItem(registry) || '[]')
  return Array.isArray(value) ? value : []
}

function currentProfile(): Profile | undefined {
  try {
    const id = sessionStorage.getItem(session)
    const account = id && readAccounts().find(item => item.id === id)
    if (account) return { id: account.id, name: account.name, email: account.email }
  } catch { /* Browser storage can be disabled. */ }
}

export const profile = currentProfile()
export const profileKey = (key: string) => profile ? `auden-pages:profile:${profile.id}:${key}` : `auden-pages:${key}`

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!crypto.subtle) throw new Error('Open Auden over HTTPS to use a device account.')
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, key, 256)
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

export async function createAccount(name: string, email: string, password: string) {
  name = name.trim()
  email = normalizeEmail(email)
  if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Enter a name and a valid email address.')
  }
  if (password.length < 12 || password.length > 128) throw new Error('Use a passphrase between 12 and 128 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const verifier = await derive(password, salt)
  const account = { id: crypto.randomUUID(), name, email, salt: btoa(String.fromCharCode(...salt)), verifier }
  const save = () => {
    const accounts = readAccounts()
    if (accounts.some(item => item.email === email)) throw new Error('That email already has an account on this browser.')
    localStorage.setItem(registry, JSON.stringify([...accounts, account]))
    sessionStorage.setItem(session, account.id)
  }
  if (navigator.locks) await navigator.locks.request(registry, save)
  else save()
}

export async function signIn(email: string, password: string) {
  const account = readAccounts().find(item => item.email === normalizeEmail(email))
  const salt = account ? Uint8Array.from(atob(account.salt), char => char.charCodeAt(0)) : new Uint8Array(16)
  const verifier = await derive(password, salt)
  if (!account) throw new Error('The email or passphrase did not match a device account.')
  let mismatch = verifier.length ^ account.verifier.length
  for (let index = 0; index < verifier.length; index++) mismatch |= verifier.charCodeAt(index) ^ account.verifier.charCodeAt(index)
  if (mismatch) throw new Error('The email or passphrase did not match a device account.')
  sessionStorage.setItem(session, account.id)
}

export function signOut() {
  sessionStorage.removeItem(session)
}

export function openLibraryAfterAccountChange() {
  // A fresh document binds storage and all pending operations to the new profile.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  window.location.reload()
}
