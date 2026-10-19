import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Gateway } from './Gateway'
import * as commands from './commands'

describe('commands', () => {
  const send = vi.fn().mockResolvedValue({ ok: true, data: [] })

  beforeEach(() => {
    send.mockClear()
    commands.setGateway({ send } as unknown as Gateway)
  })

  it('maps lobby and table commands to the protocol', async () => {
    await commands.connect('localhost', 17171, 'alice', 'secret')
    await commands.getGameTypes()
    await commands.getPlayerTypes()
    await commands.getDeckTypes()
    await commands.getRoomChatId()
    await commands.sendChatMessage('chat-1', 'hello')
    await commands.createTable({ name: 'table', gameType: 'duel', deckType: 'modern', winsNeeded: 1, playerTypes: ['HUMAN'] })
    await commands.joinTable({ tableId: 'table-1', playerName: 'alice', playerType: 'HUMAN', deck: { name: 'deck', cards: [], sideboard: [] } })
    await commands.startMatch('table-1')
    await commands.watchTable('table-1')
    await commands.watchGame('game-1')
    await commands.joinGame('game-1')
    await commands.stopWatching('game-1')
    await commands.leaveTable('table-1')
    await commands.removeTable('table-1')

    expect(send).toHaveBeenCalledWith('connect', expect.objectContaining({ host: 'localhost', port: 17171, username: 'alice', password: 'secret' }))
    expect(send).toHaveBeenCalledWith('sendChatMessage', { chatId: 'chat-1', text: 'hello' })
    expect(send).toHaveBeenCalledWith('watchGame', { gameId: 'game-1' })
    expect(send).toHaveBeenCalledWith('joinGame', { gameId: 'game-1' })
    expect(send).toHaveBeenCalledWith('joinTable', expect.objectContaining({ tableId: 'table-1', playerType: 'HUMAN' }))
  })

  it('createTable reenvía los mazos de los asientos SIM', async () => {
    const simDeck = { name: 'Sim deck', cards: [{ cardName: 'Mountain', setCode: 'LEA', cardNumber: '292', amount: 60 }], sideboard: [] }
    await commands.createTable({
      name: 'table',
      gameType: 'duel',
      deckType: 'modern',
      winsNeeded: 1,
      playerTypes: ['HUMAN', 'SIM'],
      simDecks: [simDeck],
    })
    expect(send).toHaveBeenCalledWith('createTable', expect.objectContaining({ playerTypes: ['HUMAN', 'SIM'], simDecks: [simDeck] }))
  })

  it('createTable forwards llmConfigs as-is, including a null per seat', async () => {
    await commands.createTable({
      name: 'llm table',
      gameType: 'duel',
      deckType: 'modern',
      winsNeeded: 1,
      playerTypes: ['HUMAN', 'COMPUTER_LLM', 'COMPUTER_LLM'],
      llmConfigs: [{ useClientKey: true, clientKeyTag: 'tag-1' }, null],
    })
    expect(send).toHaveBeenCalledWith(
      'createTable',
      expect.objectContaining({
        playerTypes: ['HUMAN', 'COMPUTER_LLM', 'COMPUTER_LLM'],
        llmConfigs: [{ useClientKey: true, clientKeyTag: 'tag-1' }, null],
      }),
    )
  })

  it('maps every player input with the gameId', async () => {
    await commands.sendPlayerAction('PASS_PRIORITY_UNTIL_STACK_RESOLVED', 'game-1')
    await commands.sendPlayerBoolean(true, 'game-1')
    await commands.sendPlayerInteger(2, 'game-1')
    await commands.sendPlayerString('choice', 'game-1')
    await commands.sendPlayerUUID('card-1', 'game-1')
    await commands.sendPlayerManaType('game-1', 'player-1', 'RED')
    await commands.quitMatch('game-1')
    await commands.disconnect()

    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED', gameId: 'game-1', data: undefined })
    expect(send).toHaveBeenCalledWith('sendPlayerBoolean', { value: true, gameId: 'game-1' })
    expect(send).toHaveBeenCalledWith('sendPlayerManaType', { gameId: 'game-1', playerId: 'player-1', manaType: 'RED' })
    expect(send).toHaveBeenCalledWith('quitMatch', { gameId: 'game-1' })
    expect(send).toHaveBeenCalledWith('disconnect')
  })

  it('maps hand-permission and viewer actions (G12-1/G12-2)', async () => {
    await commands.requestHandPermission('game-1', 'player-2')
    await commands.setHandRequestsAllowed('game-1', true)
    await commands.setHandRequestsAllowed('game-1', false)
    await commands.revokeHandPermissions('game-1')
    await commands.viewSideboard('game-1', 'player-1')
    await commands.viewLimitedDeck('game-1', 'player-1')

    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'REQUEST_PERMISSION_TO_SEE_HAND_CARDS', gameId: 'game-1', data: 'player-2' })
    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'PERMISSION_REQUESTS_ALLOWED_ON', gameId: 'game-1', data: null })
    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'PERMISSION_REQUESTS_ALLOWED_OFF', gameId: 'game-1', data: null })
    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS', gameId: 'game-1', data: null })
    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'VIEW_SIDEBOARD', gameId: 'game-1', data: 'player-1' })
    expect(send).toHaveBeenCalledWith('sendPlayerAction', { action: 'VIEW_LIMITED_DECK', gameId: 'game-1', data: 'player-1' })
  })

  describe('advisory proxy queries (XMage card DB)', () => {
    const deck = { name: 'deck', cards: [{ cardName: 'Lightning Bolt', setCode: 'M10', cardNumber: '146', amount: 4 }], sideboard: [] }

    it('send the payload the proxy expects and return data', async () => {
      const report = { ready: true }
      send.mockResolvedValue({ ok: true, data: report })

      expect(await commands.validateDeck(deck)).toBe(report)
      expect(await commands.commanderEligibility(['Grist, the Hunger Tide'])).toBe(report)
      expect(await commands.validateDeckFormat(deck, 'Variant Magic - Commander')).toBe(report)
      expect(await commands.resolvePrintings(['Lightning Bolt'])).toBe(report)
      expect(await commands.cardPrintings(['Lightning Bolt'])).toBe(report)

      expect(send).toHaveBeenCalledWith('validateDeck', { deck })
      expect(send).toHaveBeenCalledWith('commanderEligibility', { names: ['Grist, the Hunger Tide'] })
      expect(send).toHaveBeenCalledWith('validateDeckFormat', { deck, deckType: 'Variant Magic - Commander', gameType: undefined })
      expect(send).toHaveBeenCalledWith('resolvePrintings', { names: ['Lightning Bolt'], strategy: 'default', setCode: undefined })
      expect(send).toHaveBeenCalledWith('cardPrintings', { names: ['Lightning Bolt'], limit: 0 })
    })

    it('return null when the proxy rejects the command or there is no data', async () => {
      send.mockResolvedValue({ ok: false, error: 'unknown action' })
      expect(await commands.validateDeck(deck)).toBeNull()
      expect(await commands.commanderEligibility(['X'])).toBeNull()
      expect(await commands.validateDeckFormat(deck)).toBeNull()
      expect(await commands.resolvePrintings(['X'], 'oldest')).toBeNull()
      expect(await commands.cardPrintings(['X'], 1)).toBeNull()
      expect(await commands.fetchOnlineDeckJson('moxfield', 'abc')).toBeNull()

      send.mockResolvedValue({ ok: true })
      expect(await commands.validateDeck(deck)).toBeNull()
      expect(await commands.cardPrintings(['X'])).toBeNull()
    })
  })

  it('server lists fall back to [] when the command fails', async () => {
    send.mockResolvedValue({ ok: false })
    expect(await commands.getGameTypes()).toEqual([])
    expect(await commands.getPlayerTypes()).toEqual([])
    expect(await commands.getDeckTypes()).toEqual([])
    expect(await commands.getTournamentTypes()).toEqual([])
    expect(await commands.getDraftCubes()).toEqual([])
    expect(await commands.getExpansionsWithBoosters()).toEqual([])
    expect(await commands.getFinishedMatches()).toEqual([])
    expect(await commands.getRoomChatId()).toBeUndefined()
    expect(await commands.getTournament('t-1')).toBeNull()
  })

  it('getFinishedMatches never hands the history panel anything but an array', async () => {
    send.mockResolvedValue({ ok: true, data: { not: 'a list' } })
    expect(await commands.getFinishedMatches()).toEqual([])
    send.mockResolvedValue({ ok: true, data: true })
    expect(await commands.getFinishedMatches()).toEqual([])
    send.mockResolvedValue({ ok: true, data: [{ matchId: 'm1' }] })
    expect(await commands.getFinishedMatches()).toEqual([{ matchId: 'm1' }])
  })

  it('getTournamentTypes accepts plain names or objects and drops empty ones', async () => {
    send.mockResolvedValue({ ok: true, data: ['Booster Draft Elimination', { name: 'Sealed Elimination' }, { name: '' }, {}, null] })
    expect(await commands.getTournamentTypes()).toEqual(['Booster Draft Elimination', 'Sealed Elimination'])
  })

  it('without a gateway it fails with an explicit error', async () => {
    commands.setGateway(null)
    expect(() => commands.getGateway()).toThrow('gateway no inicializado')
    await expect(commands.validateDeck({ name: 'd', cards: [], sideboard: [] })).rejects.toThrow('gateway no inicializado')
  })

  it('maps the replay transport helpers to the protocol', async () => {
    await commands.replayGame('g-1')
    await commands.startReplay('g-1')
    await commands.stopReplay('g-1')
    await commands.replayNext('g-1')
    await commands.replayPrevious('g-1')
    await commands.replaySkipForward('g-1', 10)
    await commands.replaySeek('g-1', 42)

    expect(send).toHaveBeenCalledWith('replayGame', { gameId: 'g-1' })
    expect(send).toHaveBeenCalledWith('startReplay', { gameId: 'g-1' })
    expect(send).toHaveBeenCalledWith('stopReplay', { gameId: 'g-1' })
    expect(send).toHaveBeenCalledWith('replayNext', { gameId: 'g-1' })
    expect(send).toHaveBeenCalledWith('replayPrevious', { gameId: 'g-1' })
    expect(send).toHaveBeenCalledWith('replaySkipForward', { gameId: 'g-1', moves: 10 })
    expect(send).toHaveBeenCalledWith('replaySeek', { gameId: 'g-1', stateIndex: 42 })
  })

  // ─── getReplayFiles validates every row (getP1Decks pattern) ──────────────

  it('getReplayFiles keeps well-formed rows and their raw meta (legacy rows keep no meta key)', async () => {
    const meta = { gameId: 'g-1', tableName: 'Mesa', players: [{ name: 'Alice', wins: 2 }] }
    send.mockResolvedValue({
      ok: true,
      data: {
        directory: '/srv/saves',
        exists: true,
        files: [
          { gameId: 'g-1', bytes: 1024, savedAtMs: 1_760_000_000_000, meta },
          { gameId: 'legacy-1', bytes: 2048, savedAtMs: 1_760_000_000_001 },
        ],
      },
    })
    expect(await commands.getReplayFiles()).toEqual({
      directory: '/srv/saves',
      exists: true,
      files: [
        { gameId: 'g-1', bytes: 1024, savedAtMs: 1_760_000_000_000, meta },
        { gameId: 'legacy-1', bytes: 2048, savedAtMs: 1_760_000_000_001 },
      ],
    })
  })

  it('getReplayFiles drops malformed rows instead of casting them wholesale', async () => {
    send.mockResolvedValue({
      ok: true,
      data: {
        directory: '/srv/saves',
        exists: true,
        files: [
          null,                                     // not an object
          'a string',                              // not an object
          { gameId: '', bytes: 1, savedAtMs: 2 },    // EMPTY gameId
          { bytes: 1, savedAtMs: 2 },               // missing gameId
          { gameId: 'g-2', savedAtMs: 2 },          // missing bytes
          { gameId: 'g-3', bytes: 1 },             // missing savedAtMs
          { gameId: 'g-4', bytes: '1024', savedAtMs: 2 },       // bytes not a number
          { gameId: 'g-5', bytes: 1, savedAtMs: 'soon' },       // savedAtMs not a number
          { gameId: 7, bytes: 1, savedAtMs: 2 },    // gameId not a string
          { gameId: 'g-ok', bytes: 512, savedAtMs: 3, meta: { anything: { goes: true } } }, // valid, unknown meta tolerated
        ],
      },
    })
    expect(await commands.getReplayFiles()).toEqual({
      directory: '/srv/saves',
      exists: true,
      files: [{ gameId: 'g-ok', bytes: 512, savedAtMs: 3, meta: { anything: { goes: true } } }],
    })
  })

  it('getReplayFiles degrades to an empty listing on a failed/non-array payload', async () => {
    send.mockResolvedValue({ ok: false, error: 'nope' })
    expect(await commands.getReplayFiles()).toEqual({ directory: '', exists: false, files: [] })
    send.mockResolvedValue({ ok: true, data: { files: 'not-an-array' } })
    expect(await commands.getReplayFiles()).toEqual({ directory: '', exists: false, files: [] })
    send.mockResolvedValue({ ok: true })
    expect(await commands.getReplayFiles()).toEqual({ directory: '', exists: false, files: [] })
  })

  describe('LLM list verbs', () => {
    it('fetchLlmModels sends the endpoint and reads data.models', async () => {
      send.mockResolvedValue({ ok: true, data: { models: ['gpt-5', 'llama3'], endpoint: 'http://localhost:11434/v1/chat/completions' } })
      expect(await commands.fetchLlmModels('http://localhost:11434/v1/chat/completions')).toEqual({
        ok: true,
        items: ['gpt-5', 'llama3'],
        error: '',
      })
      expect(send).toHaveBeenCalledWith('fetchModels', { apiEndpoint: 'http://localhost:11434/v1/chat/completions' })
    })

    it('fetchLlmPersonalities sends {} and reads data.personalities', async () => {
      send.mockResolvedValue({ ok: true, data: { personalities: ['alex', 'blake'] } })
      expect(await commands.fetchLlmPersonalities()).toEqual({ ok: true, items: ['alex', 'blake'], error: '' })
      expect(send).toHaveBeenCalledWith('fetchPersonalities', {})
    })

    it('a rejected list verb resolves to ok:false with the reason (never throws)', async () => {
      send.mockResolvedValue({ ok: false, error: 'host blocked', errorCode: 'INVALID_ARGUMENT' })
      expect(await commands.fetchLlmModels('https://api.example.com/v1/chat/completions')).toEqual({
        ok: false,
        items: [],
        error: 'host blocked',
        errorCode: 'INVALID_ARGUMENT',
      })
    })

    it('a success with a non-array payload yields an empty item list', async () => {
      send.mockResolvedValue({ ok: true, data: { models: 'not-an-array' } })
      expect(await commands.fetchLlmModels('http://localhost:11434/v1/chat/completions')).toEqual({ ok: true, items: [], error: '' })
    })
  })

  describe('client-key bridge transport', () => {
    it('llmDecision sends action llm_decision with the args nested', async () => {
      await commands.llmDecision({ requestId: 'r-1', rawResponse: '{"choices":[]}', httpStatus: 200 })
      expect(send).toHaveBeenCalledWith('llm_decision', {
        requestId: 'r-1',
        rawResponse: '{"choices":[]}',
        httpStatus: 200,
      })
    })

    it('llmDecision forwards an optional thinking field', async () => {
      await commands.llmDecision({ requestId: 'r-1', rawResponse: '{}', thinking: 'because', httpStatus: 200 })
      expect(send).toHaveBeenCalledWith('llm_decision', expect.objectContaining({ thinking: 'because' }))
    })

    it('llmError sends action llm_error with retryable and optional httpStatus', async () => {
      await commands.llmError({ requestId: 'r-2', message: 'HTTP 500 from provider (via relay): boom', retryable: true, httpStatus: 500 })
      expect(send).toHaveBeenCalledWith('llm_error', {
        requestId: 'r-2',
        message: 'HTTP 500 from provider (via relay): boom',
        retryable: true,
        httpStatus: 500,
      })
    })

    it('llmError omits httpStatus for a transport failure', async () => {
      await commands.llmError({ requestId: 'r-3', message: 'Browser LLM call failed: nope', retryable: true })
      expect(send).toHaveBeenCalledWith('llm_error', {
        requestId: 'r-3',
        message: 'Browser LLM call failed: nope',
        retryable: true,
      })
    })
  })

  // ─── Deployment gating: every connect carries the browserId and,
  // only when provided, the auth token. `send` is last-called with whatever the
  // harness called last, so these read the connect call explicitly.
  describe('connect payload', () => {
    const connectCall = () => send.mock.calls.filter((c) => c[0] === 'connect').at(-1)?.[1]

    beforeEach(() => window.sessionStorage.clear())

    it('sends a sessionStorage browserId on every connect', async () => {
      await commands.connect('localhost', 17171, 'alice', 'pw')
      const args = connectCall() as { browserId?: string }
      expect(args.browserId).toMatch(/^web:alice:/)
      const first = args.browserId
      await commands.connect('localhost', 17171, 'alice', 'pw')
      expect((connectCall() as { browserId?: string }).browserId).toBe(first)
    })

    it('includes the authToken only when it is non-empty', async () => {
      await commands.connect('localhost', 17171, 'alice', 'pw', undefined, undefined, null, 'tok')
      expect(connectCall()).toMatchObject({ authToken: 'tok' })
      await commands.connect('localhost', 17171, 'alice', 'pw', undefined, undefined, null, '')
      expect(connectCall()).not.toHaveProperty('authToken')
    })
  })
})
