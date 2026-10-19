# Code map

This page is a locator, not a tutorial. It tells you which directory owns which concern, which file to open first for a given kind of change, and which files are generated so you do not edit them by hand. File counts are given as scale, not as a contract: they move with every feature.

> **Who this is for:** developers who need to find the right file before making a change.

## Top level

| Path | Responsibility | Start here |
|---|---|---|
| `Mage.Proxy/` | Java WebSocket bridge between the XMage server and any JSON client | `src/main/java/org/mage/proxy/Main.java` |
| `web/` | React 19 + TypeScript client, its schema, fixtures and end-to-end tests | `src/main.tsx`, `src/App.tsx` |
| `scripts/` | Stack control, builds, test orchestration, contract generators, recording, deployment | `scripts/ctl.mjs`, `scripts/test.mjs` |
| `mcp/` | Standalone Model Context Protocol server that drives a session and the repo's scripts | `mcp/src/index.ts` |
| `launcher/` | Rust component bootstrapper and Tauri desktop shell | `launcher/src/main.rs`, `launcher/src-tauri/src/main.rs` |
| `docker/`, `Dockerfile`, `docker-compose.yml` | Container image and entrypoint | `Dockerfile` |
| `site/` | Zero-build static dashboard generated from test artifacts and site content | `site/index.html`, `scripts/gen-dashboard.mjs` |
| `ops/status/` | Small status service for a self-hosted deployment | `ops/status/server.mjs` |
| `patches/` | Patch sets applied to downstream engine forks | `patches/*/README.md` |
| `docs/` | This documentation set | `docs/README.md` |

The repository does not contain the XMage engine. The proxy compiles against engine artifacts installed in the local Maven repository, and the build scripts expect a separate engine checkout when a full build is needed. Day-to-day web work needs neither Java nor Maven.

## Mage.Proxy

Roughly fifty Java source files and twelve thousand lines in `src/main`, plus a test suite of a similar file count under `src/test`. The package is small enough to read end to end; group files by concern:

| Concern | Files | What they do |
|---|---|---|
| Transport | `Gateway`, `AuthorizedConnections`, `OutboundLog` | Accept WebSocket connections, enforce origin and rate limits, keep the numbered per-session frame stream, serialize sends per connection |
| Session lifecycle | `ProxyClient`, `SessionGames`, `ReplayCache`, `ReplayTracker`, `RestoreIds`, `SessionProbe`, `CallbackSequencer`, `Activity` | Login, attach, relink, grace period, per-game bookkeeping, prompt cache, restore ids, link probing, callback ordering, activity journal |
| Command routing | `InfoCommands`, `TableCommands`, `TournamentCommands`, `GameCommands`, `OnlineDeckCommands`, `LlmModelCommands`, `LlmBridgeCommands`, `ReplayFiles`, plus a policy-net deck list handler, `CommandContext` | One handler per action domain; the router in `ProxyClient.handleCommand` tries them in order |
| Data and validation | `JsonUtil`, `JsonArgs`, `DeckJson`, `DeckValidation`, `CardCatalog`, `MatchOptionsParser`, `LlmConfigs`, `ErrorClassifier`, `ProxyProtocol` | Reflection serialization, defensive argument readers, deck parsing and pre-validation, printed-card lookups, option parsing, error codes and envelopes |
| Deployment and operations | `Config`, `DeploymentConfig`, `Main`, `ReportSink`, `ReplayFileDownload`, `LlmRelay`, `LobbyPublisher`, `AnonNameGuard`, `CapabilityGate`, `ServerCapabilities` | Flags, auth token and target pinning, HTTP routes, report storage, replay download, CORS relay, lobby broadcast, anonymous-name collision guard, feature gates |
| Development harness | `SimPlayer`, `SimManager`, `SimRoster` | Deterministic bot seats used by tests and the dev stack. Not a product feature; see the proxy page. |

`Main` wires the WebSocket server, the HTTP routes and the shutdown hook. `ProxyClient` is the largest file and holds the session lifecycle; if you are debugging "the session did something unexpected", start there.

Tests mirror these concerns by class name: transport security and compression, gateway login queue, watchdog, restore ids, session probe, sequencer, replay cache, deck validation, card catalog, LLM bridge and relay, report sink, replay file download.

## Web client

`web/src` holds roughly 950 TypeScript, TSX and CSS files, with tests next to their source. Folders:

