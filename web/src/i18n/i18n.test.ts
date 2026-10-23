import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { t, translateError, setLanguage, switchLanguage, getLanguage, LANGUAGES, CARD_LANGUAGES, setCardLanguage, getCardLanguage, toBcp47Locale } from './index'
import { ja } from './locales/ja'

describe('i18n system', () => {
  beforeEach(() => {
    setLanguage('es')
    setCardLanguage('en')
  })

  afterAll(() => {
    setLanguage('es')
    setCardLanguage('en')
  })

  it('translates basic keys in Spanish', async () => {
    expect(t('common.save')).toBe('Guardar')
    expect(t('lobby.nav_tables')).toBe('Mesas')
    expect(t('game.concede')).toBe('Conceder')
  })

  it('switches to all 9 supported languages dynamically', async () => {
    await switchLanguage('en')
    expect(getLanguage()).toBe('en')
    expect(t('common.save')).toBe('Save')

    await switchLanguage('de')
    expect(getLanguage()).toBe('de')
    expect(t('common.save')).toBe('Speichern')

    await switchLanguage('fr')
    expect(getLanguage()).toBe('fr')
    expect(t('common.save')).toBe('Enregistrer')

    await switchLanguage('it')
    expect(getLanguage()).toBe('it')
    expect(t('common.save')).toBe('Salva')

    await switchLanguage('pt')
    expect(getLanguage()).toBe('pt')
    expect(t('common.save')).toBe('Salvar')

    await switchLanguage('ru')
    expect(getLanguage()).toBe('ru')
    expect(t('common.save')).toBe('Сохранить')

    await switchLanguage('ja')
    expect(getLanguage()).toBe('ja')
    expect(t('common.save')).toBe('保存')

    await switchLanguage('zhs')
    expect(getLanguage()).toBe('zhs')
    expect(t('common.save')).toBe('保存')
  })

  it('translates error messages and raw server phrases across languages', async () => {
    setLanguage('es')
    expect(translateError('login failed')).toBe('Error de inicio de sesión: credenciales incorrectas o servidor no disponible')
    expect(translateError('table full')).toBe('La mesa ya está completa')
    expect(translateError('Join Table Wrong password.')).toBe('La contraseña de la mesa es incorrecta')
    expect(translateError('Join Table You can join a table only one time.', 'joinTable')).toBe(
      'No se pudo unir a la mesa seleccionada: You can join a table only one time.',
    )

    await switchLanguage('en')
    expect(translateError('login failed')).toBe('Login failed: invalid credentials or server unavailable')
    expect(translateError('table full')).toBe('This table is already full')

    await switchLanguage('de')
    expect(translateError('login failed')).toBe('Anmeldung fehlgeschlagen: Ungültige Anmeldedaten oder Server nicht erreichbar')

    await switchLanguage('ja')
    expect(translateError('login failed')).toBe('ログイン失敗: 認証情報が無効か、サーバーが利用できません')
  })

  it('falls back to English (not Spanish) for keys missing in the active language', async () => {
    const backup = ja.game.concede
    try {
      await switchLanguage('ja')
      delete (ja.game as unknown as Record<string, unknown>).concede
      expect(t('game.concede')).toBe('Concede')
      expect(t('game', 'concede')).toBe('Concede')
    } finally {
      ;(ja.game as unknown as Record<string, unknown>).concede = backup
      setLanguage('es')
    }
  })

  it('maps game language to BCP-47 for Intl formatters', async () => {
    expect(toBcp47Locale('zhs')).toBe('zh')
    expect(toBcp47Locale('ja')).toBe('ja')
    expect(toBcp47Locale('es')).toBe('es')
    expect(toBcp47Locale('en')).toBe('en')
  })

  it('supports interpolation parameters', async () => {
    setLanguage('es')
    expect(t('common.search')).toBe('Buscar...')
  })

  it('manages card language settings', async () => {
    expect(getCardLanguage()).toBe('en')
    setCardLanguage('ja')
    expect(getCardLanguage()).toBe('ja')
    expect(CARD_LANGUAGES.some((c) => c.code === 'ja')).toBe(true)
  })

  it('has identical length and codes between UI languages and card languages', async () => {
    expect(LANGUAGES).toHaveLength(9)
    expect(CARD_LANGUAGES).toHaveLength(9)
    const uiCodes = LANGUAGES.map((l) => l.code).sort()
    const cardCodes = CARD_LANGUAGES.map((c) => c.code).sort()
    expect(uiCodes).toEqual(cardCodes)
  })

  it('exposes the B.10/C.13 keys in all 9 languages with working interpolation', async () => {
    const keys = [
      'game.spectator_game_changed',
      'game.follow_game',
      'lobby.join_pick_deck',
      'lobby.invite_cancelled_stay',
      'lobby.invite_searching',
      'decks.export_backup_count',
      'decks.import_backup_json',
    ]
    for (const lang of LANGUAGES) {
      await switchLanguage(lang.code)
      for (const key of keys) {
        const value = t(key)
        expect(value, `${lang.code}:${key}`).not.toBe('')
        expect(value, `${lang.code}:${key}`).not.toBe(key)
      }
    }
    setLanguage('es')
    expect(t('decks.export_backup_count', { count: 3 })).toContain('3')
    expect(t('lobby.invite_searching', { current: 1, total: 10 })).toContain('1')
    expect(t('lobby.invite_searching', { current: 1, total: 10 })).toContain('10')
  })

  it('traduce las pestañas Log/Chat en ru/ja/zhs (préstamo aceptado en los latinos)', async () => {
    await switchLanguage('ru')
    expect(t('game.tab_log')).toBe('Лог')
    expect(t('game.tab_chat')).toBe('Чат')
    await switchLanguage('ja')
    expect(t('game.tab_log')).toBe('ログ')
    expect(t('game.tab_chat')).toBe('チャット')
    await switchLanguage('zhs')
    expect(t('game.tab_log')).toBe('日志')
    expect(t('game.tab_chat')).toBe('聊天')
  })

  it('expone las claves de fin de partida sin turno y la de enfermedad de invocación', async () => {
    setLanguage('es')
    expect(t('game.end_won_game', { player: 'Ana' })).toBe('Ana gana la partida')
    expect(t('game.end_lost_game', { player: 'Ana' })).toBe('Ana pierde la partida')
    expect(t('game.end_won_game_you')).toBe('Has ganado la partida')
    expect(t('game.end_lost_game_you')).toBe('Has perdido la partida')
    expect(t('game.summoning_sickness')).toContain('{T}')
    await switchLanguage('en')
    expect(t('game.summoning_sickness')).toContain('{T}')
  })

  it('falls back to English for the new keys when missing in the active language', async () => {
    const backup = ja.game.follow_game
    try {
      await switchLanguage('ja')
      delete (ja.game as unknown as Record<string, unknown>).follow_game
      expect(t('game.follow_game')).toBe('Follow game')
      expect(t('game', 'follow_game')).toBe('Follow game')
    } finally {
      ;(ja.game as unknown as Record<string, unknown>).follow_game = backup
      setLanguage('es')
    }
  })
})

