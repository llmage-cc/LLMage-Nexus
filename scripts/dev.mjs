#!/usr/bin/env node
// Mage.Proxy dev stack control (server + proxy + vite).
// Diagnostic: node scripts/dev.mjs start|stop|status|restart|check|reset-config [server|proxy|vite|all]
// Non-blocking: node scripts/ctl.mjs start|stop|status|restart|check|reset-config [server|proxy|vite|all]

import fs from 'node:fs'
import path from 'node:path'
import { auditConfigSeed, defaultSeedTargets, printAudit, readSeedStamp, STRICT_ENV, writeSeed } from './config-seed.mjs'
import { copyPluginJars, daemon, forkDir, isAlive, log, logError, logFileFor, PORTS, readPid, SERVER_ADD_OPENS, stopPid, tailFile, waitForPort, waitForPortDown, buildServerClasspath, XMAGE_VERSION } from './lib.mjs'

const arg = process.argv[2] ?? 'status'
const target = process.argv[3] ?? 'all'
const VALID = new Set(['server', 'proxy', 'vite', 'all'])
if (!VALID.has(target)) {
  console.error(`destino inválido: ${target} (server|proxy|vite|all)`)
  process.exit(1)
}

/** Lista de componentes a detener/arrancar según target (con sus dependencias). */
function targetsOf() {
  const list = target === 'all' ? ['server', 'proxy', 'vite'] : [target]
  // el proxy guarda la sesión del servidor: reiniciar el servidor sin reiniciar el
  // proxy deja a JBoss Remoting con estado corrupto (NoClassDefFoundError en
  // InternalTransporterServices) y todo connect falla hasta reiniciar el proxy
  if (target === 'server' && !list.includes('proxy')) list.splice(list.indexOf('server') + 1, 0, 'proxy')
  return list
}

/** local-server/ is runtime state (gitignored): only plugins/ exists on CI or a new machine.
 *  Without config/config.xml the server does not boot, so seed it from the resolved fork
 *  and record where it came from in .seed-source.json. */
function ensureLocalServerDirs() {
  const dir = `${import.meta.dirname}/../local-server`
  for (const sub of ['config', 'db', 'extensions', 'gamesHistory', 'plugins', 'saved']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  const { configPath, stampPath } = defaultSeedTargets()
  if (fs.existsSync(configPath)) return
  const { info } = writeSeed({ configPath, stampPath, fork: forkDir() })
  log(
    `config seed created: ${configPath} (engine ${info.version}, fork ${info.forkDir}, source ${info.sourceConfig}` +
      `${info.sourceFallback ? ' — FALLBACK release config: the fork has no canonical Mage.Server/config/config.xml' : ''})`,
  )
  const { ok } = configAudit()
  if (!ok) process.exit(1)
}

function configAudit({ strict = process.env[STRICT_ENV] === '1' } = {}) {
  const { configPath, stampPath, pluginsDir } = defaultSeedTargets()
  let fork = null
  let forkError = null
  try {
    fork = forkDir()
  } catch (e) {
    forkError = e.message
  }
  const report = auditConfigSeed({ configPath, stampPath, pluginsDir, fork, forkError })
  const ok = printAudit(report, { strict })
  return { report, ok, strict }
}

function resetConfig() {
  const { configPath, stampPath } = defaultSeedTargets()
  const { stamp: oldStamp } = readSeedStamp(stampPath)
  const hadConfig = fs.existsSync(configPath)
  let backup = null
  if (hadConfig) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    backup = `${configPath}.bak-${ts}`
    fs.copyFileSync(configPath, backup)
  }
  const { info, stamp } = writeSeed({ configPath, stampPath, fork: forkDir() })
  log(`config reset: ${configPath}`)
  log(`  previous seed source: ${oldStamp?.forkDir ?? (hadConfig ? 'unknown (config predates the seed stamp)' : 'absent (no config.xml)')}`)
  log(
    `  new seed source:      ${stamp.sourceConfig} (engine ${info.version}, fork ${info.forkDir}${info.commit ? `, commit ${info.commit.slice(0, 12)}` : ''}, ` +
      `${stamp.sourceKind === 'canonical' ? 'canonical config' : 'FALLBACK release config'})`,
  )
  log(`  previous file:        ${backup ?? '(none)'}`)
  const { ok } = configAudit()
  if (!ok) process.exit(1)
}

function startServer() {
  log('arrancando servidor XMage (headless, testMode)…')
  try {
    ensureLocalServerDirs()
    copyPluginJars()
    const cp = buildServerClasspath()
    const args = [...SERVER_ADD_OPENS, '-cp', cp, 'mage.server.Main', '-testMode']
    daemon('server', 'java', args, { cwd: `${import.meta.dirname}/../local-server` })
  } catch (e) {
    logError(e.message)
    return false
  }
  return true
}