| Folder | Responsibility |
|---|---|
| `net/` | WebSocket client (`Gateway.ts`), action wrappers (`commands.ts`), hand-written protocol types (`types.ts`), generated view types, frame buffer, proxy config probe, auth token and browser id helpers, version mismatch parsing |
| `state/` | `state.ts` (application state), `store.ts` (public facade), `actions.ts`, `selectors.ts`, `persistence.ts`, `gateway.ts` (connect, attach, rejoin), `eventHandler.ts` plus `events/` per domain, `slices/` per state area, and the coverage guards |
| `game/` | Match flow: `GameScreen` layout router, `FeedbackDialog` prompt router, `feedback/` parsing, per-mode prompt controls, phase bar, stack zone, action feed, sideboard, draft and construct screens, deck tracker, dialogs |
| `board/` | Battlefield rendering: four board layouts, zone layout, card slots, hand, stack, command zone, pile overlays, targeting and combat overlays, transition engine, flight manager, impact effects, `sceneBridge` |
| `lobby/` | Login, lobby, create-table wizard, join dialog, spectator staging, chat, deck gallery and manager, tournament bracket and standings, leaderboard |
| `decks/` | Deck builder, search and list panels, Scryfall integration, import and export, curve chart, format rules, deck issues, starter decks |
| `cards/` | Card image resolution, offline image index, custom card art, card localization |
| `i18n/` | Typed translation schema, nine locale dictionaries, language selector, coverage guard |
| `audio/` | Sound manager, synthesizer, game sound dispatcher, music engine and intensity |
| `appearance/` | Playmats, sleeves, card image preferences, zoom, custom playmat handling |
| `settings/` | Settings screens and gameplay presets |
| `system/` | About, diagnostics export, error capture, performance probes, desktop CSP test |
| `ui/` | Modal and dialog shell, fields, inputs, selectors, style ratchets |
| `demo/` | In-browser demo socket, scripted tour, demo data |
| `dev/` | Development-only component gallery |
| `setup/` | First-run setup wizard, boot restore, deployment lock |
| `llm/` | Client-key LLM prompt bridge |
| `utils/` | Timers, fullscreen and small shared helpers |

Three rules cross folder boundaries and cause most surprises when broken:

- State slices may import only dependency-free modules. A slice that reaches into `board/` creates an import cycle and crashes at store initialization.
- Fixed-size containers use `overflow: clip`, not `hidden`, so layout does not become scrollable by accident.
- Board effects animate `translate` and `scale`; replacing `transform` breaks the tap state.

## Contract, fixtures and tests

| Path | Role |
|---|---|
| `web/schema/contract.schema.json` | Canonical description of every serialized view type |
| `web/src/net/types.generated.ts` | Generated TypeScript interfaces for those views |
| `web/src/net/types.ts` | Hand-written envelopes, event method names, deck shapes |
| `web/fixtures/fakeCore.ts` | Protocol implementation shared by the Node fixture server and the browser demo socket |
| `web/fixtures/scenarios/` | Declarative game scenarios used by fake E2E and demo mode |
| `web/fixtures/recorded/` | Real frames captured from a live game, plus an invariant manifest |
| `web/fixtures/schema.ts`, `schema.generated.ts` | Runtime validation of frames |
| `web/e2e/` | Playwright specs and helpers; the same specs run against the fake and the real backend |
| `web/INTERACTION_COVERAGE.md` | Per-callback coverage matrix, enforced by a unit test |

## Scripts

About 140 Node scripts across the top level and subfolders. They fall into groups:

| Group | Examples | Purpose |
|---|---|---|
| Stack control | `ctl.mjs`, `dev.mjs`, `tail.mjs`, `build.mjs`, `install.mjs`, `lib.mjs` | Start, stop, restart and inspect server, proxy and dev server; build artifacts; resolve tool paths |
| Test orchestration | `test.mjs` | Runs the named layers in order and reports a single result |
| Real-stack harnesses | `self-test.mjs`, `human-test.mjs`, `fuzz.mjs`, `warmup.mjs`, `multi-tenant-test.mjs` | Drive real games through the WebSocket protocol |
| Anti-drift checks | `verify-*.mjs` | Scenario checks that fail when protocol or session behaviour changes |
| Recording | `record.mjs`, `rec-lib.mjs`, `drivers/` | Capture real frames into fixtures |
| Generators | `gen-types.mjs`, `gen-zod.mjs`, `view-schema.mjs`, `engine-view-schema.mjs`, `server-state-schema.mjs`, `hint-schema.mjs`, `extract-keywords.mjs`, `gen-splash-i18n.mjs` | Produce schemas, types, keyword data and splash translations; each has a validation mode |
| Release and site | `gen-dashboard.mjs`, `gen-manifest.mjs`, `gen-release-body.mjs`, `assemble-modules.mjs`, `deploy-bundle.mjs` | Build release metadata and the static dashboard |
| Deployment | `deploy/`, `host-deploy.sh`, `tunnel-sync.mjs`, `check-upstream-release.mjs` | Host-side helpers and the upstream release probe |