describe('translateError — el fallback de un FAILED desnudo depende de la superficie', () => {
  beforeEach(async () => {
    await switchLanguage('es')
  })

  it('un FAILED sin acción en el login se lee como login fallido, no como fallo al crear mesa', async () => {
    // El proxy puede contestar un rechazo de versión como {"error":"FAILED","errorCode":"FAILED"}:
    // sin acción, la rama FAILED caía en errors.create_table_failed ("No se pudo crear la mesa").
    const loginCopy = t('errors.login_failed')
    expect(translateError('FAILED', 'login')).toBe('Error de inicio de sesión: credenciales incorrectas o servidor no disponible')
    expect(translateError('FAILED', 'login')).toBe(loginCopy)
    expect(translateError('FAILED', 'login')).not.toBe(t('errors.create_table_failed'))
    // el mismo rechazo puede llegar con errorCode FAILED en vez de sin código
    expect(translateError('FAILED', 'login', 'FAILED')).toBe(loginCopy)
  })

  it('no cambia los mapeos existentes por acción ni el fallback sin acción', async () => {
    expect(translateError('FAILED', 'joinTable')).toBe(t('errors.join_table_failed'))
    expect(translateError('FAILED', 'watchTable')).toBe(t('errors.table_not_found'))
    expect(translateError('FAILED', 'startMatch')).toBe(t('errors.start_game_failed'))
    // sin superficie (create table y cualquier llamador sin acción) sigue siendo el fallback de mesa
    expect(translateError('FAILED')).toBe(t('errors.create_table_failed'))
  })

  it('un texto ya traducido (p. ej. el de version mismatch) pasa intacto por la superficie login', async () => {
    const mismatch = t('errors', 'server_version_mismatch', { server: '1.4.63-V1', proxy: '1.4.62-V1' })
    expect(mismatch).toContain('1.4.63-V1')
    expect(translateError(mismatch, 'login')).toBe(mismatch)
    expect(translateError(mismatch, 'login')).toBe(translateError(mismatch))
  })

  it('keeps the server text of a SERVER_MESSAGE refusal verbatim', async () => {
    const detail = 'User name may not be longer than 14 characters'
    expect(translateError(detail, 'login', 'SERVER_MESSAGE')).toBe(detail)
    // the code itself is protocol jargon: it must never surface as the message
    expect(translateError('SERVER_MESSAGE', 'login', 'SERVER_MESSAGE')).toBe(t('errors.login_failed'))
    expect(translateError('', 'login', 'SERVER_MESSAGE')).toBe(t('errors.login_failed'))
    expect(translateError('SERVER_MESSAGE')).toBe(t('errors.create_table_failed'))
  })
})
