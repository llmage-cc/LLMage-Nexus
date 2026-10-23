import { describe, it, expect } from 'vitest'
import { en } from './locales/en'
import { enFallback } from './enFallback'

/**
 * `enFallback.ts` is the only copy of English strings that stays in the entry chunk: it is what
 * `t()` reads synchronously until the full `en` chunk lands. It is a literal copy of the
 * pre-login categories plus the handful of `lobby` keys the login screen and setup wizard read,
 * so this guards against the copy drifting from the canonical catalog — a stale fallback would
 * show an old string on the login screen instead of the translated one.
 */
const EAGER = ['common', 'login', 'errors', 'system', 'setup', 'splash'] as const

/** Login screen + setup wizard only: the lobby itself renders after the `en` chunk lands. */
const EAGER_LOBBY_KEYS = [
  'public_open_link',
  'invite_login_hint',
  'avatar_pick_title',
  'wizard_back',
  'wizard_next',
] as const

describe('eager English fallback', () => {
  it('is exactly the pre-login slice of the canonical catalog', () => {
    for (const category of EAGER) {
      expect(enFallback[category], category).toEqual(en[category])
    }
  })

  it('carries only the pre-login lobby keys', () => {
    expect(Object.keys(enFallback.lobby).sort()).toEqual([...EAGER_LOBBY_KEYS].sort())
    for (const key of EAGER_LOBBY_KEYS) {
      expect(enFallback.lobby[key], key).toBe(en.lobby[key])
    }
  })

  it('carries no category the deferred chunk owns', () => {
    // game/decks/dialogs/board/wiki/keywords only ship in the `en` chunk; a category that leaked
    // into here would silently undo the split (and would show up in the bundle budget).
    expect(Object.keys(enFallback).sort()).toEqual(['lobby', ...EAGER].sort())
  })

  it('covers every string the pre-login screens read', () => {
    // Splash + setup wizard + login form + connection banners.
    expect(enFallback.common.save).toBe('Save')
    expect(enFallback.login.subtitle).toBe(en.login.subtitle)
    expect(enFallback.errors.login_failed).toBe(en.errors.login_failed)
    expect(enFallback.system.about_title).toBe(en.system.about_title)
    expect(enFallback.setup.title).toBe(en.setup.title)
    expect(enFallback.splash.checking).toBe(en.splash.checking)
    expect(enFallback.lobby.public_open_link).toBe('Public ranking')
  })
})
