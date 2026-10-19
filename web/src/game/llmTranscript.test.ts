import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildLlmTranscript, downloadLlmTranscript, llmTranscriptFilename } from './llmTranscript'
import type { LLMConversationView } from '../net/types'

vi.mock('../utils/download', () => ({ downloadBlob: vi.fn(() => true) }))
import { downloadBlob } from '../utils/download'

function conv(extra: Partial<LLMConversationView> = {}): LLMConversationView {
  return {
    playerName: 'Koa',
    modelName: 'gemma4:31b-cloud',
    exchangeCount: 2,
    totalContextChars: 100,
    modelContextWindow: 8000,
    streaming: false,
    streamingStartedAt: 0,
    messages: [
      { role: 'user', content: 'Turn 1: what do you play?', promptType: 'DECISION', turn: 1, phaseStep: 'Main 1' },
      { role: 'assistant', content: 'Play Mountain.\n[model_reasoning]need red[/model_reasoning]' },
    ],
    ...extra,
  }
}

const META = { gameId: 'abcdef12-3456-7890-abcd-ef1234567890', now: new Date(2026, 9, 13, 9, 5, 7) }

beforeEach(() => vi.mocked(downloadBlob).mockClear())

describe('llmTranscriptFilename', () => {
  it('mirrors the server naming: player_model_transcript-<stamp>.txt', () => {
    expect(llmTranscriptFilename(conv(), META.now)).toBe(
      'Koa_gemma4_transcript-20261013-090507.txt',
    )
  })

  it('strips path-hostile characters: a path-like name keeps nothing of the path', () => {
    expect(llmTranscriptFilename(conv({ playerName: '../../etc/passwd' }), META.now)).toBe(
      'player_gemma4_transcript-20261013-090507.txt',
    )
    expect(llmTranscriptFilename(conv({ playerName: '   ', modelName: '' }), META.now)).toBe(
      'player_model_transcript-20261013-090507.txt',
    )
    expect(llmTranscriptFilename(conv({ playerName: 'a b/c' }), META.now)).toBe(
      'a_b_gemma4_transcript-20261013-090507.txt',
    )
  })
})

describe('buildLlmTranscript', () => {
  it('heads the file with the identity the server transcript carries', () => {
    const text = buildLlmTranscript(conv(), META)
    expect(text).toContain('=== LLM TRANSCRIPT (exported from the web client) ===')
    expect(text).toContain(`Game: ${META.gameId}`)
    expect(text).toContain('Player: Koa')
    expect(text).toContain('Model: gemma4:31b-cloud')
    expect(text).toContain('Messages: 2')
    expect(text).toContain('Exchanges: 2')
    expect(text).toContain(`Exported: ${META.now.toISOString()}`)
  })

  it('keeps the user prompt metadata and splits the assistant reasoning out', () => {
    const text = buildLlmTranscript(conv(), META)
    expect(text).toContain('MESSAGE #1 (user)')
    expect(text).toContain('[DECISION · T1 · Main 1]')
    expect(text).toContain('Turn 1: what do you play?')
    expect(text).toContain('MESSAGE #2 (assistant)')
    expect(text).toContain('Play Mountain.')
    expect(text).toContain('--- REASONING ---')
    expect(text).toContain('need red')
    expect(text).not.toContain('[model_reasoning]')
  })

  it('carries the assessment/review/reflection sections when the seat has them', () => {
    const text = buildLlmTranscript(
      conv({ gamePlan: 'plan', matchReview: 'review', postGameReflection: 'reflect' }),
      META,
    )
    expect(text).toContain('--- DECK ASSESSMENT ---\nplan')
    expect(text).toContain('--- MATCH REVIEW (for sideboarding) ---\nreview')
    expect(text).toContain('--- POST-GAME REFLECTION ---\nreflect')
  })

  it('flags a trimmed live view as PARTIAL instead of passing it off as complete', () => {
    expect(buildLlmTranscript(conv(), META)).not.toContain('PARTIAL')
    const trimmed = buildLlmTranscript(conv({ messagesHidden: 12 }), META)
    expect(trimmed).toContain('PARTIAL: 12 older message(s)')
    expect(trimmed).toContain('Open the finished game as a replay and export there')
  })

  it('survives a conversation with no messages', () => {
    const text = buildLlmTranscript(conv({ messages: [] }), META)
    expect(text).toContain('Messages: 0')
    expect(text).not.toContain('MESSAGE #1')
  })
})

describe('downloadLlmTranscript', () => {
  it('hands the built text and the server-shaped filename to the download helper', () => {
    expect(downloadLlmTranscript(conv(), META)).toBe(true)
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(filename).toBe('Koa_gemma4_transcript-20261013-090507.txt')
    expect(blob.type).toBe('text/plain;charset=utf-8')
  })
})
