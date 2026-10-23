# Code map — where things live (counts verified 2026-10-20)


> **LLMage Nexus documentation:** for the current guide see [Code map](developer-guide/code-map.md). This page is inherited from upstream XMage Nexus and may lag behind the client.

Counts are `wc -l` / `find | wc -l` output from the working tree, so re-run them before trusting a number
here (`find web/src -type f | wc -l`, `find Mage.Proxy/src/main -name '*.java' | xargs wc -l | tail -1`,
etc.). The **refactor queue** of the 2026-09-05 version of this file is finished: every file it listed at
1 000+ lines was split then. In the proxy the only hand-written source still above 1 000 lines is
`ProxyClient.java`, and it has grown back from the 739 lines that the split left (1 487 now, with the
relink / sequencer / probe work). In the web client everything over 1 000 lines is generated data or
presentation: the 9 locales (~2 588 each), `data/mtgKeywords.ts` (2 951), the dev-only
`dev/galleryFixtures.ts` (2 186), a data catalog (`decks/metaDeckCatalog.ts`, 1 033), one test
(`state/store.test.ts`, 1 671) and four CSS files (`lobby/LobbyScreen.css` 1 652,
`lobby/SpectatorStagingScreen.css` 1 243, `board/CardSlot.css` 1 209, `game/PlayerInfoBar.css` 1 005).
What is left below is a locator, not a to-do list.

## `web/src` — 1 127 files (549 `.ts` + 398 `.tsx` + 165 `.css` + 15 assets; tests sit next to their source)

| Folder | Files | What lives here |
|---|---|---|
| `game/` | 294 (55 css) | Match flow: `GameScreen` (layout router), `FeedbackDialog` (prompt router) + `feedback/` (`types/detect/record/text/parse`) + `feedbackModes/` (per-mode UI: `AskBar`, `ManaBar`, `TargetBar`, `CombatBar`, `GenericDialog`, …), `PhaseBar`, `StackZone`, `ActionFeed`, `SideboardScreen`, `DraftScreen`/`ConstructScreen`/`DraftHelper`, `PlayerInfoBar` (v1 + v2 portrait), `MobileSpectator`, `rewind.ts`/`RewindBar`, `replayFile.ts`, `smartManaPayment.ts`, `smartStops.ts`, `triggerOrderPlan.ts`, `mulliganEvaluator.ts`, `deckTracker.ts`, `combatLedgerModel.ts`, `llmTranscript.ts`, dialogs (Mulligan, Voting, Planeswalker, LibraryOrder, Rollback, TriggerOrder) |
| `board/` | 196 (35 css) | Battlefield rendering in DOM/CSS: `ArenaBoard`/`GameBoard`/`PodBoard`/`TwoHeadedBoard`, `BoardShell`, `BoardZone` (shared zone layout), `PlayerZone`/`OpponentZone`, `CardSlot` (classic + compact + rendered), `HandBar`, `HandRow`/`HandRail`, `StackZone`/`StackDeck`, `CommandZone`, `PileOverlay`, overlays (`Targeting`, `CombatArrowsOverlay`, `FloatingCardOverlay`), `bandFit.ts`, `combatStrikes.ts`, `gameTransitionEngine.ts`, `commanders.ts`, `designations.ts`, `ptTrend.ts`, `targetZones.ts`, `sceneBridge` (publishes `window.__mageScene` for E2E) |
| `lobby/` | 184 (29 css) | `LoginScreen`, `LobbyScreen`, `CreateTableDialog` + `CreateTable/`, `JoinTableDialog`, staging (`SpectatorStagingScreen`), chat, decks gallery/manager, `TournamentBracket`/`TournamentStandings`, leaderboard, bug-report dialog (`system/report.ts`) |
| `decks/` | 133 (23 css) | `DeckBuilder`, search/list panels, Scryfall integration, import/export, curve chart, `formatRules.ts`, `deckIssues.ts`, `starterDecks.ts`, `metaDeckCatalog.ts`, validation issues |
| `state/` | 59 (`events/` + `slices/`) | `state.ts` (`AppState`), `store.ts` (facade + `__mageStore`), `actions.ts`, `selectors.ts`, `persistence.ts`, `gateway.ts`, `eventHandler.ts` + `events/` (chat/game/prompts/sideboard/draft/tournament/replay/views), `gameUtils.ts`, `engineViewRegistry.ts`, and the coverage guards (see below) |
| `ui/` | 52 (8 css) | `Modal`/`DialogShell`, `Field`, `Input`, selectors, plus the style ratchets |
| `system/` | 26 (1 css) | `AboutModal`, diagnostics export, bug-report assembly (`report.ts`), `desktopCsp.test.ts` |
| `appearance/` | 23 (3 css) | Playmat/sleeve/card-image settings + modals, custom art uploads (`playmats.ts` catalog kept separate from `playmatIdentity.ts`, which is game-aware) |
| `settings/` | 23 (5 css) | Gameplay presets (`gameplayPresets.ts`) and the settings screens |
| `cards/` | 24 (1 css) | `offlineIndex.ts` + `cardImages.ts` (offline Scryfall index → CDN URLs), `cardLocalization.ts`, `scryfallClient.ts` (global budget), custom card images |
| `i18n/` | 19 (1 css) | `types.ts` (TranslationSchema, master), `index.ts`, 9 locales (~2 588 lines each), `LanguageSelector`, `i18n.coverage.test.ts` |
| `audio/` | 19 | `soundManager`, `soundSynthesizer`, `gameSoundDispatcher` |
| `net/` | 18 | `types.ts` (protocol truth: envelopes + `EVENT_METHODS`), `types.generated.ts` (generated, do not hand-edit), `Gateway.ts` (WS + reconnect), `commands.ts` (action wrappers) + tests |
| `data/` | 12 | `mtgKeywords.ts` (2 951, generated via `scripts/extract-keywords.mjs`), the generated Scryfall/token indexes, extractor |
| `demo/` | 9 (1 css) | In-browser demo published on GitHub Pages: `DemoSocket` (stands in for `WebSocket` around `FakeServerCore`), `scenarios.ts`, `DemoTour.tsx`, `boot.ts` |
| `dev/` | 8 (1 css) | `#/gallery` harness + `galleryFixtures.ts` (2 186, dev-only) |
| `setup/` | 8 (1 css) | First-run SetupWizard (its `skip()` persists no connection on purpose — see `AGENTS.md`) |
| `utils/` | 7 | Timer, fullscreen, misc |
| `llm/` | 2 | `bridge.ts` (client-key LLM prompt/decision plumbing) + its test |
| `__fixtures__/` | 1 | Shared test fixture data |
| root | 10 | `App.tsx`, `main.tsx`, `styles.css`, `test-setup.ts`, root-level guards |

