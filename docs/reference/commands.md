# Commands

Every task starts from a Node script in `scripts/`, a small set of npm scripts in `web/`, or a shell script in `scripts/deploy/`. This page lists them by job — setup, running the stack, testing, recording fixtures, regenerating code, packaging, and operations — with the flags each one accepts. Run every command from the repository root unless the entry says otherwise.

> **Who this is for:** A developer or operator who needs the exact command and flags for a task.

## Before the first command

| Requirement | Needed for | Notes |
|---|---|---|
| Node.js 20 or newer | Everything web-side | Node 22 is recommended for the client and scripts. |
| Node.js 24 or newer | The MCP package | Declared by `mcp/package.json`; the dashboard's MCP checks need it. |
| Java 17 | Server, proxy, and container runtime | The proxy compiles to older bytecode but runs on 17, with the `--add-opens` flags the engine needs. |
| Maven 3.9 or newer | Java modules | Web-only work does not need Maven. |
| XMage engine checkout | Anything that compiles Java | Point `NEXUS_FORK_DIR` at it, or place it in a sibling directory named `xmage-fork`. |
| `npm --prefix web install` | Web client, tests, generators | Installs the React toolchain and Playwright. |

A web-only loop — unit tests, type checking, the Vite dev server — needs Node and nothing else. Building the proxy or the server needs the engine checkout, Java, and Maven.

## Setup and build

| Command | What it does |
|---|---|
| `node scripts/install.mjs` | Checks Java and Node, installs the engine modules into the local Maven repository, installs the server plugins, copies plugin jars into `local-server/plugins/`, and runs `npm install` in `web/`. Does not start anything. |
| `node scripts/build.mjs` | Full build: engine modules, plugins, plugin jars, then the proxy fat jar. |
| `node scripts/build.mjs proxy` | Packages only the proxy jar, assuming the engine artifacts are already installed. |
| `npm --prefix web run build` | Type-checks and builds the web client into `web/dist`. |
| `npm --prefix web run build:demo` | Builds the client in demo mode into `web/dist-demo`, with the demo flag compiled in. |

`build.mjs` stops any running proxy before packaging, because an open jar file blocks Maven's clean step on Windows. The result is `Mage.Proxy/target/mage-proxy-<version>.jar`.

## Running the stack

`ctl.mjs` launches `dev.mjs` as a detached process and returns immediately; `dev.mjs` is the same controller in the foreground, useful when you want to watch it.

```bash
node scripts/ctl.mjs start|stop|restart|status [server|proxy|vite|all]
node scripts/dev.mjs start|stop|restart|status [server|proxy|vite|all]
```

| Target | Starts |
|---|---|
| `server` | The local XMage server in test mode. Restarting it also restarts the proxy, because the proxy holds the server session. |
| `proxy` | The proxy WebSocket gateway and its HTTP server. |
| `vite` | The Vite dev server for the web client. |
| `all` | All three, in that order. The default when no target is given. |

`start` waits for each port before moving on: up to 10 minutes for the server on a cold card database (`NEXUS_SERVER_WAIT_MS` overrides it), 30 seconds for the proxy, and 60 seconds for Vite. `status` prints a table of running components, their process IDs, and the last lines of each log.

```bash
node scripts/tail.mjs [server|proxy|vite|all] [lines]
```

`tail.mjs` prints the last N lines of the selected logs (25 by default) from the checkout's `.run/` directory. `ctl.mjs` writes its own launch messages to `.run/ctl.out.log`.

`node scripts/warmup.mjs` waits for the proxy to finish building its card database and then plays one disposable AI-versus-AI game. That first game primes the server's callback channel after a cold start, where the very first game can otherwise lose its callback socket. `test.mjs` runs it automatically before the headless game layers.

## Tests

`test.mjs` runs the layers in order. With no arguments it runs all of them; pass layer names to run a subset, or exclude layers with `--skip`.

```bash
node scripts/test.mjs                      # every layer
node scripts/test.mjs typecheck build      # two layers
node scripts/test.mjs --skip=unit,e2e      # everything except these
```

| Layer | Runs | Needs the stack |
|---|---|---|
| `unit` | `vitest run` in `web/` | No |
| `coverage` | `vitest run --coverage` | No |
| `typecheck` | `tsc -b --noEmit` | No |
| `build` | `tsc -b` then `vite build` | No |
| `java` | Maven tests for the proxy, with the engine artifacts in the local repository | No |
| `self-test` | Headless login, AI-versus-AI table, spectator, board | Yes |
| `human-test` | Headless human-versus-AI flow: mulligan, land, spell, target, resolve | Yes |
| `verify` | The anti-drift scripts listed below | Yes |
| `verify-restart` | Reconnect verification; restarts the proxy, so keep it out of mixed runs | Yes |
| `fuzz` | Random-deck self-play with a stall detector | Yes |
| `e2e` | Playwright; fake backend by default, real stack with `E2E_BACKEND=real` | Only in real mode |
| `i18n` | Translation coverage guard | No |

