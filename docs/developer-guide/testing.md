# Testing

The test suite is organised as layers: fast checks that need nothing running, and stack layers that drive a real XMage server through the proxy. One orchestrator runs them in order and reports pass or fail per layer. This page explains what each layer proves, how to run a subset, and how to read a failure without mistaking the environment for a bug.

> **Who this is for:** Developers running, adding, or debugging tests.

## Quick start

```bash
node scripts/test.mjs                  # every layer, in order
node scripts/test.mjs unit typecheck   # the everyday loop
node scripts/test.mjs --skip=e2e,fuzz  # everything except two layers
node scripts/test.mjs --help           # layer list and options
```

The stack layers fail with a message when the server or the proxy is not running. Start them with `node scripts/ctl.mjs start all`, and restart them with `node scripts/ctl.mjs restart all` if the suite has been running for a while.

## Layers

| Layer | Tool | Needs stack | What it proves |
|---|---|---|---|
| `unit` | Vitest | No | Component and logic behaviour; the coverage guards also run here |
| `coverage` | Vitest with V8 coverage | No | The same suite against the coverage thresholds |
| `typecheck` | `tsc -b --noEmit` | No | Types across the client, fixtures, and tests |
| `build` | `tsc -b` and `vite build` | No | The production bundle compiles |
| `java` | Maven and JUnit on `Mage.Proxy` | No | Proxy unit tests; needs the XMage artifacts in the local Maven repository |
| `self-test` | Headless WebSocket bot | Yes | Complete matches against the server's AI |
| `human-test` | WebSocket driver | Yes | Human-shaped flows: mulligans, priority, combat, sideboarding |
| `verify` | Ten anti-drift scripts | Yes | Specific protocol and multi-user behaviours end to end |
| `verify-restart` | Reconnect check | Yes | A proxy restart and the client's recovery; runs alone |
| `fuzz` | Self-play soak | Yes | Twenty full games by default, without a stuck match |
| `e2e` | Playwright | Vite only in fake mode | The browser client against fake or real backends |
| `i18n` | Coverage guard | No | Locale parity and untranslated-copy thresholds |

The `verify` layer runs ten scripts in a fixed order. `verify-player-leave` runs first because it needs a fresh view inside a narrow window; running it after another script that opened a session makes it fail for reasons unrelated to the code. `verify-restart` restarts the proxy, so it is kept out of the other layers. `fuzz` is a soak layer: run it before a release, not on every change.

## Stack readiness

The stack layers wait for the proxy's `/ready` endpoint rather than its port alone. A proxy that answers on its WebSocket port while it is still building the card database rejects every script with a "still loading card data" message, which looks like a test failure. The orchestrator also warns when the stack has been up for an hour or has accumulated twenty sessions: orphaned sessions and finished matches clog the server's callback channel, and the symptom is a game that never receives a view. Restart before debugging.

Before `self-test` and `human-test`, the orchestrator plays one disposable warm-up match. The first game after a cold server start can lose its callback socket; the warm-up absorbs that instead of failing the suite.

## Two backends, one set of specs

Browser tests run against two backends with the same spec files.

**Fake (default).** `npm --prefix web run test:e2e` starts a `FixtureServer` on a free port for each test, with a declarative scenario. Vite runs on a dedicated port with `strictPort`, four workers at most, and no retries. The proxy and the XMage server are not involved. This is the daily loop: deterministic, parallel, and fast.

**Real.** `E2E_BACKEND=real npm --prefix web run test:e2e:real` runs the same specs against the live stack, one worker, serial. It is the anti-drift net: the fake server is written from the same types as the client, so only the real server can reveal that both drifted from the actual protocol. A failure that appears only in real mode is a timing or protocol problem; do not weaken the spec to make it pass.

Specs are grouped by domain tags:

| Tag | Script | Area |
|---|---|---|
| `@spells` | `test:e2e:spells` | Casting, X spells, modes, counters |
| `@targeting` | `test:e2e:targeting` | Target selection and the targeting overlay |
| `@combat` | `test:e2e:combat` | Attackers, blockers, combat damage |
| `@fullflow` | `test:e2e:fullflow` | Login, lobby, and a complete match |
| `@board` | `test:e2e:board` | Board layout, zones, overlays |
| `@site` | `test:e2e:site` | The download and static site pages |

Secondary markers (`@reveal`, `@draft`, `@keywords`, `@voting`, `@planeswalker`, `@chat`, `@decks`, `@latency`) narrow a run inside those files. `npm --prefix web run test:e2e` with `--grep` works for any marker.

Assertions read the live scene through `window.__mageScene` plus the DOM. The board is DOM and CSS, so there is nothing to pixel-diff, and the browser locale is pinned in the Playwright config so label-based selectors stay stable. Shared helpers live in `web/e2e/support/`: frame waiting and game accessors, a start-game routine, page objects for dialogs and actions, the scene reader, and `HumanHelper`, a WebSocket driver used for fragile operations while the UI only verifies the result.

A failure writes screenshots, a trace, the WebSocket frames, page errors, and a prompt dump to `web/test-results/`. `npx playwright show-report` opens the HTML report.

## The fake server and fixtures