## Biggest files today (context, not a queue)

Test files, generated data and CSS dominate: `data/mtgKeywords.ts` (2 951, generated), the 9 locales
(~2 588 each) and `dev/galleryFixtures.ts` (2 186, dev-only). The largest hand-written sources after those
are `state/store.test.ts` (1 671), `decks/metaDeckCatalog.ts` (1 033, data),
`lobby/CreateTable/useCreateTableForm.ts` (980), `state/persistence.ts` (784),
`lobby/SpectatorStagingScreen.tsx` (746), `net/commands.ts` (692), `board/BoardZone.tsx` (662),
`decks/DeckBuilder.tsx` (626). The largest CSS is `lobby/LobbyScreen.css` (1 652),
`lobby/SpectatorStagingScreen.css` (1 243), `board/CardSlot.css` (1 209) and `game/PlayerInfoBar.css` (1 005).

Cross-cutting rules that still hold: `state/slices/*` may only import dependency-free modules (a helper that
reaches `board/*` creates an import cycle and a TDZ crash at store init); fixed-size boxes use
`overflow: clip`, not `hidden`; board effects use `translate`/`scale` so they compose with the tap
`transform`; every decorative animation needs its `html.fx-off` + `prefers-reduced-motion` opt-out.

## Guards that read the code (run in the `unit` layer)

`state/callbackCoverage.test.ts` (every server callback handled or planned — reads
`web/INTERACTION_COVERAGE.md`), `state/mechanicsCoverage.test.ts` + `state/hintCoverage.test.ts` +
`state/serverStateCoverage.test.ts` (contract/schema coverage), `state/engineViewCoverage.test.ts`
(engine→view gap vs `web/fixtures/engine-view-gap.baseline.json`), `ui/styleTokens.test.ts` +
`ui/cssIntegrity.test.ts` + `ui/rawButtons.test.ts` (style ratchets), `lintRatchet.test.ts` (oxlint effect-dep
baseline), `system/desktopCsp.test.ts` (external hosts must be in the Tauri CSP).

## `Mage.Proxy/src/main` — 56 files, 12 804 lines

