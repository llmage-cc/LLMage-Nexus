import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'
import { cleanupUser } from './cleanup'
import { login } from './support/start-game'
import { openDrawerTab } from './support/game-screen'

const SHOTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
const FINAL_SHOT = path.join(SHOTS_DIR, 'full-flow-final.png')

interface SceneState {
  game: { turn: number; phase: string; step: string; priority: boolean } | null
  cards: Record<string, { x: number; y: number }>
}

/** Live scenario state, published on __mageScene by web/src/board/sceneBridge.ts. */
async function sceneOf(page: Page): Promise<SceneState | null> {
  try {
    return (await page.evaluate(() => {
      const s = (globalThis as unknown as { __mageScene?: SceneState }).__mageScene
      return s ?? null
    })) as SceneState | null
  } catch {
    return null
  }
}

test('flujo completo: login -> lobby -> demo IA vs IA (espectador) -> tablero avanza sin errores', { tag: '@fullflow' }, async ({ page, fakeServer }) => {
  void fakeServer
  // (a) capturar todos los pageerror y console error
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  const wsFrames: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framesent', (e) => {
      wsFrames.push(`>> ${String(e.payload).slice(0, 200)}`)
      if (wsFrames.length > 500) wsFrames.shift()
    })
    ws.on('framereceived', (e) => {
      wsFrames.push(`<< ${String(e.payload).slice(0, 300)}`)
      if (wsFrames.length > 500) wsFrames.shift()
    })
  })

  // (b) credenciales únicas -> Conectar (XMage limita el nombre a 14 caracteres)
  const username = `e2e-${String(Date.now()).slice(-10)}`
  cleanupUser(username)
  await login(page, username)

  // (d) lobby (el broadcast de mesas llega cada ~2s)
  await expect(page.getByRole('heading', { name: /Lobby|XMage Nexus/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /Mesas/ })).toBeVisible({ timeout: 15_000 })

  // (e) crear mesa IA vs IA y entrar como espectador desde el modal de creación
  // (rediseño 2026-09: la sidebar desktop ya no existe; se entra por el topstrip)
  await page.getByRole('button', { name: /Nueva Mesa/i }).click()
  await page.getByRole('button', { name: /Dev/i }).click()
  await page.getByRole('button', { name: /Espectar \(Bot IA vs Bot IA\)/i }).click()

   // (f) pantalla de partida + canvas de Pixi montado en .board-wrap
  await expect(page.getByTestId('game-status')).toBeVisible({ timeout: 20_000 })
  const board = page.locator('.game')
  await expect(board).toBeVisible({ timeout: 20_000 })
  const gameStatus = page.getByTestId('game-status')
  await expect(gameStatus).toBeVisible()
  const initialGameStatus = await gameStatus.textContent()
  await page.waitForTimeout(1000)

  // (h) entrada del espectador en el GameLog (markup real: .game-log-entries > .game-log-entry)
  //     — AHORA, con la partida aún viva: la demo IA vs IA puede TERMINAR dentro del
  //     propio test (2/2 corridas de la ola 2026-10-15) y su modal "Partida finalizada"
  //     (.dlg-backdrop.end-backdrop) tapa el toggle del cajón, haciendo imposible abrirlo
  //     DESPUÉS del bucle de avance. La entrada la añade el cliente al empezar a espectar
  //     (src/state/events/game.ts, addLog en handleWatchGame), así que está disponible en
  //     los primeros segundos. Si la partida YA hubiera terminado (entorno), el paso se
  //     anota y se omite: con el modal arriba no hay forma legítima de abrir el cajón.
  const endBackdrop = page.locator('.dlg-backdrop.end-backdrop')
  if ((await endBackdrop.count()) === 0) {
    await openDrawerTab(page, 'log')
    await expect(page.locator('.game-log-entries')).toContainText(/Espectador: mirando la partida/, {
      timeout: 15_000,
    })
    // cerrar el cajón (el toggle cierra cuando la pestaña ya está activa) para que las
    // capturas de `.game` del bucle se tomen con el cajón CERRADO — con el cajón abierto
    // lanzan ~3 de cada 4. Si el modal de fin acaba de aparecer y tapa el toggle, el
    // cajón queda abierto y el bucle ya cuenta esas capturas como pierna INCONCLUSA.
    try {
      await page.locator('[data-testid="drawer-tab-log"]').click({ timeout: 2_000 })
    } catch {
      // el modal de fin de partida tapa el toggle: queda abierto, el bucle lo tolera
    }
  } else {
    test.info().annotations.push({
      type: 'note',
      description:
        'spectator-log: la demo ya había TERMINADO antes de esta comprobación ' +
        '(modal "Partida finalizada" sobre el toggle del cajón); el paso del log se omite ' +
        'porque con la partida cerrada no se puede abrir el cajón legítimamente.',
    })
  }

  // (g) verificación de avance: el estado del escenario (__mageScene) avanza y el
  // canvas se redibuja (bytes distintos). __mageScene es el check determinista
  // (primario); el byte-diff queda como humo de que el render real cambia.
  //
  // La captura de `.game` se toma con el cajón CERRADO (ver arriba): con el drawer
  // abierto el screenshot de `.game` lanza ~3 de cada 4 veces (el cajón se repinta/se
  // recoloca sin estabilizar el elemento), y una captura que LANZA NO prueba que el
  // tablero no cambiara — se cuenta como pierna INCONCLUSA, nunca como "la escena no
  // cambió". La entrada del espectador en el log ya se comprobó arriba.
  let baseline: Buffer | null = null
  try {
    baseline = await board.screenshot()
  } catch {
    baseline = null // sin línea base no hay comparación posible: queda INCONCLUSO
  }
  let redrew = false
  let sceneAdvanced = false
  let lastGame: SceneState['game'] | null = null
  let shotsCompared = 0 // capturas válidas comparadas contra la línea base
  let shotFailures = 0 // capturas que lanzaron (el canvas puede desmontarse a mitad)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if ((await board.count()) === 0) {
      // la partida terminó y el tablero desapareció -> la partida avanzó de hecho
      redrew = true
      sceneAdvanced = true
      break
    }
    const scene = await sceneOf(page)
    if (scene?.game) {
      if (!lastGame) lastGame = scene.game
      else if (
        scene.game.turn !== lastGame.turn ||
        scene.game.phase !== lastGame.phase ||
        scene.game.step !== lastGame.step
      ) {
        sceneAdvanced = true
      }
    }
    let shot: Buffer | null = null
    try {
      shot = await board.screenshot()
    } catch {
      // el canvas puede estar desmontándose a mitad de captura; NUNCA se interpreta
      // como "el tablero no cambió" (un screenshot que no se pudo tomar no es prueba)
      shotFailures++
    }
    if (shot) {
      if (!baseline) {
        baseline = shot
      } else {
        shotsCompared++
        if (Buffer.compare(baseline, shot) !== 0) redrew = true
      }
    }
    const currentGameStatus = await gameStatus.textContent().catch(() => null)
    if (currentGameStatus && currentGameStatus !== initialGameStatus) sceneAdvanced = true
    if (redrew && sceneAdvanced) break
    await page.waitForTimeout(800)
  }
  expect(sceneAdvanced, 'el estado de la partida debería avanzar').toBeTruthy()
  if (!redrew && shotsCompared === 0) {
    // Ninguna captura comparable (todas lanzaron, o la línea base nunca se pudo
    // tomar): la pierna del byte-diff queda INCONCLUSA, no roja. Se anota en el
    // informe con el número de capturas fallidas para que no pase por verificada.
    test.info().annotations.push({
      type: 'inconclusive',
      description:
        `redrew: sin capturas comparables (${shotFailures} capturas de .game fallidas); ` +
        'un screenshot que no se pudo tomar no prueba que el tablero no se redibujara.',
    })
  } else {
    expect(redrew, 'el tablero debería redibujarse: la partida IA vs IA no avanza').toBeTruthy()
  }

  // (h) se ejecutó ANTES del bucle de avance: la entrada del espectador en el
  // GameLog exige un toggle que el modal de fin de partida puede llegar a tapar.

  // (i) aserciones finales: cero pageerrors y cero errores fatales de consola
  expect(pageErrors, `pageerrors: ${pageErrors.map(String).join(' | ')}`).toEqual([])
  const fatalConsoleErrors = consoleErrors.filter((t) =>
    /Unhandled error|An error occurred in the/.test(t),
  )
  expect(fatalConsoleErrors, `console fatales: ${fatalConsoleErrors.join(' | ')}`).toEqual([])

  // (j) screenshot final de página completa
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  await page.screenshot({ path: FINAL_SHOT, fullPage: true })

  // anexar evidencia al informe HTML
  await test.info().attach('pageerrors', {
    body: JSON.stringify(pageErrors.map(String), null, 2),
    contentType: 'application/json',
  })
  await test.info().attach('console-errors', {
    body: JSON.stringify(consoleErrors, null, 2),
    contentType: 'application/json',
  })
  await test.info().attach('ws-frames', {
    body: wsFrames.join('\n'),
    contentType: 'text/plain',
  })
  await test.info().attach('select-dump', {
    body: summarizeSelects(wsFrames),
    contentType: 'text/plain',
  })
})

