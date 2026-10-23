#!/usr/bin/env node

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { declaredPluginJars, forkDir, pluginStem, repoRoot } from './lib.mjs'

export const SEED_STAMP_NAME = '.seed-source.json'
export const LLM_PLAYER_NAME = 'Computer - LLM'
export const LLM_PLAYER_CLASS = 'mage.player.llm.LLMPlayer'
export const P1_PLAYER_NAME = 'Computer - P1'
export const P1_PLAYER_CLASS = 'mage.player.p1.P1Player'
export const STRICT_ENV = 'NEXUS_STRICT_CONFIG_SEED'

const PLUGIN_JAR_DIRS = [
  ['Mage.Server', 'release', 'plugins'],
  ['Mage.Server', 'release', 'lib'],
  ['Mage.Server.Plugins', 'Mage.Player.LLM', 'target'],
  ['Mage.Server.Plugins', 'Mage.Player.P1', 'target'],
]

const PLAYER_JAR_PATTERNS = {
  llm: /^mage-player-llm.*\.jar$/,
  p1: /^mage-player-p1.*\.jar$/,
}

export function defaultSeedTargets(root = repoRoot) {
  const localServer = path.join(root, 'local-server')
  const configDir = path.join(localServer, 'config')
  return {
    configPath: path.join(configDir, 'config.xml'),
    stampPath: path.join(configDir, SEED_STAMP_NAME),
    pluginsDir: path.join(localServer, 'plugins'),
  }
}

