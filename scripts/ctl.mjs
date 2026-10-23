#!/usr/bin/env node
// Control del stack SIN bloquear el shell: lanza node scripts/dev.mjs <args>
// como proceso detached y vuelve al instante. Salida en .run/ctl.out.log.
// Uso: node scripts/ctl.mjs start|stop|restart|status|check|reset-config [server|proxy|vite|all]
// Ej:  node scripts/ctl.mjs restart proxy
//      node scripts/ctl.mjs reset-config   (re-siembra local-server/config/config.xml desde el fork actual)

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log, runDir } from './lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const SYNC = new Set(['status', 'check', 'reset-config'])
if (!args.length) {
  console.error('uso: node scripts/ctl.mjs start|stop|restart|status|check|reset-config [server|proxy|vite|all]')
  process.exit(1)
}

fs.mkdirSync(runDir, { recursive: true })
const nodeBin = process.execPath
const devScript = path.join(repoRoot, 'scripts', 'dev.mjs')

if (SYNC.has(args[0])) {
  const result = spawnSync(nodeBin, [devScript, ...args], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: 'inherit',
  })
  process.exit(result.status ?? 1)
}

const child = spawn(nodeBin, [devScript, ...args], {
  cwd: repoRoot,
  detached: true,
  windowsHide: true,
  stdio: 'ignore',
})
child.unref()
const pid = child.pid

const message = `dev.mjs ${args.join(' ')} lanzado en background (pid ${Number.isFinite(pid) ? pid : 'desconocido'}) — logs en .run/*.log`
fs.appendFileSync(path.join(runDir, 'ctl.out.log'), `${new Date().toISOString()} ${message}\n`)
log(message)