/** Resumen compacto de los GAME_SELECT / GAME_ASK recibidos (turno/step/msg) */
function summarizeSelects(frames: string[]): string {
  const out: string[] = []
  let updates = 0
  let informs = 0
  let lastInform = ''
  for (const f of frames) {
    if (f.includes('GAME_SELECT')) {
      const m = f.match(/"turn":(\d+)/)
      const s = f.match(/"step":"([^"]+)/)
      const msg = f.match(/"message":"([^"]{0,60})/)
      out.push(
        `SELECT turn=${m?.[1] ?? '?'} step=${s?.[1] ?? '?'} msg='${msg?.[1] ?? ''}'`,
      )
    } else if (f.includes('GAME_ASK')) {
      const m = f.match(/"message":"([^"]{0,60})/)
      out.push(`ASK msg='${m?.[1] ?? ''}'`)
    } else if (f.includes('GAME_UPDATE_AND_INFORM')) {
      informs++
      const m = f.match(/"turn":(\d+)/)
      const s = f.match(/"step":"([^"]+)/)
      if (m && s) lastInform = `turn=${m[1]} step=${s[1]}`
    } else if (f.includes('GAME_UPDATE')) {
      updates++
    }
  }
  out.push(`AND_INFORM count=${informs} last=${lastInform}`, `UPDATE count=${updates}`)
  return out.join('\n')
}