export function seedSourcePaths(fork) {
  const serverDir = path.join(fork, 'Mage.Server')
  const canonical = path.join(serverDir, 'config', 'config.xml')
  const release = path.join(serverDir, 'release', 'config', 'config.xml')
  const config = fs.existsSync(canonical) ? canonical : release
  return {
    config,
    canonical,
    release,
    fallback: config === release,
    pom: path.join(serverDir, 'pom.xml'),
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

function commitOf(dir) {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  return res.status === 0 ? res.stdout.trim() : null
}

export function playerTypesBlock(xml) {
  return xml.match(/<playerTypes>([\s\S]*?)<\/playerTypes>/)?.[1] ?? ''
}

export function configDeclaresPlayerType(xml, name, className) {
  const block = playerTypesBlock(xml)
  return block.includes(`name="${name}"`) || block.includes(className)
}

export function configDeclaresLlmType(xml) {
  return configDeclaresPlayerType(xml, LLM_PLAYER_NAME, LLM_PLAYER_CLASS)
}

export function configDeclaresP1Type(xml) {
  return configDeclaresPlayerType(xml, P1_PLAYER_NAME, P1_PLAYER_CLASS)
}

export function declaredPlayerJars(xml, name, className) {
  const jars = []
  for (const tag of playerTypesBlock(xml).match(/<playerType\b[^>]*>/g) ?? []) {
    if (!tag.includes(`name="${name}"`) && !tag.includes(className)) continue
    const jar = tag.match(/\bjar="([^"]*)"/)?.[1]
    if (jar) jars.push(jar)
  }
  return jars
}

export function declaredLlmJars(xml) {
  return declaredPlayerJars(xml, LLM_PLAYER_NAME, LLM_PLAYER_CLASS)
}

export function declaredP1Jars(xml) {
  return declaredPlayerJars(xml, P1_PLAYER_NAME, P1_PLAYER_CLASS)
}

export function findPluginJar(fork, pattern) {
  for (const parts of PLUGIN_JAR_DIRS) {
    const dir = path.join(fork, ...parts)
    if (!fs.existsSync(dir)) continue
    const hit = fs
      .readdirSync(dir)
      .filter((file) => pattern.test(file) && !/(sources|javadoc|original-)/.test(file))
      .sort()[0]
    if (hit) return path.join(dir, hit)
  }
  return null
}

export function findLlmJar(fork) {
  return findPluginJar(fork, PLAYER_JAR_PATTERNS.llm)
}

export function findP1Jar(fork) {
  return findPluginJar(fork, PLAYER_JAR_PATTERNS.p1)
}

export function readEngineInfo(fork) {
  const abs = path.resolve(fork)
  const paths = seedSourcePaths(abs)
  const version = fs.readFileSync(paths.pom, 'utf8').match(/<version>(\d+\.\d+[^<]*)<\/version>/)?.[1] ?? ''
  const sourceXml = fs.existsSync(paths.config) ? fs.readFileSync(paths.config, 'utf8') : ''
  return {
    forkDir: abs,
    version,
    commit: commitOf(abs),
    sourceConfig: paths.config,
    canonicalConfig: paths.canonical,
    releaseConfig: paths.release,
    sourceFallback: paths.fallback,
    sourceDeclaresLlm: sourceXml ? configDeclaresLlmType(sourceXml) : false,
    sourceDeclaresP1: sourceXml ? configDeclaresP1Type(sourceXml) : false,
    llmJar: findLlmJar(abs),
    p1Jar: findP1Jar(abs),
  }
}

export function renderSeed(fork) {
  const info = readEngineInfo(fork)
  if (!fs.existsSync(info.sourceConfig)) {
    throw new Error(`missing seed source config: ${info.sourceConfig} (also tried ${info.canonicalConfig} and ${info.releaseConfig})`)
  }
  if (!info.version) {
    throw new Error(`cannot read <version> from ${seedSourcePaths(fork).pom}`)
  }
  const xml = fs
    .readFileSync(info.sourceConfig, 'utf8')
    .replaceAll('${project.version}', info.version)
    .replace('serverAddress="0.0.0.0"', 'serverAddress="127.0.0.1"')
    .replace('maxGameThreads="10"', 'maxGameThreads="20"')
  if (xml.includes('${project.version}')) {
    throw new Error(`unsubstituted placeholders in seed source: ${info.sourceConfig}`)
  }
  return { xml, info }
}

export function readSeedStamp(stampPath) {
  if (!fs.existsSync(stampPath)) return { stamp: null, error: null }
  try {
    return { stamp: JSON.parse(fs.readFileSync(stampPath, 'utf8')), error: null }
  } catch (e) {
    return { stamp: null, error: e.message }
  }
}

export function writeSeed({ configPath, stampPath, fork, now = new Date() }) {
  const { xml, info } = renderSeed(fork)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, xml)
  const stamp = {
    seededAt: now.toISOString(),
    forkDir: info.forkDir,
    sourceConfig: info.sourceConfig,
    sourceKind: info.sourceFallback ? 'release-fallback' : 'canonical',
    engineVersion: info.version,
    engineCommit: info.commit,
    configPath: path.resolve(configPath),
    configSha256: sha256(xml),
    seededBy: 'scripts/config-seed.mjs',
  }
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`)
  return { stamp, info }
}

const PLUGIN_SECTION_LEVEL = {
  playerTypes: 'error',
  gameTypes: 'warn',
  deckTypes: 'warn',
  tournamentTypes: 'warn',
}

/**
 * One finding per plugin jar config.xml declares that local-server/plugins/ does not hold under
 * that exact name. PluginUtil resolves new File(pluginFolder, plugin.getJar()) literally, so a
 * build that produced mage-game-twoplayerduel-1.4.62.jar does not satisfy jar="mage-game-twoplayerduel.jar":
 * the server logs "Can't load plugin" and boots without the type, silently.
 */
function auditDeclaredPlugins({ configXml, pluginsDir, findings }) {
  const available = fs.readdirSync(pluginsDir).filter((file) => file.endsWith('.jar'))
  const byStem = new Map()
  for (const file of available) {
    const stem = pluginStem(file)
    if (!byStem.has(stem)) byStem.set(stem, [])
    byStem.get(stem).push(file)
  }
  for (const { section, jar, names } of declaredPluginJars(configXml)) {
    if (section === 'playerTypes' && names.some((name) => name === LLM_PLAYER_NAME || name === P1_PLAYER_NAME)) continue
    if (fs.existsSync(path.join(pluginsDir, jar))) continue
    const alternatives = (byStem.get(pluginStem(jar)) ?? []).sort()
    const label = `"${names[0]}"${names.length > 1 ? ` (+${names.length - 1} more)` : ''} in <${section}>`
    findings.push({
      level: PLUGIN_SECTION_LEVEL[section] ?? 'warn',
      code: 'plugin-jar-missing',
      message:
        `config.xml declares ${label} from ${jar}, but ${pluginsDir} has no jar with that name` +
        `${alternatives.length ? ` (it has ${alternatives.join(', ')}; config jar names are resolved literally, so that file is never loaded)` : ''}. ` +
        'The server logs "Can\'t load plugin" and boots without it. Run node scripts/build.mjs to install the declared names.',
      section,
      name: names[0],
      jar,
    })
  }
}

export function auditConfigSeed({ configPath, stampPath, pluginsDir, fork, forkError = null }) {
  const findings = []
  const notes = []
  let engine = null
  if (fork) {
    engine = readEngineInfo(fork)
  } else if (forkError) {
    findings.push({ level: 'warn', code: 'fork-unresolved', message: `cannot resolve the XMage fork: ${forkError}` })
  }

  if (engine && !engine.llmJar && !engine.sourceDeclaresLlm) {
    const sourceNote = fs.existsSync(engine.sourceConfig)
      ? `and its ${engine.sourceConfig} declares no "${LLM_PLAYER_NAME}"`
      : `and it has no release config at ${engine.sourceConfig}`
    findings.push({
      level: 'error',
      code: 'fork-without-llm-player',
      message:
        `the resolved fork has no LLM player: ${engine.forkDir} ships no mage-player-llm*.jar ${sourceNote}. ` +
        'This is the stale stock clone (the old ../xmage-fork fallback). Every LLM seat and replay dies with ' +
        'ClassNotFoundException: mage.player.llm.* and the web reports it as "saved by an incompatible build". ' +
        'Point NEXUS_FORK_DIR at the LLMage engine checkout.',
      forkDir: engine.forkDir,
      sourceConfig: engine.sourceConfig,
    })
  }

  const hasConfig = fs.existsSync(configPath)
  const configXml = hasConfig ? fs.readFileSync(configPath, 'utf8') : null
  if (!hasConfig) {
    notes.push(`no config.xml yet at ${configPath}: the next start seeds it from ${engine ? engine.forkDir : 'the resolved fork'}`)
  }

  if (engine && engine.sourceFallback) {
    findings.push({
      level: 'warn',
      code: 'seed-source-fallback',
      message:
        `the fork has no canonical config at ${engine.canonicalConfig}: seeding from ${engine.releaseConfig}. ` +
        `That file names every plugin jar with \${project.version} and declares no "${P1_PLAYER_NAME}" player type, ` +
        'so a dev stack seeded from it boots without P1 and with a versioned LLM jar name.',
    })
  }

  const { stamp, error: stampError } = readSeedStamp(stampPath)
  if (stampError) {
    findings.push({
      level: 'warn',
      code: 'seed-stamp-unreadable',
      message: `seed stamp is not valid JSON: ${stampPath} (${stampError})`,
    })
  }
  if (!stamp && !stampError) {
    notes.push(`seed provenance unknown: ${stampPath} does not exist, so this config.xml cannot be traced to a fork`)
  }
  if (stamp && engine) {
    const stampedFork = stamp.forkDir ? path.resolve(stamp.forkDir) : null
    if (stampedFork === engine.forkDir) {
      notes.push(
        `seed provenance: ${engine.forkDir} (engine ${engine.version}${engine.commit ? ` ${engine.commit.slice(0, 12)}` : ''}, seeded ${stamp.seededAt ?? 'unknown'})`,
      )
    } else {
      findings.push({
        level: 'warn',
        code: 'seed-stale-source',
        message:
          `config.xml was seeded from a DIFFERENT fork than the one resolved now: ` +
          `seeded from ${stampedFork ?? 'unknown'}${stamp.seededAt ? ` at ${stamp.seededAt}` : ''}` +
          ` (engine ${stamp.engineVersion ?? 'unknown'}${stamp.engineCommit ? ` ${String(stamp.engineCommit).slice(0, 12)}` : ''}), ` +
          `current fork is ${engine.forkDir}`,
      })
    }
    const stampedRelease = /[\\/]release[\\/]config[\\/]config\.xml$/.test(stamp.sourceConfig ?? '')
    if (stampedRelease && fs.existsSync(engine.canonicalConfig)) {
      findings.push({
        level: 'warn',
        code: 'seed-from-release-config',
        message:
          `config.xml was seeded from the release config ${stamp.sourceConfig}, but the fork has the canonical ` +
          `${engine.canonicalConfig}. The release config names plugin jars with \${project.version} and declares no ` +
          `"${P1_PLAYER_NAME}" player type: run node scripts/ctl.mjs reset-config to re-seed from the canonical file.`,
      })
    }
  }

  if (configXml) {
    const pluginsReady = fs.existsSync(pluginsDir)
    if (!pluginsReady) {
      notes.push(`local-server plugins dir not built yet (${pluginsDir}): run node scripts/build.mjs`)
    }

    const declaresLlm = configDeclaresLlmType(configXml)
    if (!declaresLlm && engine && (engine.llmJar || engine.sourceDeclaresLlm)) {
      const evidence = [
        engine.llmJar ? `ships ${path.basename(engine.llmJar)} (${engine.llmJar})` : null,
        engine.sourceDeclaresLlm ? `declares "${LLM_PLAYER_NAME}" in ${engine.sourceConfig}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      findings.push({
        level: 'error',
        code: 'llm-player-type-missing',
        message:
          `config.xml has no "${LLM_PLAYER_NAME}" player type, but the resolved fork ${evidence}. ` +
          'Every LLM seat and replay then dies with ClassNotFoundException: mage.player.llm.* and the web reports it ' +
          'as "saved by an incompatible build".',
        sourceConfig: engine.sourceConfig,
        forkDir: engine.forkDir,
        llmJar: engine.llmJar,
      })
    }
    if (declaresLlm && pluginsReady) {
      const jars = declaredLlmJars(configXml)
      if (jars.length) {
        const missing = jars.filter((jar) => !fs.existsSync(path.join(pluginsDir, jar)))
        if (missing.length) {
          const available = fs
            .readdirSync(pluginsDir)
            .filter((file) => /^mage-player-llm.*\.jar$/.test(file))
            .sort()
          findings.push({
            level: 'warn',
            code: 'llm-player-jar-missing',
            message:
              `config.xml declares "${LLM_PLAYER_NAME}" from ${missing.join(', ')}, but ${pluginsDir} has no such jar` +
              `${available.length ? ` (it has ${available.join(', ')})` : ' (no mage-player-llm*.jar at all)'}. ` +
              'The server logs "Can\'t load plugin" and boots without the LLM player type.',
          })
        }
      }
    }

    const declaresP1 = configDeclaresP1Type(configXml)
    if (!declaresP1 && engine && (engine.p1Jar || engine.sourceDeclaresP1)) {
      const evidence = [
        engine.p1Jar ? `ships ${path.basename(engine.p1Jar)} (${engine.p1Jar})` : null,
        engine.sourceDeclaresP1 ? `declares "${P1_PLAYER_NAME}" in ${engine.sourceConfig}` : null,
      ]
        .filter(Boolean)
        .join(', ')
      findings.push({
        level: 'error',
        code: 'p1-player-type-missing',
        message:
          `config.xml has no "${P1_PLAYER_NAME}" player type, but the resolved fork ${evidence}. ` +
          'COMPUTER_P1 is a product feature (the live server reports it as an available player type), so the stack ' +
          'silently loses the P1 seat and every P1 replay dies with ClassNotFoundException: mage.player.p1.*.',
        sourceConfig: engine.sourceConfig,
        forkDir: engine.forkDir,
        p1Jar: engine.p1Jar,
      })
    }
    if (declaresP1 && pluginsReady) {
      const jars = declaredP1Jars(configXml)
      if (jars.length) {
        const missing = jars.filter((jar) => !fs.existsSync(path.join(pluginsDir, jar)))
        if (missing.length) {
          const available = fs
            .readdirSync(pluginsDir)
            .filter((file) => /^mage-player-p1.*\.jar$/.test(file))
            .sort()
          findings.push({
            level: 'error',
            code: 'p1-player-jar-missing',
            message:
              `config.xml declares "${P1_PLAYER_NAME}" from ${missing.join(', ')}, but ${pluginsDir} has no such jar` +
              `${available.length ? ` (it has ${available.join(', ')})` : ' (no mage-player-p1*.jar at all)'}. ` +
              'The server logs "Can\'t load plugin" and boots without the P1 player type.',
          })
        }
      }
    }

    if (pluginsReady) auditDeclaredPlugins({ configXml, pluginsDir, findings })
  }

  const worst = findings.some((f) => f.level === 'error')
    ? 'error'
    : findings.some((f) => f.level === 'warn')
      ? 'warn'
      : 'ok'
  return { findings, notes, engine, stamp, worst, configPath, stampPath, pluginsDir }
}

