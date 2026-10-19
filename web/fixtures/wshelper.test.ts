/**
 * Unit test (NO browser, NO stack) for the HumanHelper's browser identity: the
 * helper must send in its `connect` the SAME browserId
 * `web:<user>:<uuid>` the page persists (web/src/net/browserId.ts), or the
 * proxy's anon-name guard (production security) does not recognise the helper's
 * connect as "the same browser of the session" and rejects it on the ATTACH path
 * with connect_error + close 4401.
 *
 * The behavioural proof (the real ATTACH against the proxy) belongs to the real
 * e2e: `E2E_BACKEND=real npx playwright test e2e/priority-stop-real.spec.ts` and
 * `... e2e/skips.spec.ts`. Here we pin the frame construction and the
 * localStorage key, which is where the defect was.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import {
  BROWSER_ID_STORAGE_KEY,
  composeBrowserId,
  connectArgs,
  planDiscardAnswer,
  readPageBrowserId,
} from '../e2e/wshelper'
import { getBrowserId } from '../src/net/browserId'

describe('HumanHelper: connect-frame browserId', () => {
  it('composes the exact id web:<user>:<uuid> from the persisted uuid', () => {
    expect(composeBrowserId('ps-123', 'uuid-abc')).toBe('web:ps-123:uuid-abc')
    expect(composeBrowserId('ps-123', '')).toBe('')
    expect(composeBrowserId('ps-123', null)).toBe('')
    expect(composeBrowserId('ps-123', undefined)).toBe('')
  })

  it('key and shape match the page\'s own getBrowserId()', () => {
    // vitest's jsdom harness has no localStorage (web/src/net/browserId.ts documents
    // it: Node shadows the global); a minimal one is installed to exercise the
    // SAME persistence path the page uses in a real browser.
    const backing = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, String(v)),
        removeItem: (k: string) => void backing.delete(k),
        clear: () => backing.clear(),
      },
    })
    const pageId = getBrowserId('ps-123')
    const stored = window.localStorage.getItem(BROWSER_ID_STORAGE_KEY)
    expect(stored, `the page must persist the uuid in ${BROWSER_ID_STORAGE_KEY}`).toBeTruthy()
    expect(pageId.startsWith('web:ps-123:')).toBe(true)
    // the id the helper rebuilds is byte for byte the one the page sends
    expect(composeBrowserId('ps-123', stored)).toBe(pageId)
  })

  it('reads the page\'s uuid key and returns the rebuilt id', async () => {
    const evaluate = vi.fn(async (_fn: unknown, _key?: string) => 'uuid-xyz')
    const page = { evaluate } as unknown as Page
    await expect(readPageBrowserId(page, 'skips-42')).resolves.toBe('web:skips-42:uuid-xyz')
    expect(evaluate).toHaveBeenCalledTimes(1)
    // page.evaluate's second argument is THE key shared with the page
    expect(evaluate.mock.calls[0][1]).toBe('mage-web-browser-id')
  })

  it('with no persisted id, or if page.evaluate throws, connects WITHOUT identity (never invents one)', async () => {
    const empty = { evaluate: async () => null } as unknown as Page
    await expect(readPageBrowserId(empty, 'u')).resolves.toBe('')
    const boom = {
      evaluate: async () => {
        throw new Error('no page')
      },
    } as unknown as Page
    await expect(readPageBrowserId(boom, 'u')).resolves.toBe('')
  })

  it('the connect frame carries host/port/username/password/browserId', () => {
    expect(connectArgs('127.0.0.1', 17171, 'ps-1', 'x', 'web:ps-1:u')).toEqual({
      host: '127.0.0.1',
      port: 17171,
      username: 'ps-1',
      password: 'x',
      browserId: 'web:ps-1:u',
    })
  })
})

/**
 * planDiscardAnswer (multi-select GAME_TARGET discards): a live defect resent the
 * SAME uuid 2510 times to a "selected N of 2, min 2" — the server's selection is
 * a toggle, so the minimum was NEVER met and the match froze on turn 2.
 */
describe('HumanHelper: planDiscardAnswer (min-N discard)', () => {
  it('plain discard (no counter): picks the first candidate', () => {
    expect(planDiscardAnswer('Select a card to discard', [], ['a', 'b'])).toEqual({ action: 'pick', id: 'a' })
  })

  it('min 2 with nothing chosen: picks a different candidate', () => {
    expect(planDiscardAnswer('Select card to discard (selected 0 of 2, min 2)', [], ['a', 'b'])).toEqual({
      action: 'pick',
      id: 'a',
    })
  })

  it('min 2 with one already chosen: NEVER resends the chosen id — picks the other', () => {
    const out = planDiscardAnswer('Select card to discard (selected 1 of 2, min 2)', ['a'], ['a', 'b', 'c'])
    expect(out).toEqual({ action: 'pick', id: 'b' })
  })

  it('the message counter wins even when chosenTargets is empty or stale', () => {
    // stale frame: the message already says 1 chosen; without chosen the planner can
    // only take the counter (the HELPER substitutes its local ledger in that case)
    expect(planDiscardAnswer('Select card to discard (selected 1 of 2, min 2)', [], ['a', 'b'])).toEqual({
      action: 'pick',
      id: 'a',
    })
    // and the chosen list always has the last word over the counter (max of both)
    expect(planDiscardAnswer('Select card (selected 1 of 2, min 2)', ['x', 'y'], ['a'])).toBeNull()
  })

  it('maximum reached (selected == max): NOTHING is sent — the engine autocompletes', () => {
    expect(planDiscardAnswer('Select card to discard (selected 2 of 2, min 2)', ['a', 'b'], ['a', 'b', 'c'])).toBeNull()
  })

  it('minimum met below the maximum: confirms (Done = boolean false)', () => {
    expect(planDiscardAnswer('Select cards (selected 1 of 3, min 1)', ['a'], ['a', 'b'])).toEqual({ action: 'done' })
    expect(planDiscardAnswer('Select cards (selected 2 of 5, min 1)', ['a', 'b'], ['a', 'b', 'c'])).toEqual({
      action: 'done',
    })
  })

  it('optional from 0 (min 0): confirming immediately is the UI\'s "Finish"', () => {
    expect(planDiscardAnswer('Select cards (selected 0 of 3, min 0)', [], ['a', 'b'])).toEqual({ action: 'done' })
  })

  it('no candidates outside the selection: null (resending would be the toggle again)', () => {
    expect(planDiscardAnswer('Select card to discard (selected 0 of 2, min 2)', [], [])).toBeNull()
    expect(planDiscardAnswer('Select card to discard (selected 0 of 2, min 2)', ['a'], ['a'])).toBeNull()
  })

  it('tolerates progress wrapped in the server\'s <font> tags', () => {
    const out = planDiscardAnswer(
      'Select card to discard <font color="red">(selected 1 of 2, min 2)</font>',
      ['a'],
      ['a', 'b'],
    )
    expect(out).toEqual({ action: 'pick', id: 'b' })
  })
})