`web/fixtures/fake.ts` implements the proxy contract over Node's `ws`. It answers actions with result envelopes and emits callbacks from a scenario, using the same types as the client. `web/fixtures/fakeCore.ts` holds the transport-free core, shared with the in-browser demo, which is why fixtures imported by `src/` must not use Node APIs.

Scenarios live in `web/fixtures/scenarios/`. Each one describes a match: hands, lands, the prompts the server will send, and the effects of the answers. A mini-engine (`humanGame.ts`) drives human-versus-AI games; other scenarios model drafts, tournaments, chat, deck issues, and specific mechanics.

## Recorded frames

A recorded frame is a real server frame captured once and replayed forever. `node scripts/record.mjs <mechanic>` (or `all`) plays a scripted game against the local server and writes the first `GAME_UPDATE` matching the driver's capture condition to `web/fixtures/recorded/`, together with an entry in `manifest.json`.

Two checks consume the result. `web/fixtures/recorded.test.ts` validates every frame against the contract schema. `web/e2e/recorded.spec.ts` replays it in the fake server and asserts the rendering. Regenerate the frames after changing the proxy or the contract, and commit them with the change; a frame that no longer validates is the earliest signal that the wire format moved.

## Guards that read the code

Several unit tests are guards rather than behaviour tests. They read source files, the contract, or generated artifacts and fail when something is unmodelled.

| Guard | Checks |
|---|---|
| `state/callbackCoverage.test.ts` | Every server callback is handled or explicitly planned in the interaction coverage table |
| `state/mechanicsCoverage.test.ts` | Every field the server can emit is modelled in the contract |
| `state/hintCoverage.test.ts` | Prompt hints and their schema stay in step |
| `state/serverStateCoverage.test.ts` | The server-state schema matches what the client reads |
| `state/engineViewCoverage.test.ts` | The engine-to-view gap does not grow past its baseline |
| `ui/styleTokens.test.ts`, `ui/cssIntegrity.test.ts`, `ui/rawButtons.test.ts` | Style tokens, CSS integrity, and shared button usage |
| `lintRatchet.test.ts` | Lint warnings never increase per file and rule |
| `system/desktopCsp.test.ts` | Every external host the client uses is allowed by the desktop shell's policy |

The coverage gate is scoped to the directories that hold protocol and behaviour: `net`, `state`, `board`, `decks`, `lobby`, and `game`. Thresholds are 75% lines, 68% functions, 64% branches, and 72% statements. They sit a few points under the measured values so a real regression fails instead of hiding in a wide margin.

`npm --prefix web run lint` runs oxlint and fails on the rules of hooks, the correctness set, and `any` in shipped code. Missing effect dependencies are warnings, ratcheted per file; after fixing some, lower the baseline with `UPDATE_LINT_BASELINE=1 npx vitest run src/lintRatchet.test.ts`.

## Reading a failure

| Symptom | Likely cause | Action |
|---|---|---|
| A stack layer fails immediately with a connection message | Server or proxy not running | Start the stack, wait for `/ready` |
| Every script fails with a card-data message | Proxy still loading its database | Wait, then rerun |
| Games never receive a view after a long run | Stale stack with orphan sessions | `node scripts/ctl.mjs restart all` |
| `self-test` fails only on the first game after a cold start | Server lost the callback socket | Rerun warm; a repeated failure is a bug |
| Login fails in a generated test | User name longer than the server limit | Keep generated names at 14 characters or fewer |
| Only the real E2E run fails | Protocol drift or timing | Compare frames; do not relax the assertion |
| Real matches stop starting | Game threads exhausted by abandoned matches | Restart the server and clean the tables |

The suite has no exclusion list. A fake test that fails consistently is a defect to investigate, not a known-broken entry to skip. Parallel browser runs can fail on hover or click timing under load; rerun that spec alone before treating it as a product bug.

## The MCP server's tests

The MCP server has its own suite, outside `scripts/test.mjs`:

```bash
npm --prefix mcp test          # serial; each file starts a server over stdio
npm --prefix mcp run typecheck
```

The tests run against the fake server for the scripted and hermetic cases. `MCP_E2E=1 npm --prefix mcp test` adds a full game against a real local stack. Run the serial command: parallel files each start their own stdio server and the timeouts flake.

## Before you call it done

| You changed | Run |
|---|---|
| `web/` | `unit`, `typecheck`, and `build` if the bundle changed |
| Proxy Java | `java`, then rebuild the jar and restart the proxy |
| `mcp/` | `npm --prefix mcp test` and `npm --prefix mcp run typecheck` |
| The contract schema | Regenerate types and validators, then the `unit` layer and the recorded frames |
| A gameplay mechanic | Fake E2E for the flow and a regenerated recorded frame |

Before declaring a task finished, run the full suite with the stack up. The repository has no hosted CI, so that local run is the whole gate.

## Related

- [Web client](web-client.md)
- [MCP server](mcp.md)
- [Contributing](contributing.md)
- [Commands](../reference/commands.md)
- [Ports](../reference/ports.md)
- [Troubleshooting](../reference/troubleshooting.md)
- [Testing (inherited upstream page)](../testing.md) — older upstream-authored description; this guide is authoritative.
