import { useEffect, useState } from 'react'
import { profileKey } from './accounts'

export function usePreference<T extends string | number | boolean>(key: string, fallback: T, allowed?: readonly T[]) {
  const storageKey = profileKey(key)
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === null) return fallback
      const parsed = JSON.parse(stored)
      if (typeof parsed === typeof fallback && (!allowed || allowed.includes(parsed))) return parsed as T
    } catch { /* Private browsing may limit storage. */ }
    return fallback
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(value)) }
    catch { /* The preference still applies for this session. */ }
  }, [storageKey, value])
  return [value, setValue] as const
}
