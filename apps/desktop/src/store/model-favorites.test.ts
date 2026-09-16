import { describe, expect, it } from 'vitest'

import { $favoriteModels, favoriteKey, isFavorite, setFavoriteModels, toggleFavorite } from './model-favorites'

describe('favoriteKey', () => {
  it('joins provider and model with double-colon', () => {
    expect(favoriteKey('openrouter', 'gpt-4')).toBe('openrouter::gpt-4')
  })

  it('works with dots and slashes in model ids', () => {
    expect(favoriteKey('nous', 'hermes-4')).toBe('nous::hermes-4')
  })
})

describe('toggleFavorite', () => {
  it('adds a model to null favorites', () => {
    const next = toggleFavorite(null, 'openrouter', 'gpt-4')
    expect(next).toEqual(new Set(['openrouter::gpt-4']))
    expect(next.size).toBe(1)
  })

  it('adds a model to empty favorites', () => {
    const next = toggleFavorite(new Set(), 'openrouter', 'gpt-4')
    expect(next).toEqual(new Set(['openrouter::gpt-4']))
  })

  it('removes an existing favorite', () => {
    const stored = new Set(['openrouter::gpt-4', 'nous::hermes-4'])
    const next = toggleFavorite(stored, 'openrouter', 'gpt-4')
    expect(next).toEqual(new Set(['nous::hermes-4']))
    expect(next.has('openrouter::gpt-4')).toBe(false)
  })

  it('does not throw when toggling a non-existent model', () => {
    const stored = new Set(['openrouter::gpt-4'])
    const next = toggleFavorite(stored, 'nous', 'nonexistent')
    expect(next).toEqual(new Set(['openrouter::gpt-4', 'nous::nonexistent']))
  })

  it('is idempotent — toggling twice returns to original', () => {
    const stored = new Set(['openrouter::gpt-4'])
    const once = toggleFavorite(stored, 'openrouter', 'gpt-4')
    expect(once).toEqual(new Set())
    const twice = toggleFavorite(once, 'openrouter', 'gpt-4')
    expect(twice).toEqual(new Set(['openrouter::gpt-4']))
  })

  it('does not mutate the input set', () => {
    const stored = new Set(['openrouter::gpt-4'])
    const snapshot = new Set(stored)
    toggleFavorite(stored, 'openrouter', 'gpt-4')
    expect(stored).toEqual(snapshot)
  })
})

describe('isFavorite', () => {
  it('returns false for null favorites', () => {
    expect(isFavorite(null, 'openrouter', 'gpt-4')).toBe(false)
  })

  it('returns false for empty set', () => {
    expect(isFavorite(new Set(), 'openrouter', 'gpt-4')).toBe(false)
  })

  it('returns true for a favorited model', () => {
    const stored = new Set(['openrouter::gpt-4'])
    expect(isFavorite(stored, 'openrouter', 'gpt-4')).toBe(true)
  })

  it('returns false for a non-favorited model', () => {
    const stored = new Set(['openrouter::gpt-4'])
    expect(isFavorite(stored, 'nous', 'hermes-4')).toBe(false)
  })

  it('is case-sensitive', () => {
    const stored = new Set(['OpenRouter::GPT-4'])
    expect(isFavorite(stored, 'openrouter', 'gpt-4')).toBe(false)
  })
})

describe('setFavoriteModels', () => {
  it('replaces the atom value and persists', () => {
    const keys = new Set(['openrouter::gpt-4', 'nous::hermes-4'])
    setFavoriteModels(keys)
    expect($favoriteModels.get()).toEqual(keys)
  })

  it('accepts an empty set', () => {
    setFavoriteModels(new Set())
    expect($favoriteModels.get()).toEqual(new Set())
  })
})