function mismatchBanner(report, strict) {
  const error = report.findings.find((f) => f.level === 'error')
  const engine = report.engine
  const playerTypeError = !error || error.code.startsWith('llm-') || error.code === 'fork-without-llm-player'
  const title = !playerTypeError
    ? `the dev stack would boot without a plugin config.xml declares (${error.code})`
    : error?.code === 'fork-without-llm-player'
      ? `the resolved fork has no "${LLM_PLAYER_NAME}" player type`
      : `the dev stack would boot without the "${LLM_PLAYER_NAME}" player type`
  return [
    '',
    '==================== CONFIG SEED MISMATCH ====================',
    title,
    `  config:      ${report.configPath}`,
    `  fork:        ${error?.forkDir ?? (engine ? engine.forkDir : 'unresolved')}`,
    `  fork config: ${error?.sourceConfig ?? (engine ? engine.sourceConfig : 'unresolved')}`,
    `  seeded from: ${report.stamp?.sourceConfig ? `${report.stamp.sourceConfig} (stamp${report.stamp.sourceKind ? `, ${report.stamp.sourceKind}` : ''}, ${report.stamp.seededAt ?? 'unknown'})` : 'unknown (no seed stamp)'}`,
    `  LLM jar:     ${error?.llmJar ?? (engine?.llmJar ?? 'none found in the fork')}`,
    `  P1 jar:      ${error?.p1Jar ?? (engine?.p1Jar ?? 'none found in the fork')}`,
    ...(playerTypeError ? [] : [`  missing:     ${error.message}`]),
    '  fix: node scripts/ctl.mjs reset-config   (re-seeds from the current fork, backs up the old file)',
    `       or: rm ${report.configPath}`,
    strict
      ? `  ${STRICT_ENV}=1 is set: refusing to start the stack.`
      : `  set ${STRICT_ENV}=1 to make this fatal.`,
    '==============================================================',
    '',
  ].join('\n')
}

