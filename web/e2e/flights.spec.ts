import { fakeOnly } from './support/fake-mode'
import { TABLE } from '../fixtures/table-names'
import { DECK } from '../fixtures/deck-names'
import { test, expect } from './fixtures'
fakeOnly()
import { startGame } from './support/start-game'
import { withFakeServer } from './support/fake-backend'
import { spellsScenario } from '../fixtures/scenarios/spells'

interface DiagEntry {
  t: number
  kind: string
  reason?: string
  cardId: string
  detail?: string
}

import type { Page } from '@playwright/test'
import { retryTimingSpecInCi } from './support/timing'

retryTimingSpecInCi()

async function flightLog(page: Page): Promise<DiagEntry[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __mageFlights?: { log: () => DiagEntry[] } }
    return w.__mageFlights?.log() ?? []
  })
}

test('animaciones de movimiento: diagnóstico de vuelos por transición @flights', async ({ page }) => {
  await withFakeServer(
    () => spellsScenario('blaze'),
    async () => {
      const { pageErrors } = await startGame(page, {
        prefix: 'fl',
        tableName: TABLE.spellsBlaze,
        deck: DECK.advanced,
        skipAsks: true,
      })
      await expect(page.locator('.game-board')).toBeVisible({ timeout: 20_000 })

      const setup = await page.evaluate(() => {
        const s = (
          window as unknown as {
            __mageStore?: { getState: () => { game: any; gameId: string } }
            __mageFlights?: { clear: () => void }
          }
        ).__mageStore?.getState()
        const game = s?.game
        const me = game?.players?.find((p: any) => p.controlled)
        const handIds: string[] = Object.keys(game?.myHand ?? {})
        const blazeId = handIds.find((id) => String(game.myHand[id]?.name ?? '').toLowerCase().includes('blaze'))
        const landId = Object.keys(me?.battlefield ?? {})[0]
        return { gameId: s?.gameId ?? null, handCount: handIds.length, blazeId: blazeId ?? null, landId: landId ?? null }
      })
      expect(setup.gameId, 'gameId vivo').toBeTruthy()
      expect(setup.blazeId, 'Blaze en mano inicial').toBeTruthy()
      expect(setup.landId, 'tierra en campo').toBeTruthy()

      const report: string[] = []
      let diagFlushed = false
      // La telemetría se adjunta una sola vez. `push` la vuelca al final, pero la
      // sección F la vuelca ANTES de sus aserciones: un fallo ahí no puede
      // llevarse por delante el diagnóstico que lo explica (el fallo original de
      // esta spec solo dejaba el volcado en la traza).
      const flushDiag = async () => {
        if (diagFlushed) return
        diagFlushed = true
        await test.info().attach('flights-diag', { body: report.join('\n'), contentType: 'text/plain' })
        console.log(report.join('\n'))
      }
      const push = async (label: string, mutate: string, waitMs = 700): Promise<DiagEntry[]> => {
        const before = (await flightLog(page)).length
        await page.evaluate(
          ({ gameId, fn }) => {
            const w = window as unknown as {
              __mageStore?: { getState: () => any; handleMessage: (m: any) => void }
            }
            const st = w.__mageStore
            if (!st) throw new Error('sin __mageStore')
            const cur = st.getState().game
            const next = structuredClone(cur)
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const apply = new Function('view', `return (${fn})(view)`) as (v: any) => void
            apply(next)
            st.handleMessage({ type: 'event', method: 'GAME_UPDATE', messageId: Date.now(), objectId: gameId, data: { gameView: next } })
          },
          { gameId: setup.gameId, fn: mutate },
        )
        await page.waitForTimeout(waitMs)
        const entries = (await flightLog(page)).slice(before)
        report.push(`--- ${label} (${entries.length} entradas) ---\n` + entries.map((e) => `${e.kind}${e.reason ? `:${e.reason}` : ''} ${e.cardId} ${e.detail ?? ''}`).join('\n'))
        return entries
      }

      const hasStart = (entries: DiagEntry[], id: string | null) =>
        !!id && entries.some((e) => e.kind === 'start' && e.cardId === id)

      // A) Robo: carta nueva en mano -> vuelo biblioteca->mano (rama B-draw).
      const drawEntries = await push(
        'A robo',
        `view => {
          const src = Object.values(view.myHand)[0];
          view.myHand['draw-probe-1'] = { ...src, id: 'draw-probe-1', name: 'Probe Draw' };
        }`,
      )
      expect(hasStart(drawEntries, 'draw-probe-1'), 'A: el robo debería iniciar un vuelo').toBeTruthy()

      // B) Casteo: Blaze mano->stack (rama B-stack o camino A).
      const castEntries = await push(
        'B casteo',
        `view => {
          const me = view.players.find(p => p.controlled);
          const id = Object.keys(view.myHand).find(k => String(view.myHand[k]?.name ?? '').toLowerCase().includes('blaze'));
          const card = view.myHand[id];
          delete view.myHand[id];
          view.stack = { ...(view.stack ?? {}), [id]: { ...card, controllerId: me.playerId, controllerName: me.name } };
        }`,
      )
      expect(hasStart(castEntries, setup.blazeId), 'B: el casteo debería iniciar un vuelo').toBeTruthy()

      // C) Ráfaga: resolución stack->campo + tierra->cementerio en el MISMO
      // update, y 60ms después el permanente->cementerio (como un counter).
      const burstEntries = await push(
        'C rafaga x2 en un update',
        `view => {
          const me = view.players.find(p => p.controlled);
          const stackIds = Object.keys(view.stack ?? {});
          const bfIds = Object.keys(me.battlefield ?? {});
          const spellId = stackIds[0];
          const landId = bfIds[0];
          const spell = view.stack[spellId];
          delete view.stack[spellId];
          me.battlefield[spellId] = { ...me.battlefield[landId], ...spell };
          const [doomed] = Object.keys(me.battlefield).filter(k => k !== spellId);
          if (doomed) {
            const perm = me.battlefield[doomed];
            delete me.battlefield[doomed];
            me.graveyard = { ...(me.graveyard ?? {}), [doomed]: perm };
          }
        }`,
      )
      const counterEntries = await push(
        'C2 counter 60ms despues (misma carta)',
        `view => {
          const me = view.players.find(p => p.controlled);
          const ids = Object.keys(me.battlefield ?? {});
          if (ids.length > 0) {
            const perm = me.battlefield[ids[0]];
            delete me.battlefield[ids[0]];
            me.graveyard = { ...(me.graveyard ?? {}), [ids[0]]: perm };
          }
        }`,
        900,
      )
      report.push(`C: starts=${burstEntries.filter((e) => e.kind === 'start').length} cancels=${burstEntries.filter((e) => e.kind === 'cancel').length}`)
      report.push(`C2: starts=${counterEntries.filter((e) => e.kind === 'start').length} cancels=${counterEntries.filter((e) => e.kind === 'cancel').length}`)

      // D) Bounce (campo->mano): hoy sin rama en B, depende del camino A.
      const bounceEntries = await push(
        'D bounce campo->mano',
        `view => {
          const me = view.players.find(p => p.controlled);
          const ids = Object.keys(me.battlefield ?? {});
          if (ids.length > 0) {
            const perm = me.battlefield[ids[0]];
            delete me.battlefield[ids[0]];
            view.myHand[ids[0]] = perm;
          }
        }`,
      )
      report.push(`D: starts=${bounceEntries.filter((e) => e.kind === 'start').length} ids=${[...new Set(bounceEntries.map((e) => e.cardId))].join(',')}`)

      // E) Descarte (mano->cementerio): hoy sin rama en B.
      const myHandBefore = await page.evaluate(() => {
        const w = window as unknown as { __mageStore?: { getState: () => any } }
        return Object.keys(w.__mageStore?.getState().game?.myHand ?? {})
      })
      const discardEntries = await push(
        'E descarte mano->cementerio',
        `view => {
          const me = view.players.find(p => p.controlled);
          const ids = Object.keys(view.myHand ?? {});
          if (ids.length > 0) {
            const card = view.myHand[ids[0]];
            delete view.myHand[ids[0]];
            me.graveyard = { ...(me.graveyard ?? {}), [ids[0]]: card };
          }
        }`,
      )
      const arrived = await page.evaluate((id) => {
        const w = window as unknown as { __mageStore?: { getState: () => any } }
        const game = w.__mageStore?.getState().game
        const me = game?.players?.find((p: any) => p.controlled)
        return { inGrave: !!(id && me?.graveyard?.[id]), graveCount: Object.keys(me?.graveyard ?? {}).length }
      }, myHandBefore[0] ?? null)
      report.push(`E: starts=${discardEntries.filter((e) => e.kind === 'start').length} arrived=${JSON.stringify(arrived)}`)
      expect(arrived.inGrave, 'E: la carta descartada debe llegar al cementerio').toBe(true)
      expect(
        discardEntries.some((e) => e.kind === 'start'),
        'E: el descarte debe iniciar un vuelo (rama G del engine)',
      ).toBeTruthy()

      // F) Ráfaga real: la misma carta cambia de zona 3 veces (mano -> pila ->
      // campo -> cementerio), como una ráfaga del servidor real. Los tres
      // updates se entregan DESDE LA PÁGINA (un `page.evaluate` por update
      // costaba ~170 ms de ida y vuelta medidos 2026-10-13: el "50 ms" de
      // `waitForTimeout(50)` llegaba al motor con 220-490 ms, así que la spec
      // medía el retardo de su arnés) separados por un macrotask, que es la
      // separación mínima con la que la app ve tres transiciones y no una.
      const burstId = await page.evaluate(() => {
        const w = window as unknown as { __mageStore?: { getState: () => any } }
        return Object.keys(w.__mageStore?.getState().game?.myHand ?? {})[0] ?? null
      })
      if (burstId) {
        const b0 = (await flightLog(page)).length
        // Vigilancia del fantasma EN EL DOM: qué vuelo representa a la carta en
        // cada instante y si su animación sigue corriendo. El proxy de
        // telemetría (`kind === 'cancel'`) no distingue un fantasma que aún
        // vuela de uno ya aterrizado y re-barrido; el DOM sí.
        await page.evaluate((cardId) => {
          const w = window as unknown as {
            __mageFlights?: { active: () => Array<{ cardId: string; flightId: string; startTime: number; duration: number }> }
            __burstWatch?: unknown[]
          }
          const samples: Array<Record<string, unknown>> = []
          w.__burstWatch = samples
          const t0 = Date.now()
          const iv = setInterval(() => {
            const rec = (w.__mageFlights?.active() ?? []).find((f) => f.cardId === cardId) ?? null
            const el = rec ? document.querySelector(`.flying-card-item[data-flight-id="${rec.flightId}"]`) : null
            const anim = el ? el.getAnimations()[0] : null
            samples.push({
              t: Date.now() - t0,
              id: rec?.flightId ?? null,
              age: rec ? Math.round(performance.now() - rec.startTime) : null,
              recDur: rec ? Math.round(rec.duration) : null,
              animDur: anim?.effect ? Number(anim.effect.getTiming().duration) : null,
              ct: anim ? Math.round(Number(anim.currentTime ?? 0)) : null,
              play: anim ? anim.playState : null,
              opacity: el ? getComputedStyle(el).opacity : null,
            })
          }, 10)
          setTimeout(() => clearInterval(iv), 3000)
        }, burstId)
        await page.evaluate(
          async ({ gameId, cardId }) => {
            const w = window as unknown as {
              __mageStore?: { getState: () => any; handleMessage: (m: any) => void }
            }
            const st = w.__mageStore
            if (!st) throw new Error('sin __mageStore')
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
            const send = (mutate: (view: any) => void) => {
              const next = structuredClone(st.getState().game)
              mutate(next)
              st.handleMessage({ type: 'event', method: 'GAME_UPDATE', messageId: Date.now(), objectId: gameId, data: { gameView: next } })
            }
            send((view) => {
              const me = view.players.find((p: any) => p.controlled)
              const card = view.myHand[cardId]
              delete view.myHand[cardId]
              view.stack = { ...(view.stack ?? {}), [cardId]: { ...card, controllerId: me.playerId, controllerName: me.name } }
            })
            await sleep(0)
            send((view) => {
              const me = view.players.find((p: any) => p.controlled)
              const spell = (view.stack ?? {})[cardId]
              if (spell) {
                delete view.stack[cardId]
                me.battlefield[cardId] = { ...spell, tapped: false }
              }
            })
            await sleep(0)
            send((view) => {
              const me = view.players.find((p: any) => p.controlled)
              const perm = (me.battlefield ?? {})[cardId]
              if (perm) {
                delete me.battlefield[cardId]
                me.graveyard = { ...(me.graveyard ?? {}), [cardId]: perm }
              }
            })
          },
          { gameId: setup.gameId, cardId: burstId },
        )
        // 2,4 s: cubre el vuelo encadenado, su fade y el re-barrido del clon.
        await page.waitForTimeout(2_400)
        interface WatchSample {
          t: number
          id: string | null
          age: number | null
          recDur: number | null
          animDur: number | null
          ct: number | null
          play: string | null
          opacity: string | null
        }
        const watch = await page.evaluate(() => {
          const w = window as unknown as { __burstWatch?: unknown[] }
          return (w.__burstWatch ?? []) as WatchSample[]
        })
        // Un vuelo «en curso» es un clon cuya animación sigue corriendo: si el
        // fantasma desaparece (o es sustituido por otro vuelo) con la animación
        // aún en `running`, la ráfaga canceló un vuelo en curso. Un cancel de un
        // clon ya aterrizado (animación terminada, carta real ya revelada) es el
        // re-barrido de diseño, no una cancelación.
        const vanishedInFlight: string[] = []
        for (let i = 0; i < watch.length; i++) {
          const s = watch[i]
          if (!s.id) continue
          const next = watch[i + 1]
          if (!next || next.id === s.id) continue
          if (s.play === 'running' && s.ct != null && s.animDur != null && s.ct < s.animDur) {
            vanishedInFlight.push(
              `${s.id} age-${s.age}ms ct-${s.ct}/${s.animDur}ms opacity-${s.opacity} t-${s.t}ms`,
            )
          }
        }
        report.push(`F: vuelos vigilados en el DOM = ${watch.filter((s) => s.id).length} muestras, cancelados en vuelo = ${vanishedInFlight.length}`)
        const burstEntries = (await flightLog(page)).slice(b0)
        const burstForCard = burstEntries.filter((e) => e.cardId === burstId)
        report.push(
          `--- F rafaga real (misma carta x3) ---\n` +
            burstEntries.map((e) => `${e.kind}${e.reason ? `:${e.reason}` : ''} ${e.cardId} ${e.detail ?? ''}`).join('\n'),
        )
        // La telemetría se adjunta ANTES de las aserciones: un fallo aquí no
        // puede llevarse por delante el diagnóstico que lo explica.
        await flushDiag()
        // La ráfaga debe encadenar UN fantasma continuo —sin cancelar el vuelo
        // en curso— y el destino final es el cementerio.
        expect(
          vanishedInFlight,
          'F: la ráfaga no debe cancelar vuelos en curso',
        ).toEqual([])
        expect(
          burstForCard.some((e) => e.kind === 'chain'),
          'F: la ráfaga debe encadenar el fantasma al nuevo destino',
        ).toBeTruthy()
        const finalPlace = await page.evaluate((id) => {
          const w = window as unknown as { __mageStore?: { getState: () => any } }
          const game = w.__mageStore?.getState().game
          const me = game?.players?.find((p: any) => p.controlled)
          return {
            inGrave: !!me?.graveyard?.[id],
            inHand: !!game?.myHand?.[id],
            inStack: !!game?.stack?.[id],
            inBf: !!me?.battlefield?.[id],
          }
        }, burstId)
        expect(finalPlace, 'F: la carta debe terminar en el cementerio').toEqual({
          inGrave: true,
          inHand: false,
          inStack: false,
          inBf: false,
        })
      }

      await flushDiag()
      expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
    },
  )
})