## MCP server, launcher and dashboard

- `mcp/` is a standalone stdio server. `src/index.ts` registers the tools, `src/tools/` wraps repository scripts, `src/xmage/` contains the headless player (`wsClient`, `session`, `compactView`, `promptView`), and `src/resources.ts` exposes reference material. The catalogue in `mcp/README.md` documents 38 `mage_*` tools.
- `launcher/` has two layers. The Rust library and binary (`manifest.rs`, `fetch.rs`, `extract.rs`, `layout.rs`) read a components manifest, download and verify archives, and lay out a release directory. The Tauri shell in `src-tauri/` starts the bundled server and proxy, waits for the proxy's card database to report ready and opens the client window.
- `site/` is plain HTML, CSS and JavaScript with no build step. `scripts/gen-dashboard.mjs` turns test artifacts and `site/content.json` into `site/status.json`, which the page renders.

## Generated files

Never hand-edit these; change the input and regenerate.

| File | Producer |
|---|---|
| `web/src/net/types.generated.ts` | `scripts/gen-types.mjs` from the contract schema |
| `web/fixtures/schema.generated.ts` | `scripts/gen-zod.mjs` from the contract schema |
| `web/fixtures/server-view-schema.json` | `scripts/view-schema.mjs` from the engine view classes |
| `web/fixtures/server-state-schema.json` | `scripts/server-state-schema.mjs` from the server config |
| `web/fixtures/hint-schema.json` | `scripts/hint-schema.mjs` from engine hint sources |
| `web/src/data/mtgKeywords.ts` | `scripts/extract-keywords.mjs` from the engine keyword classes |
| `web/src/data/*.generated.json` | Offline card index, printings, token art, bundled decks and showcase art generators |
| `web/public/splash-i18n.js` | `scripts/gen-splash-i18n.mjs` from the locale dictionaries |
| `site/status.json` | `scripts/gen-dashboard.mjs` from test artifacts and site content |

`web/fixtures/engine-view-gap.baseline.json` is different: it is a committed baseline, updated deliberately when a newly tracked engine field is triaged, not regenerated on every build.

## Guards that read the source

These tests fail when the code and the contract disagree. They are the reason a schema change needs more than an edit to one file.

| Guard | Checks |
|---|---|
| `state/callbackCoverage.test.ts` | Every server callback has a handler or is explicitly planned, and the coverage matrix lists it |
| `state/mechanicsCoverage.test.ts` | Every field the server can emit is modelled in the contract |
| `state/hintCoverage.test.ts` | Engine hint sources are represented |
| `state/serverStateCoverage.test.ts` | Game and deck types from the server configuration stay covered |
| `state/engineViewCoverage.test.ts` | Engine state that never reaches a view is tracked against the baseline |
| `ui/styleTokens.test.ts`, `ui/cssIntegrity.test.ts`, `ui/rawButtons.test.ts` | Style tokens, CSS integrity and raw button usage ratchets |
| `lintRatchet.test.ts` | Lint findings do not exceed the committed baseline |
| `system/desktopCsp.test.ts` | Every external host the client uses is allowed by the desktop shell's policy |
| `i18n/i18n.coverage.test.ts` | Translation keys are complete and used |

## Where to add things

| Change | Start in |
|---|---|
| A new client action | `Mage.Proxy` command domain class plus `ProxyClient.requiresGameId` if it is game-scoped; then `web/src/net/commands.ts` |
| A new server event | `web/src/state/eventHandler.ts` and the matching `events/` module; add the method name to `EVENT_METHODS` |
| A new view field | `web/schema/contract.schema.json`, regenerate types and zod, then use it in the client |
| A new prompt type | `web/src/game/feedback/` parser plus a mode component |
| A new setting | `web/src/state/slices/settings.ts`, the settings screen, and the settings reference |
| A new test scenario | `web/fixtures/scenarios/` and, for real coverage, a driver in `scripts/drivers/` |

## Related

- [Architecture](architecture.md)
- [The proxy](proxy.md)
- [The WebSocket protocol](protocol.md)
- [Testing](testing.md)
- [Contributing](contributing.md)
- [Commands reference](../reference/commands.md)
- [Code map (inherited upstream page)](../code-map.md) — older upstream-authored description; this guide is authoritative.