function startProxy() {
  const repoRoot = path.join(import.meta.dirname, '..')
  const jar = path.join(repoRoot, 'Mage.Proxy', 'target', `mage-proxy-${XMAGE_VERSION}.jar`)
  if (!fs.existsSync(jar)) {
    logError(`falta el jar del proxy — ejecuta: node scripts/build.mjs`)
    return false
  }
  log('arrancando proxy…')
  // SIM bots and the LLM relay are dev/test-harness only: the release artifacts (Docker,
  // bundle, launcher) launch the proxy with neither, so no deployment runs a bot or exposes
  // /llm-relay. The replay dir must be absolute: the proxy resolves a relative --replayDir
  // against its own CWD (Mage.Proxy/), while the server saves under local-server/saved.
  daemon(
    'proxy',
    'java',
    [
      ...SERVER_ADD_OPENS,
      '-cp', jar,
      'org.mage.proxy.Main',
      '--sim', 'on',
      '--llmRelayEnabled', 'true',
      '--replayDir', path.join(repoRoot, 'local-server', 'saved'),
    ],
    { cwd: path.join(repoRoot, 'Mage.Proxy') },
  )
  return true
}

function startVite() {
  // se lanza el binario de vite con node directamente (sin npm.cmd ni shells):
  // así el pidfile apunta al proceso real y la salida va a .run/
  const viteBin = path.join(import.meta.dirname, '..', 'web', 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(viteBin)) {
    logError(`falta vite en node_modules — ejecuta: npm install (en web)`)
    return false
  }
  log('arrancando vite dev…')
  daemon('vite', 'node', [viteBin, 'dev'], { cwd: `${import.meta.dirname}/../web` })
  return true
}

function stopTargets(list) {
  // orden inverso de arranque: vite primero, proxy, servidor al final
  if (list.includes('vite')) stopPid('vite')
  if (list.includes('proxy')) stopPid('proxy')
  if (list.includes('server')) stopPid('server')
}

/**
 * Waits for the ports of the listed components to stop answering, instead of sleeping a fixed
 * 1.5 s and hoping. The proxy's shutdown hook walks every session before it releases the port, so
 * with a few sessions alive the old process still held 8787 when the new one started: the new
 * WebSocket server failed to bind (`BindException: Address already in use`) but the process stayed
 * up anyway, answering HTTP and reporting `/ready`, while the WebSocket port belonged to the
 * process on its way out. Every script then failed in a different, confusing way.
 */
async function waitForPortsDown(list) {
  const ports = []
  if (list.includes('proxy')) ports.push([PORTS.proxy, 'proxy WebSocket'])
  if (list.includes('server')) ports.push([PORTS.server, 'servidor XMage'])
  if (list.includes('vite')) ports.push([PORTS.vite, 'Vite'])
  for (const [port, label] of ports) {
    try {
      await waitForPortDown(port, 60_000)
    } catch (e) {
      logError(`${label}: ${e.message} — arranco igualmente`)
    }
  }
}

function status() {
  const rows = []
  for (const name of ['server', 'proxy', 'vite']) {
    const pid = readPid(name)
    const alive = isAlive(pid)
    rows.push({ name, pid: alive ? pid : null, state: alive ? 'RUNNING' : 'stopped' })
  }
  console.table(rows)
  for (const name of ['server', 'proxy', 'vite']) {
    const logs = logFileFor(name)
    if (logs.length) tailFile(name, logs[0], 6)
  }
}

async function startAll(only) {
  const list = only ?? targetsOf()
  // 1) servidor
  if (list.includes('server')) {
    stopPid('server')
    if (!startServer()) process.exit(1)
    // CI (runner frío) hace el escaneo completo de cartas la primera vez:
    // el wait por defecto es amplio; local arranca con DB cacheada y no lo nota.
    await waitForRequiredPort(PORTS.server, 'servidor XMage', Number(process.env.NEXUS_SERVER_WAIT_MS ?? 600_000))
    log(`servidor OK (puerto ${PORTS.server})`)
  }

  // 2) proxy
  if (list.includes('proxy')) {
    stopPid('proxy')
    if (!startProxy()) process.exit(1)
    await waitForRequiredPort(PORTS.proxy, 'proxy WebSocket', 30_000)
    log(`proxy OK (ws://localhost:${PORTS.proxy})`)
  }

  // 3) vite
  if (list.includes('vite')) {
    stopPid('vite')
    startVite()
    await waitForRequiredPort(PORTS.vite, 'Vite', 60_000)
    log(`vite OK (http://localhost:${PORTS.vite})`)
  }

  status()
}

async function waitForRequiredPort(port, label, timeoutMs) {
  try {
    await waitForPort(port, timeoutMs)
  } catch (error) {
    logError(`${label} no arrancó: ${error.message}`)
    throw error
  }
}

const ACTIONS = new Set(['start', 'stop', 'status', 'restart', 'check', 'reset-config'])

async function main() {
  if (!ACTIONS.has(arg)) {
    console.error('uso: node scripts/dev.mjs start|stop|status|restart|check|reset-config [server|proxy|vite|all]')
    process.exit(1)
  }
  if (arg !== 'stop' && arg !== 'reset-config') {
    const { ok } = configAudit()
    if (!ok) process.exit(1)
  }
  switch (arg) {
    case 'start':
      await startAll()
      break
    case 'stop':
      stopTargets(targetsOf())
      break
    case 'restart': {
      const list = targetsOf()
      stopTargets(list)
      await waitForPortsDown(list)
      await startAll(list)
      break
    }
    case 'status':
      status()
      break
    case 'check':
      break
    case 'reset-config':
      resetConfig()
      break
  }
}

await main()