export function printAudit(report, { strict = false } = {}) {
  for (const note of report.notes) console.log(`[config-seed] ${note}`)
  for (const finding of report.findings) {
    const line = `[config-seed] ${finding.level.toUpperCase()} ${finding.code}: ${finding.message}`
    if (finding.level === 'error') console.error(line)
    else console.warn(line)
  }
  const errors = report.findings.filter((f) => f.level === 'error')
  if (errors.length) {
    console.error(mismatchBanner(report, strict))
    if (strict) return false
  }
  return true
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i === -1 ? null : (argv[i + 1] ?? null)
}

function forkFromArgs(argv) {
  const explicit = argValue(argv, '--fork')
  if (explicit) return { fork: path.resolve(explicit), forkError: null }
  try {
    return { fork: forkDir(), forkError: null }
  } catch (e) {
    return { fork: null, forkError: e.message }
  }
}

function main() {
  const argv = process.argv.slice(2)
  const action = argv[0] ?? 'check'
  if (action !== 'check') {
    console.error('usage: node scripts/config-seed.mjs check [--config <path>] [--stamp <path>] [--plugins <path>] [--fork <path>] [--strict]')
    process.exit(1)
  }
  const base = defaultSeedTargets()
  const configPath = path.resolve(argValue(argv, '--config') ?? base.configPath)
  const stampPath = path.resolve(argValue(argv, '--stamp') ?? path.join(path.dirname(configPath), SEED_STAMP_NAME))
  const pluginsDir = path.resolve(argValue(argv, '--plugins') ?? base.pluginsDir)
  const { fork, forkError } = forkFromArgs(argv)
  const strict = argv.includes('--strict') || process.env[STRICT_ENV] === '1'
  const report = auditConfigSeed({ configPath, stampPath, pluginsDir, fork, forkError })
  const ok = printAudit(report, { strict })
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