| Lines | File | Responsibility |
|---|---|---|
| 1 487 | `ProxyClient.java` | `MageClient` bridge: session lifecycle, callback forwarding (`{type:event,method,messageId,objectId,data}`), lobby timer, `connect/attach`, command router, `requiresGameId` |
| 964 | `SimPlayer.java` | Deterministic test bot (land/turn, color-aware first payable cast, all-attack/all-block, keep, pass, keep-alive ping); dev-only behind `--sim on` |
| 690 | `DeckValidation.java` | Advisory pre-validation + official `validateDeckFormat`/`commanderEligibility` passthrough, background card-DB build |
| 607 | `Gateway.java` | WS transport: `byConn`/`byAccount`, origin check, rate limit, pre-auth `connect/ping` only, watchdog line |
| 450 | `Main.java` | Entrypoint: WS + HTTP test page, anti-traversal, `/ready`, `/admin/status`, replay download route |
| 353 | `LlmConfigs.java` | `llmConfigs` → `LLMPlayerConfig` (client-key config, model context window, allowed model hosts) |
| 352 | `GameCommands.java` | Replay/deck/preferences/`sendPlayer*` commands |
| 341 | `ReportSink.java` | `report_issue` payloads under `--reportsDir`: size/count/rate/fingerprint caps, one `[activity] report …` line, nothing forwarded upstream |
| 340 | `JsonUtil.java` | Reflection serializer (camelCase 1:1, skips null/static/transient/logger/Class/Throwable, UUID/Enum→string, Date→epoch) |
| 333 | `GameActivity.java` | Per-game journal: `game_start`/`game_end`, commander damage and hidden-commander probes |
| 303 / 303 | `LlmModelCommands.java` / `Config.java` | `getModels`/personality listing (fork verbs, typed error frames); CLI flags — defaults `beta.xmage.today:17171`, WS 8787 / HTTP 8788 / bind 127.0.0.1 |
| 297 | `MatchOptionsParser.java` | `parseMatchOptions`/`parseTournamentOptions` from JSON |
| 245 | `LlmRelay.java` | Relays browser LLM provider calls: request-header allowlist, 4 MiB request / 16 MiB response caps, 30 s connect + 600 s read timeouts |
| 230 | `StatsService.java` | `nexusstats` poller that feeds the public ranking (refresh 60 s, backoff to 5 min) |
| 220 | `SimManager.java` | SIM seats lifecycle (per-table bots, server endpoint, roster) |
| 215 | `LlmDebugBounds.java` | Bounds the live `llmDebug` transcript a browser receives |
| 201 | `DeploymentConfig.java` | Hosted-deployment gates (auth required, hidden server target, pinned target); all no-ops locally |
| 194 | `DeckJson.java` | Deck JSON → `DeckCardLists` + promo/set normalization + printing resolution at the edge |
| 189 | `Activity.java` | The `[activity]` journal lines |
| 186 | `AnonNameGuard.java` | Anonymous same-name collision guard (server is `ANON_IDENTIFY_BY_HOST`) |
| 180 | `CapabilityGate.java` | Fail-fast gate: LLM wire content or an LLM seat against a server without `capabilities.llm` → typed `CAPABILITY_UNAVAILABLE` before any RPC |
| 179 | `SimRoster.java` | On-disk SIM roster so a proxy restart re-logs the bots that were seated |
| 176 / 175 / 173 | `PublicStats.java` / `P1DeckSupport.java` / `OnlineDeckCommands.java` | Ranking JSON (tiers, divisions); compile-safe seam over the fork-only `P1DeckPool`; online deck fetching |
| 166 / 166 / 165 / 164 | `RestoreIds.java` / `CardCatalog.java` / `LlmPromptBridge.java` / `OutboundLog.java` | Per-account `restoreSessionId` (memory + disk); card-DB lookups (`resolvePrintings`, `cardPrintings`); client-key `LLM_PROMPT` payload bridge; outbound-frame log |
| 163 / 161 / 159 | `AuthorizedConnections.java` / `StatsApi.java` / `CallbackEvents.java` | Connection authorization/LAN rules; `/api/ranking` + `/api/matches` (30 s cache); event plumbing |
| 149 / 148 / 144 | `ReplayFiles.java` / `TournamentCommands.java` / `LlmDecisionSupport.java` | `getReplayFiles` listing (sidecars, non-UUID skip); tournament actions; seam over `llmDecision`/`llmError` |
| 141 / 130 / 128 | `TableCommands.java` / `InfoCommands.java` / `ServerCapabilities.java` | Table actions; info actions; capability probe from `ServerState` |
| 127 / 111 / 110 / 104 / 100 | `ReplayCache.java` / `ReplayFileDownload.java` / `CallbackSequencer.java` / `SessionProbe.java` / `JsonArgs.java` | Prompt/state replay cache; replay byte route (UUID allowlist); `messageId` re-sequencing; pre-relink probe; defensive JSON arg readers |
| 32–99 | `P1DeckCommands`, `LlmBridgeCommands`, `ReplaySeekSupport`, `ReplayTracker`, `TtlCache`, `LobbyPublisher`, `SessionGames`, `ServerMessageMailbox`, `CommandContext`, `ProxyProtocol`, `ErrorClassifier`, `ObjectNameFactory` | Small command domains, caching/plumbing and the `ERR_*` envelope; `ObjectNameFactory` is a shim, not a vendored copy (see `docs/lessons.md`) |

