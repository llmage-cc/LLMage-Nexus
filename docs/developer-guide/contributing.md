# Contributing

This page covers the workflow for changing XMage Nexus: how to set up a working copy, which checks each kind of change needs, the recipes for the four common extension points, and the rules a pull request is expected to satisfy. It also describes how the documentation is organised, so a change lands in the right page.

> **Who this is for:** Developers preparing a change to the client, the proxy, or the MCP server.

## Set up a working copy

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20 or newer; 24 or newer for the MCP server | The web client and its tests; the MCP server runs TypeScript directly |
| npm | 10 or newer | Installing and running the client scripts |
| JDK | 17 | The XMage server and the proxy |
| Maven | 3.9 or newer | Building the proxy and the full stack |

The web client is isolated. You can work on the interface, the board, the lobby, and their tests without Java, Maven, or a server.

**Web only.**

```bash
npm --prefix web install
npm --prefix web run dev
```

The dev server listens on `http://localhost:5173`. Tests are the Vitest suite next to the source, and browser tests use the fake backend.

**Full stack.**

```bash
node scripts/install.mjs
node scripts/ctl.mjs start all
```

The installer builds the engine into the local Maven repository, copies the plugins the server needs, and installs the web dependencies. `ctl.mjs` then launches the XMage server, the proxy, and Vite in the background and returns at once; `node scripts/ctl.mjs status` shows what is up. The first server start takes minutes while it scans the card database.

## Everyday commands

| Command | Purpose |
|---|---|
| `node scripts/ctl.mjs start\|stop\|restart\|status [server\|proxy\|vite\|all]` | Control the stack |
| `node scripts/tail.mjs [server\|proxy\|vite\|all] [lines]` | Follow the component logs |
| `node scripts/test.mjs [layer...]` | Run test layers |
| `node scripts/build.mjs [proxy]` | Build the server, plugins, and proxy; with `proxy`, repackage only the proxy |

Client scripts run through `npm --prefix web run <script>`: `dev`, `test`, `test:coverage`, `typecheck`, `lint`, `build`, `test:e2e`, and `build:demo`. The MCP server has its own `npm --prefix mcp` scripts.

## What to run for a change

| Changed | Required before review |
|---|---|
| Anything under `web/` | `unit` and `typecheck`; add `build` when the bundle or build configuration changed |
| Proxy Java | `java`, then `node scripts/build.mjs proxy` and a proxy restart |
| `mcp/` | `npm --prefix mcp test` and `npm --prefix mcp run typecheck` |
| The contract schema | Regenerate types and validators, then `unit` |
| A gameplay mechanic | Fake browser E2E for the flow, plus a regenerated recorded frame |
| Documentation only | Nothing beyond a spelling and link check |

Run the full suite with the stack up before you declare the work finished. The repository has no hosted CI, so the local run is the entire gate; paste its result into the pull request.

## Recipes

### Add a game event handler

Server callbacks include prompts such as `GAME_ASK`, `GAME_TARGET`, `GAME_TARGET_PLAYER`, `GAME_CHOOSE_MODE`, and `GAME_SELECT`, plus state events such as `GAME_UPDATE`, `START_GAME`, and `GAME_OVER`. The full list is `EVENT_METHODS` in `web/src/net/types.ts`.

1. Decide whether the callback asks the player for input or only updates state.
2. **Interaction:** parse it in `web/src/game/feedback/parse.ts` and add a component under `web/src/game/feedbackModes/` (or a dialog), routed by `web/src/game/FeedbackDialog.tsx`.
3. **State:** add a branch to `web/src/state/eventHandler.ts`, keeping the existing `case` order, and put the body in the matching module under `web/src/state/events/`.
4. Add or refresh the callback's row in the interaction coverage table. The coverage guard in the `unit` layer fails when a handled callback has no row.

### Add a Java view type

When the server starts sending a new view class:

1. Model it in `web/schema/contract.schema.json`. That file is the source of truth for the wire format.
2. Regenerate the derived artifacts and validate them:

```bash
cd web
npm run gen-types && npm run gen-zod && npm run gen-server-state
npm run gen-types:validate && npm run gen-zod:validate && npm run gen-server-state:validate
```

Do not hand-edit `web/src/net/types.generated.ts` or `web/fixtures/schema.generated.ts`. The mechanics coverage guard checks that every field the server can emit is modelled in the contract, so a missing field fails the `unit` layer rather than appearing as an empty value in the interface.

### Add a proxy action

1. Route the action in the proxy's command chain and implement it in the matching command class: info, table, tournament, or game. Parse arguments defensively and answer with the standard result envelope.
2. Add the TypeScript wrapper in `web/src/net/commands.ts` and call it from the client.
3. Rebuild and restart the proxy:

```bash
node scripts/build.mjs proxy
node scripts/ctl.mjs restart proxy
```

Restart the server and the proxy together when either one changed. Restarting only the proxy leaves the first login waiting on an orphaned session.

### Record a mechanic

