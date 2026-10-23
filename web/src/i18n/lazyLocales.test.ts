import { describe, it, expect, beforeEach } from 'vitest'
import { ensureLocaleLoaded, getLanguage, preloadInitialLocale, setLanguage, t, switchLanguage } from './index'

/**
 * The nine locales load as their own chunks — English included, with only the pre-login slice of
 * it eager as the fallback (`enFallback.ts`). A test has no grace period to wait for a chunk, so
 * the switch-and-read tests use `switchLanguage`; these check the loading contract itself,
 * including the fallback that keeps the UI readable in the meantime.
 */
describe('lazy locales', () => {
  beforeEach(async () => {
    await switchLanguage('es')
  })

  it('reads translated strings right after awaiting the switch', async () => {
    for (const lang of ['de', 'fr', 'it', 'pt', 'ru', 'ja', 'zhs', 'en'] as const) {
      await switchLanguage(lang)
      expect(getLanguage()).toBe(lang)
      expect(t('common.save'), lang).not.toBe('')
      expect(t('common.save'), lang).not.toBe('common.save')
    }
  })

  it('never fetches a language twice, however many callers ask at once', async () => {
    // the store is shared, so switching language in three places at once must not start three
    // imports of the same locale chunk
    await Promise.all([switchLanguage('ja'), switchLanguage('ja'), switchLanguage('ja')])
    await ensureLocaleLoaded('ja')
    expect(getLanguage()).toBe('ja')
    expect(t('common.save')).toBe('保存')
  })

  it('keeps English readable while a language is still in flight', async () => {
    // setLanguage paints the new language immediately and fills it when the chunk lands, so a slow
    // or failing chunk must leave readable text behind rather than blank labels or raw key paths
    setLanguage('ru')
    expect(getLanguage()).toBe('ru')
    const before = t('common.save')
    expect(before).not.toBe('')
    expect(before).not.toBe('common.save')
    await ensureLocaleLoaded('ru')
    expect(t('common.save')).toBe('Сохранить')
  })

  it('falls back to the key when neither the language nor English has it', async () => {
    await switchLanguage('ja')
    expect(t('nope.not.a.key')).toBe('nope.not.a.key')
  })

  it('serves the full English catalog once its chunk lands, not the eager slice', async () => {
    // Only the pre-login categories are eager in `enFallback.ts`; the store must swap the whole
    // catalog in for `en` as soon as the chunk arrives, or English players would read key paths
    // for everything past the login screen.
    await switchLanguage('en')
    expect(t('game.concede')).toBe('Concede')
    expect(t('decks.my_decks')).not.toBe('decks.my_decks')
    expect(t('keywords', 'flying_summary')).not.toBe('keywords.flying_summary')
  })

  it('preloads English at boot, so a player whose language is Spanish still gets the fallback', async () => {
    preloadInitialLocale()
    await Promise.all([ensureLocaleLoaded('en'), ensureLocaleLoaded('es')])
    expect(t('game.concede')).toBe('Conceder')
  })
})
