# Deployment — stack, logs, builds, dashboard

> **LLMage Nexus documentation:** for the current guide see [Deployment](operator-guide/deployment.md). This page is inherited from upstream XMage Nexus and may lag behind the client.

## Stack control

- `node scripts/ctl.mjs start|stop|restart|status [server|proxy|vite|all]` — normal control (non-blocking).
- `node scripts/dev.mjs start|stop|status|restart` — direct diagnostics (blocks the shell).
- `node scripts/tail.mjs [server|proxy|vite|all] [lines]` — log reader. Files in `.run/*.log` (`server.out.log`, `proxy.out.log`, `proxy.err.log`, `vite.out.log`, `*.pid`).
- Restarting `server` also restarts `proxy` (stale JBoss Remoting sessions corrupt the bridge). Never restart only the proxy to fix a login hang; restart all.

## Ports

XMage `17171` (testMode) · proxy WS `8787` · proxy HTTP page `8788/index.html` · Vite `5173` · fake E2E `8789` + Vite `5175`. The proxy test page owns 8788 whenever the stack is up; fake mode never uses it.

## Builds

- `node scripts/build.mjs proxy` — proxy jar only (requires the fork in `~/.m2` once per XMage release; stops the proxy itself first for the Windows lock). Output: `Mage.Proxy/target/mage-proxy-1.4.62.jar`. Afterwards `node scripts/ctl.mjs restart proxy`.
- `node scripts/build.mjs` — full (server + plugins + proxy; copies plugins to `local-server/plugins/`).
- `node scripts/install.mjs` — zero-setup from scratch (Maven build + plugins + npm install), then `ctl.mjs start` + `test.mjs`.
- Requirements: JDK 17 (Homebrew `openjdk@17`; `/usr/bin/java` stub breaks daemons — `scripts/lib.mjs` resolves the real binary), Maven 3.9, Node 20+ for the web client and the scripts (**Node ≥24 for `mcp/`**, which runs TypeScript directly via native type stripping). Server and proxy must run with `--add-opens=java.base/java.io=ALL-UNNAMED` (jboss-serialization on JDK 17).
- XMage version `1.4.62-V1` (upstream tag `xmage_1.4.62V1`). Release bumps are a one-line pom change + recompile, but strict version checks mean a mismatched server rejects the proxy. Default target server: `beta.xmage.today:17171`.

## LLM-capable dev server (`NEXUS_FORK_DIR`)

`forkDir()` (`scripts/lib.mjs`) resolves the engine checkout in this order:
`NEXUS_FORK_DIR` → `../xmage-fork` (the **stock** Adamychen fork — no
`COMPUTER_LLM`/`COMPUTER_P1`, so `capabilities.llm` is `false`) → this repo.
For LLM-live work point it at the LLM trunk, e.g.
`NEXUS_FORK_DIR=/path/to/llmage-engine node scripts/ctl.mjs start all`.
This is a deliberate dev-only affordance, not a default: the stock fork stays the
default so the dev stack matches what upstream ships.

Three gotchas when flipping an existing runtime:

- `local-server/config/config.xml` is seeded **once** from whatever fork `forkDir()`
  resolved to at first start. After switching forks, delete `local-server/` (gitignored
  runtime) so the seed re-reads the new fork's release config (the LLM trunk registers
  `Computer - LLM`).
- `.run/server-deps.txt` (server 3rd-party classpath cache) is keyed by pom mtime and
  survives fork switches — delete it too when changing `NEXUS_FORK_DIR`.
- The seeded config expects **versioned** plugin jars (`mage-player-llm-<v>.jar`)
  but `Mage.Server.Plugins/Mage.Player.LLM|P1` build unversioned `finalName`s; after
  `copyPluginJars`, copy `mage-player-llm.jar` → `mage-player-llm-<XMAGE_VERSION>.jar`
  (currently `1.4.62`; same for `-p1`) inside `local-server/plugins/`, and remove stale
  `*-1.4.61.jar` leftovers copied from the engine's old `target/` dirs.

A bare `COMPUTER_LLM` seat probes a localhost Ollama at construction
(`LLMConfig.fetchModelContextWindow`) and fails with `Connection refused` when none
runs; to instantiate a seat without a live backend use a client-key config
(`useClientKey: true` + explicit `modelContextWindow`, see `LlmConfigs.java`).

## Second flavor: XDHS (`mage.xdhs.net`)

The proxy is also built against the xenohedron fork (XDHS server, tag
`1.5.8-XDHS-r1`) so both servers can be served side by side. One web build,
two proxy processes:

- Build: `patches/xdhs/*.patch` are applied to a `xenohedron/mage` checkout,
  then `mvn -Dmage.version=1.5.8`. `Mage.Proxy/pom.xml` takes the XMage
  dependency version from the `mage.version` property.
- Launcher: the `proxy-xdhs` component (built from `patches/xdhs/`; see
  `patches/xdhs/README.md`) is started by the Tauri shell as a second proxy instance on
  ports 8797/8798 with its own card database (`proxy-xdhs/` under the data
  dir). The web login has an "XDHS" preset; everything else is shared.
- Host: `scripts/deploy/host-xdhs.sh` builds and restarts
  `xmage-proxy-xdhs.service` (first run installs the unit). The beta jar,
  symlink and service are untouched.

## Public multi-user deployment (Cloudflare quick tunnels)

See **`docs/deploy-tunnels.md`** for the full guide: run one `Mage.Proxy`
(multi-tenant) on an always-on machine, expose its two ports through Cloudflare
quick tunnels, and point it at `beta.xmage.today`. Bundle it with
`node scripts/deploy-bundle.mjs`; start scripts live in `scripts/deploy/`
(`start-proxy.sh` for Linux/macOS, `start-proxy.bat` for Windows).

## Host status dashboard (LAN only)

`ops/status/` is a dependency-free Node service (`xmage-status.service`) that runs next to the proxy on the
host and serves `http://<host-lan-ip>:8790/`: players online, history/statistics, proxy and tunnel status, host
metrics and restarts, indexed from `journalctl -u xmage-proxy` into SQLite.
It has no public tunnel and rejects every non-LAN client, loopback included (tunnel visitors arrive as `127.x`).
Deploy/update with `ops/status/deploy.sh` (never restarts the proxy). Details: `ops/status/README.md`.

## Dashboard (GitHub Pages, zero-build static `site/`)

- `site/content.json` — canonical dashboard copy (project, phases, features, guards). Keep in sync with `ROADMAP.md`. `release.date`/`tag`/`notes`/`highlights` describe the newest published tag; the generator takes `release.version` from `launcher/src-tauri/Cargo.toml`, so bumping the launcher version is what moves the dashboard's version badge.
- `scripts/gen-dashboard.mjs` — merges `content.json` + test artefacts → `site/status.json`.
- `scripts/dashboard-ci.mjs` — lightweight dashboard layers (unit+coverage, typecheck, build, fake-e2e, proxy java); run it locally.
- `scripts/integration-report.mjs` — real-stack run (self-test/human-test/e2e-real) → `reports/integration-result.json`; run it on demand.
- **No CI ships with this repository**, so there is no `.github/workflows/pages.yml`: run the layers above by hand and publish `site/` to any static host (GitHub Pages also works from a branch).
