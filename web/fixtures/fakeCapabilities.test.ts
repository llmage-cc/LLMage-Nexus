import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { FakeServer, LLM_FAKE_CAPABILITIES, makeBaseScenario } from './fake'

interface Frame {
  type?: string
  action?: string
  ok?: boolean
  data?: { capabilities?: Record<string, unknown>; [k: string]: unknown }
}

function request(ws: WebSocket, action: string, args: Record<string, unknown> = {}): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      const frame = JSON.parse(raw.toString()) as Frame
      if (frame.type !== 'result' || frame.action !== action) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(frame)
    }
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error(`timeout waiting for result of ${action}`))
    }, 4000)
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ action, requestId: 1, args }))
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

describe('FakeServer capabilities on the connect result', () => {
  it('stock parity by default: the connect result carries NO capabilities', async () => {
    const server = await FakeServer.start(0, () => makeBaseScenario({ tableId: 't1', tableName: 'stock', gameId: 'g1' }))
    const ws = await connect(server)
    try {
      const res = await request(ws, 'connect', { username: 'tester' })
      expect(res.ok).toBe(true)
      expect(res.data).not.toHaveProperty('capabilities')
    } finally {
      ws.close()
      await server.stop()
    }
  })

  it('scenarios that opt in carry the capabilities block and the LLM player type', async () => {
    const server = await FakeServer.start(0, () =>
      makeBaseScenario({
        tableId: 't1',
        tableName: 'llm',
        gameId: 'g1',
        capabilities: LLM_FAKE_CAPABILITIES,
        playerTypes: LLM_FAKE_CAPABILITIES.playerTypes as string[],
      }),
    )
    const ws = await connect(server)
    try {
      const res = await request(ws, 'connect', { username: 'tester' })
      expect(res.data?.capabilities).toMatchObject({ llm: true, serverVersion: '1.4.62-V1' })
      const types = await request(ws, 'getPlayerTypes')
      expect(types.data).toContain('COMPUTER_LLM')
    } finally {
      ws.close()
      await server.stop()
    }
  })
})