The stack layers wait for the proxy's `/ready` endpoint, not only for its port, and refuse to run when the server or proxy is down. The run prints a per-layer pass/fail summary and a total line; the exit code is non-zero if anything failed. `all` is not a layer name; an unknown name is an error.

### Individual test scripts

| Command | Checks |
|---|---|
| `node scripts/self-test.mjs [username]` | Login, AI table, spectator, and board, without a browser. |
| `node scripts/human-test.mjs [username]` | A deterministic human-versus-AI game with a fixed opening hand. |
| `node scripts/multi-tenant-test.mjs` | Two connections get independent sessions unless they use the same account. |
| `node scripts/verify-player-leave.mjs` | A player conceding mid-game leaves the game running for the others. |
| `node scripts/verify-hand-permission.mjs` | A spectator asking for and receiving hand visibility. |
| `node scripts/verify-spectator-end.mjs` | Spectators receive the end-of-game information. |
| `node scripts/verify-range-attack.mjs` | Range of influence and attack-direction options in a four-player game. |
| `node scripts/verify-rollback-vote.mjs` | Accept, deny, and mixed rollback votes. |
| `node scripts/verify-swiss.mjs` | A Swiss tournament runs to completion headlessly. |
| `node scripts/verify-tournament-watch.mjs` | Watching a live tournament match. |
| `node scripts/verify-reconnect.mjs` | A dropped player reattaches to the same session and prompt. |
| `node scripts/verify-wizard-matrix.mjs` | Every valid table type is created and removed against the server. |
| `node scripts/verify-report.mjs [--reports-dir <path>]` | The report channel's auth, caps, quota, and storage. |
| `node scripts/fuzz.mjs [--games=N] [--concurrency=N] [--maxTurns=N] [--stallMs=N] [--maxGameMs=N]` | Random-deck self-play; add `--humanDeck` and `--simDeck` to reproduce one matchup. |
| `node scripts/i18n-coverage.mjs` | Missing translation keys and untranslated-copy thresholds. |

The verification scripts print a result per step and exit non-zero on failure. They all drive the real protocol against a running stack.

### Browser tests

```bash
npm --prefix web run test:e2e          # fake backend, no stack
npm --prefix web run test:e2e:real     # against the running stack
npm --prefix web run test:e2e:webkit   # WebKit engine
```

Tag filters are available as `test:e2e:spells`, `test:e2e:targeting`, `test:e2e:combat`, `test:e2e:fullflow`, and `test:e2e:board`; `test:e2e:site` runs the site-downloads spec. The visual gallery spec runs through `test:e2e:visual`, or through `node scripts/gallery-visual.mjs`, which sweeps Chromium and WebKit across 1366×768, 1920×1080, and 2560×1440. Add `--update` to regenerate the baselines, `--browser=` or `--viewport=` to narrow the sweep, and `--dry-run` to list it.

`node scripts/verify-demo.mjs [dir]` serves a demo build (default `web/dist-demo`), opens it in Chromium, and checks the lobby and demo scenarios for page errors.

## Recording protocol fixtures

```bash
node scripts/record.mjs            # every registered driver
node scripts/record.mjs <driver>   # one mechanic
```

A driver connects to the proxy, creates a real table, plays a scripted mechanic, and writes the first matching game frame to `web/fixtures/recorded/`. Drivers live in `scripts/drivers/` and cover combat, targeting, alternate costs, dungeons, day/night, tournaments, and more. The recorder needs the full stack and a real server: by default the local one, or another host through `E2E_SERVER_HOST` and `E2E_SERVER_PORT`.

`node scripts/record-sync.mjs` rebuilds `web/fixtures/recorded/manifest.json` from the drivers' metadata, adds entries for newly recorded files, and lists recorded fixtures whose assertion is missing from the recorded-frames test.

## Regenerating code and data

| Command | Regenerates |
|---|---|
| `node scripts/gen-types.mjs [--validate]` | TypeScript interfaces from the protocol contract schema. |
| `node scripts/gen-zod.mjs [--validate]` | Runtime validators for the contract's game view. |
| `node scripts/server-state-schema.mjs [--validate]` | The server-state fixture (game types and deck types) from the engine's server config. |
| `node scripts/view-schema.mjs`, `engine-view-schema.mjs`, `hint-schema.mjs` | Coverage-oracle fixtures for the drift guards: serializable view fields, engine-only state, and hint sources. `engine-view-schema.mjs` also accepts `--update-baseline`. |
| `node scripts/gen-splash-i18n.mjs [--validate]` | The static splash screen's translations from the locale dictionaries. |
| `node scripts/gen-keywords-i18n.mjs [--check]` | The keyword section of every locale. `--check` reports without writing. |
| `node scripts/gen-showcase-art.mjs [--validate]` | The committed showcase art set and its manifest. Downloads from Scryfall when generating. |
| `node scripts/i18n-coverage.mjs` | Nothing; it is the guard that fails when keys are missing. |
| `node scripts/build-scryfall-image-index.mjs [--bulk-dir <dir>] [--out <dir>] [--out-tmp <dir>]` | The offline card-image index. Without `--bulk-dir` it downloads Scryfall bulk data into a temporary directory. |