New mechanics ship with a real-protocol frame so the browser suite can replay them without a public server:

1. Register a driver in `scripts/record.mjs`: a deck, a selection script, and the condition that marks the frame to capture.
2. Run it against the local server. It writes the frame to `web/fixtures/recorded/` and adds an entry to the manifest.
3. The unit suite validates the frame against the contract, and the browser suite replays it in the fake server and asserts the rendering.

Regenerate the frames after changing the proxy or the contract, and commit them with the change.

## Coding style

- **TypeScript runs strict.** The client enables `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`; a build fails on any of them, so an unused import is a compile error rather than a warning.
- **Lint separates errors from warnings.** oxlint fails on the rules of hooks, the correctness set, and `any` in shipped code. Missing effect dependencies are warnings, recorded per file and rule, and the baseline only moves down.
- **Keep pure logic out of components.** Parsers, view diffing, selectors, and layout maths live in plain modules with their own tests; components wire them to the DOM. That is why most of `src/game` and `src/board` can be tested without rendering.
- **Styles stay in CSS files next to the component** and use the shared tokens. Board effects use `translate` and `scale` so they compose with the tap transform instead of replacing it, and every decorative animation has a reduced-motion opt-out.

## Rules

- **English only.** Commit messages, pull requests, documentation, code identifiers, test names, fixtures, and log strings are written in English. The translation locales, the MCP server's existing Spanish strings, and quoted server output are the exceptions.
- **Generated files are read-only.** Regenerate them and fix the code that consumes them.
- **Every user-facing string goes into all nine locales.** The `i18n` layer checks parity and untranslated copy.
- **No comments in code** unless the change explicitly calls for one.
- **Do not commit build or runtime output.** Distribution directories, logs, dependency trees, and compiled artifacts stay out of the repository.
- **Do not weaken a test to make it pass.** A fake test that fails consistently is a defect; the suite has no exclusion list.
- **Do not commit unless the task asks for a commit.**

## The documentation model

The documentation has four audience layers plus a reference section. A page belongs to exactly one layer and states its audience in the opening callout.

| Section | Audience | Contains |
|---|---|---|
| Getting started | A new user who has never run XMage | What the project is, browser play, the desktop app, a self-host quick start |
| Player guide | Someone playing a game | Lobby, tables, deck builder, settings, board controls, modes, replay |
| Operator guide | Someone self-hosting or administering a server | Deployment, configuration, launcher, operations |
| Developer guide | Someone building, extending, or debugging | Architecture, code map, proxy, protocol, web client, testing, MCP |
| Reference | Anyone looking up a fact | Shortcuts, settings, commands, ports, troubleshooting, FAQ, glossary |

Rules for edits:

- **One topic per page.** When a page passes roughly 2,200 words, split it and link the parts.
- **Do not mix audiences.** A player page describes what the player sees; build commands belong on the developer page it links to.
- **Keep single sources.** The shortcut table, the settings reference, the command table, and the port table each have one canonical page. Other pages link to them instead of repeating the rows.
- **Update only the affected page.** Do not mass-rewrite unrelated documentation in the same change.
- **Write the narrative in the commit message.** There is no work log; the reasoning belongs with the change, and the pages describe the software as it is.
- **Scoped guides live next to the code.** `web/AGENTS.md` and `Mage.Proxy/AGENTS.md` hold rules that only apply inside those directories.

## Commits and pull requests

Commit subjects use a conventional prefix with a scope:

| Prefix | Use |
|---|---|
| `feat(web):`, `feat(proxy):` | A new capability |
| `fix(web):`, `fix(proxy):` | A defect fix |
| `refactor(...)` | A change with no behaviour difference |
| `test(...)` | Test-only changes |
| `docs` | Documentation only |
| `chore(...)` | Build, tooling, or dependency work |

Open the pull request against the master branch and fill the template. Its checklist mirrors the rules above: which layers ran, whether the build changed, whether generated files were regenerated rather than edited, whether new strings reached all locales, whether the affected documentation and coverage tables were updated, and whether any build output slipped into the diff.

A reviewer will look for the same things. Describe what changed and why in one paragraph, then paste the verification output. A pull request that says which layers passed is easier to review than one that says the change works.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Runtime errors about missing fields | The TypeScript contract is stale | Regenerate types and validators, then rerun the guards |
| An event never reaches the client | The proxy drops events for games the session never joined, and old events after a reconnect | Check the proxy log and the join path |
| Browser tests fail only against the real stack | Protocol drift or timing, not the scenario logic | Compare the frames; keep the assertion |
| The first match after a cold start fails | The server lost its callback socket | Rerun warm; a repeated failure is a real defect |
| A login hangs after a proxy-only restart | The server still holds the old session | Restart both together |
| The interface shows an English string in another language | The key is missing from that locale | Add it to all nine files |

## Related

- [Testing](testing.md)
- [Web client](web-client.md)
- [MCP server](mcp.md)
- [Architecture](architecture.md)
- [Code map](code-map.md)
- [Protocol](protocol.md)
