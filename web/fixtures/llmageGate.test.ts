import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { FakeServer } from './fake'
import {
  DEFAULT_LLM_MODELS,
  DEFAULT_LLM_PERSONALITIES,
  DEFAULT_P1_DECKS,
  DEFAULT_P1_DEFAULT,
  llmageScenario,
} from './scenarios/llmageGate'
import { STOCK_FAKE_CAPABILITIES } from './fake'
import type { ReplayFileEntry } from '../src/net/commands'

interface Frame {
  type?: string
  action?: string
  ok?: boolean
  data?: unknown
}

function request(ws: WebSocket, action: string, args: Record<string, unknown> = {}): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const requestId = `req-${action}`
    const onMessage = (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Frame & { requestId?: string }
      if (frame.type !== 'result' || frame.action !== action || String(frame.requestId) !== requestId) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(frame)
    }
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error(`timeout waiting for result of ${action}`))
    }, 4000)
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ action, requestId, args }))
  })
}

async function connect(server: FakeServer): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  return ws
}

describe('llmageScenario — verb shapes', () => {
  it('answers getPlayerTypes, getFinishedMatches and the connect capabilities', async () => {
    const server = await FakeServer.start(0, () => llmageScenario())
    const ws = await connect(server)
    try {
      const connect = await request(ws, 'connect', { username: 'tester' })
      expect(connect.ok).toBe(true)
      expect(connect.data).toMatchObject({
        capabilities: {
          llm: true,
          p1: true,
          replayScrubber: true,
          replaySidecar: true,
          serverVersion: '1.4.62-V1',
        },
      })

      const types = await request(ws, 'getPlayerTypes')
      expect(types.data).toContain('COMPUTER_LLM')
      expect(types.data).toContain('COMPUTER_P1')

      const matches = await request(ws, 'getFinishedMatches')
      expect(matches.ok).toBe(true)
      expect(matches.data).toEqual([])
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('answers the six new verbs with the frozen wire shapes', async () => {
    const server = await FakeServer.start(0, () => llmageScenario())
    const ws = await connect(server)
    try {
      const p1 = await request(ws, 'getP1Decks')
      expect(p1.ok).toBe(true)
      const p1Data = p1.data as { decks: { name: string; deck: string }[]; default: string }
      expect(p1Data.decks).toEqual(DEFAULT_P1_DECKS)
      expect(p1Data.default).toBe(DEFAULT_P1_DEFAULT)

      const replay = await request(ws, 'getReplayFiles')
      expect(replay.ok).toBe(true)
      const replayData = replay.data as { directory: string; exists: boolean; files: ReplayFileEntry[] }
      expect(typeof replayData.directory).toBe('string')
      expect(replayData.exists).toBe(true)
      expect(replayData.files).toHaveLength(3)
      expect(replayData.files.filter((f) => f.meta === undefined)).toHaveLength(1)
      expect(replayData.files.some((f) => f.meta?.players && f.meta.players.length === 2)).toBe(true)

      const models = await request(ws, 'fetchModels', { apiEndpoint: 'http://localhost:11434/v1' })
      expect(models.ok).toBe(true)
      expect((models.data as { models: string[] }).models).toEqual(DEFAULT_LLM_MODELS)

      const personalities = await request(ws, 'fetchPersonalities')
      expect(personalities.ok).toBe(true)
      expect((personalities.data as { personalities: string[] }).personalities).toEqual(DEFAULT_LLM_PERSONALITIES)

      const decision = await request(ws, 'llm_decision', { requestId: 'x', rawResponse: 'ok' })
      expect(decision.ok).toBe(true)
      expect(decision.data).toEqual({})

      const error = await request(ws, 'llm_error', { requestId: 'y', message: 'nope', retryable: false })
      expect(error.ok).toBe(true)
      expect(error.data).toEqual({})
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('honors option overrides for every verb', async () => {
    const server = await FakeServer.start(0, () =>
      llmageScenario({
        p1Decks: [{ name: 'Only Deck', deck: 'text' }],
        p1Default: 'Only Deck',
        replayFiles: { directory: '/tmp/replays', exists: false, files: [] },
        models: ['m1'],
        personalities: ['p1'],
      }),
    )
    const ws = await connect(server)
    try {
      expect((await request(ws, 'getP1Decks')).data).toEqual({
        decks: [{ name: 'Only Deck', deck: 'text' }],
        default: 'Only Deck',
      })
      expect((await request(ws, 'getReplayFiles')).data).toEqual({ directory: '/tmp/replays', exists: false, files: [] })
      expect((await request(ws, 'fetchModels', { apiEndpoint: 'x' })).data).toEqual({ models: ['m1'] })
      expect((await request(ws, 'fetchPersonalities')).data).toEqual({ personalities: ['p1'] })
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('the onVerb hook sees every request before the built-in answers', async () => {
    const seen: string[] = []
    const server = await FakeServer.start(0, () =>
      llmageScenario({
        onVerb: (_conn, action) => {
          seen.push(action)
          return false
        },
      }),
    )
    const ws = await connect(server)
    try {
      await request(ws, 'getP1Decks')
      await request(ws, 'getReplayFiles')
      await request(ws, 'fetchModels', { apiEndpoint: 'x' })
      await request(ws, 'fetchPersonalities')
      await request(ws, 'llm_decision', { requestId: 'x', rawResponse: 'ok' })
      expect(seen).toEqual(['getP1Decks', 'getReplayFiles', 'fetchModels', 'fetchPersonalities', 'llm_decision'])
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('a scenario with the stock (all-off) capabilities keeps the gates off', async () => {
    const server = await FakeServer.start(0, () =>
      llmageScenario({ capabilities: STOCK_FAKE_CAPABILITIES, playerTypes: STOCK_FAKE_CAPABILITIES.playerTypes as string[] }),
    )
    const ws = await connect(server)
    try {
      const connect = await request(ws, 'connect', { username: 'tester' })
      expect(connect.data).toMatchObject({ capabilities: { llm: false, p1: false, replayScrubber: false, replaySidecar: false } })
      const types = (await request(ws, 'getPlayerTypes')).data as string[]
      expect(types).not.toContain('COMPUTER_LLM')
      expect(types).not.toContain('COMPUTER_P1')
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('onVerb can answer the request itself (returning true suppresses the default)', async () => {
    const server = await FakeServer.start(0, () =>
      llmageScenario({
        onVerb: (conn, action, _args, requestId) => {
          if (action !== 'getP1Decks') return false
          conn.ok(requestId, action, { decks: [], default: '' })
          return true
        },
      }),
    )
    const ws = await connect(server)
    try {
      expect((await request(ws, 'getP1Decks')).data).toEqual({ decks: [], default: '' })
    } finally {
      ws.close()
      await server.stop()
    }
  })
})