Tests: `Mage.Proxy/src/test` — **59 files**, including `ProxyClientFailedLoginTest` (thread leak),
`GatewayWatchdogTest`, `RestoreIdsTest`, `SessionProbeTest`, `CallbackSequencerTest`, `GameActivityTest`,
`DeckValidationTest`, `CardCatalogTest`, `MainSecurityTest`/`GatewaySecurityTest`, `SimPlayerTest`,
`ReplayCacheTest`, `GatewayCompressionTest`, `CapabilityGateTest`, `ReportSinkTest`.

## `scripts/` — 55 `.mjs` files, ~16 700 lines

| Group | Files | Notes |
|---|---|---|
| Stack control | `lib.mjs` (569), `dev.mjs`, `ctl.mjs`, `tail.mjs`, `install.mjs` | `.run/*.pid` + `.run/*.log`, `PORTS`, `javaBin()`, `forkDir()`, ulimit warning |
| Test orchestration | `test.mjs` (393) | 12 layers: unit, coverage, typecheck, build, java, self-test, human-test, verify, verify-restart, fuzz, e2e, i18n |
| Real-stack harnesses | `self-test.mjs`, `human-test.mjs`, `fuzz.mjs`, `warmup.mjs`, `clean-tables.mjs`, `multi-tenant-test.mjs` | Need the stack; `warmup.mjs` exists because of the cold-start callback-socket flake |
| Anti-drift `verify` layer | `verify-player-leave`, `multi-tenant-test`, `verify-wizard-matrix`, `verify-hand-permission`, `verify-spectator-end`, `verify-range-attack`, `verify-rollback-vote`, `verify-swiss`, `verify-tournament-watch`, `verify-report` | Exactly the `VERIFY_SCRIPTS` list (`verify-player-leave` first by design); each logs out before closing its socket. `verify-reconnect` is the separate `verify-restart` layer |
| Fixture recording | `record.mjs` (3 866), `rec-lib.mjs`, `record-sync.mjs`, `drivers/*.mjs` | Real frames → `web/fixtures/recorded/` (125 in `manifest.json`); one driver per mechanic |
| Contract generators | `view-schema.mjs`, `engine-view-schema.mjs`, `server-state-schema.mjs`, `hint-schema.mjs`, `gen-types.mjs`, `gen-zod.mjs`, `gen-splash-i18n.mjs`, `gen-keywords-i18n.mjs`, `gen-showcase-art.mjs`, `extract-keywords.mjs` | Four of them (`gen-types.mjs`, `gen-zod.mjs`, `server-state-schema.mjs`, `gen-splash-i18n.mjs`) have a `--validate` mode, run by hand via `gen-*:validate` npm scripts (no CI ships with this repository); `*_schema.json` outputs live in `web/fixtures/` |
| Release/site | `gen-dashboard.mjs`, `dashboard-ci.mjs`, `integration-report.mjs`, `gen-latest.mjs`, `gen-manifest.mjs`, `gen-release-body.mjs`, `assemble-modules.mjs` | Feed `site/` and the release workflow |
| Deploy/host | `deploy-bundle.mjs`, `deploy/*` (`host-xdhs.sh`, …), `check-upstream-release.mjs` | The public host + the 6-hourly upstream release probe |
| MCP tooling | `playwright-mcp.mjs` | Wraps `@playwright/mcp` for browser interaction |

## `mcp/` and `site/`

- `mcp/src` + `mcp/test`: 27 files. `src/index.ts` (entry), `src/tools/` (DevOps tools), `src/xmage/`
  (`wsClient`, `session`, `compactView`, `promptView` — the headless player), `src/resources.ts`.
  38 `mage_*` tools (38 `registerTool` calls), catalogued in `mcp/README.md`.
- `site/`: zero-build static dashboard (`index.html`, `app.js`, `styles.css`, `assets/`) rendering
  `site/status.json` (generated at deploy) from `site/content.json` (canonical copy) + test artifacts.
