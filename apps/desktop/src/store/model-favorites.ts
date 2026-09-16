import { atom } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

const STORAGE_KEY = 'hermes.desktop.favorite-models'

/** Stable key for a provider/model pair (`::` avoids colliding with model ids
 *  that contain a single colon, e.g. `model:tag`). */
export const favoriteKey = (provider: string, model: string): string => `${provider}::${model}`

function loadFavorites(): Set<string> | null {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)

    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : null
  } catch {
    return null
  }
}

/** Explicit set of favorited `provider::model` keys, or null when the user
 *  hasn't customized. */
export const $favoriteModels = atom<Set<string> | null>(loadFavorites())

export function setFavoriteModels(keys: Set<string>): void {
  $favoriteModels.set(new Set(keys))
  persistString(STORAGE_KEY, JSON.stringify([...keys]))
}

/** Toggle a single model's favorite state. Returns the new set. Seeds from
 *  the stored favorites (null = empty set). */
export function toggleFavorite(stored: Set<string> | null, providerSlug: string, model: string): Set<string> {
  const next = new Set(stored ?? [])
  const key = favoriteKey(providerSlug, model)

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  return next
}

/** Check if a model is favorited. Handles null (no favorites yet). */
export function isFavorite(stored: Set<string> | null, providerSlug: string, model: string): boolean {
  if (!stored) {
    return false
  }

  return stored.has(favoriteKey(providerSlug, model))
}