`npm --prefix web run gen` runs the three contract generators in sequence. The matching `:validate` npm scripts run the same generators in check mode and fail instead of writing, which is what CI uses.

## Packaging and releases

| Command | Output |
|---|---|
| `node scripts/assemble-modules.mjs [stagingDir]` | A staging tree with the server classes, libraries, plugins, config, proxy jar, and a `version.json` describing each component and its launch command. Defaults to `staging/`. |
| `node scripts/deploy-bundle.mjs` | `deploy/bundle/` with the proxy jar, the built web client, start scripts for Linux/macOS and Windows, and a short guide. Requires the jar and `web/dist` to exist first. |
| `node scripts/gen-manifest.mjs --tag <tag> --dir <artifacts> --out <file> [--repo <owner/repo>] [--base-url <url>] [--xmage <version>]` | The launcher component manifest from packaged tarballs. |
| `node scripts/gen-latest.mjs --tag <tag> --target-key <platform> --bundle-dir <dir> --out <file> [--repo <owner/repo>]` | One platform fragment of the desktop updater's `latest.json`. |
| `node scripts/gen-release-body.mjs --assets-dir <dir> --tag <tag> --notes <text> --out <file>` | Release notes naming the installer for each OS and marking the rest as launcher-managed. |
| `node scripts/dashboard-ci.mjs` | Runs the light CI layers (unit and coverage, typecheck, build, fake browser tests, MCP checks, proxy tests) and generates the status dashboard. |
| `node scripts/gen-dashboard.mjs` | Rebuilds `site/status.json` from the test artifacts and the dashboard content file. |
| `node scripts/check-status.mjs` | Exits non-zero when any dashboard layer is red. |
| `node scripts/integration-report.mjs` | Runs the real-stack integration layers and writes `reports/integration-result.json`. |
| `node scripts/check-upstream-release.mjs [version]` | Fails when the upstream engine has a release newer than the version the fork and proxy are built from. |

The desktop launcher itself is built with the Rust toolchain in `launcher/`; the two manifest scripts above produce the files its updater consumes.

## Operations helpers

| Command | Use |
|---|---|
| `scripts/host-deploy.sh` | On a host running the proxy as a service: pull, rebuild engine, plugins, proxy, and web client, refresh the jar link, restart the service. Override `REPO`, `SERVICE`, `PROXY_LINK`, `JAVA_HOME`, `MVN_BIN_DIR`, or `NVM_DIR` through the environment. |
| `node scripts/clean-tables.mjs <username> [username...]` | Removes orphaned tables and games owned by the given test accounts on the local server. |
| `node scripts/issue-from-report.mjs --list` | Lists collected player reports grouped by fingerprint. |
| `node scripts/issue-from-report.mjs --show <id>` | Prints one report group. |
| `node scripts/issue-from-report.mjs --open <id> [--yes] [--labels a,b]` | Opens a GitHub issue for a group. Without `--yes` it only prints the body. |
| `node ops/status/server.mjs` | Starts the optional LAN-only status dashboard (Node 22.13 or newer). Configuration is by environment; see [Ports](ports.md). |

`issue-from-report.mjs` also accepts `--dir`, `--host`, `--remote`, `--repo`, `--days`, and `--limit` to choose where reports come from and how many groups to show.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `NEXUS_FORK_DIR` | Build, install, Java tests | Path to the XMage engine checkout. |
| `NEXUS_SERVER_WAIT_MS` | `dev.mjs` | How long to wait for the server port. Default 600000. |
| `NEXUS_PROXY_WARMUP_MS` | `warmup.mjs` | How long to wait for the proxy to become ready. Default 600000. |
| `NEXUS_WARMUP_TRANSIENT_MS` | `warmup.mjs` | How long transient connection failures are retried. Default 180000. |
| `E2E_BACKEND` | `test.mjs e2e`, Playwright | `real` runs against the stack; anything else uses the fake backend. |
| `E2E_PORT` | Playwright | Overrides the dev-server port for one round. Default 5175 fake, 5173 real. |
| `E2E_BROWSER` | Playwright | `webkit` selects WebKit; Chromium is the default. |
| `E2E_VIEWPORT` | Playwright | Viewport as `WIDTHxHEIGHT`. Default 1600×900. |
| `E2E_SERVER_HOST`, `E2E_SERVER_PORT` | Recorder, fuzz | Target XMage server. Defaults are the local server on 17171. |
| `FAKE_PORT` | Standalone fake playground | WebSocket port for the fake server. Default 8789. |

Deployment variables such as `XMAGE_HOST`, `XMAGE_PORT`, `WS_PORT`, `HTTP_PORT`, `BIND`, `ALLOWED_ORIGINS`, and `ADMIN_TOKEN` are covered in the operator guide.

## Related

- [Testing](../developer-guide/testing.md)
- [Deployment](../operator-guide/deployment.md)
- [Ports](ports.md)
- [Troubleshooting](troubleshooting.md)
