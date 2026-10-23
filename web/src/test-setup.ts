import { afterAll, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ensureLocaleLoaded, setLanguage } from './i18n'
import { resetScryfallClient, setScryfallPacing } from './cards/scryfallClient'
import { setBundledCorpusForTests } from './decks/bundledDecks'
import { flushReactSchedulerWork } from './test-teardown'

// La suite histórica aserta textos de UI en español. El default de la app es
// inglés (getInitialLanguage), así que los tests parten de español salvo que
// el propio spec cambie de idioma con setLanguage().
//
// Cada locale es su propio chunk desde que se cargan bajo demanda, así que fijar
// el idioma no basta: hay que esperar a que su schema esté en memoria antes de
// renderizar, o el `t()` cae al inglés y el spec falla por el texto equivocado.
beforeEach(async () => {
  // The bundled deck corpus is a module-level lazy singleton: a test that stubs
  // `fetch` with a never-resolving promise would otherwise poison the cached
  // load for the rest of the file. Reset it so each test starts unloaded.
  setBundledCorpusForTests(null)
  setLanguage('es')
  // The app preloads both the full English catalog (the fallback every `t()` reaches for) and the
  // active language at boot, before any screen renders; mirror that here so a spec that switches
  // to English reads real strings, not the eager pre-login fallback slice.
  await ensureLocaleLoaded('en')
  await ensureLocaleLoaded('es')
  resetScryfallClient()
  setScryfallPacing({ spacingMs: 0 })
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  cleanup()
  await flushReactSchedulerWork()
})
