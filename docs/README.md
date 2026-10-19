# XMage Nexus documentation

XMage Nexus is a modern web and desktop client for [XMage](https://github.com/magefree/mage).
It connects to any XMage server through a WebSocket proxy, runs in a browser or as a packaged
desktop app, and adds a visual board, a deck builder, replays, and optional LLM-seat controls
when the server supports them.

> **New here?** Read the [overview](getting-started/overview.md), then
> [Play in a browser](getting-started/play-in-browser.md) or
> [Self-hosting quickstart](getting-started/self-hosting-quickstart.md).

## Getting started

| Page | What it covers |
|---|---|
| [XMage Nexus overview](getting-started/overview.md) | What the client is, how the three tiers fit together, and what it adds |
| [Play in a browser](getting-started/play-in-browser.md) | A hosted or self-hosted URL, the login screen, and the first table |
| [Desktop app](getting-started/desktop-app.md) | Installing the launcher, bundled components, updates, and data location |
| [Self-hosting quickstart](getting-started/self-hosting-quickstart.md) | The shortest path to a working stack |

## Player guide

| Page | What it covers |
|---|---|
| [The lobby](player-guide/lobby.md) | Tables, filters, users, chat, finished matches, and the leaderboard |
| [Creating a game](player-guide/creating-a-game.md) | The create-table wizard, formats, seats, timers, and passwords |
| [Joining a game](player-guide/joining-a-game.md) | Deck selection, validation, the waiting room, and spectating |
| [Chat and social features](player-guide/chat-and-social.md) | Table chat, game log, floating chat, and invite links |
| [Deck builder](player-guide/deck-builder.md) | Search syntax, filters, import/export, sideboard, and validation |
| [Settings](player-guide/settings.md) | Gameplay, board, interface, sound, language, and accessibility |
| [Card images and art](player-guide/card-images-and-art.md) | Scryfall images, printings, showcase art, tokens, and custom art |
| [Board and controls](player-guide/board-and-controls.md) | Zones, priority, mana, targeting, combat, prompts, and shortcuts |
| [Game modes and formats](player-guide/game-modes.md) | Constructed, Commander, 2HG, draft, sealed, tournaments, and FFA |
| [Replay viewer](player-guide/replay-viewer.md) | Opening a replay, playback, seeking, and the LLM sidecar |

## Operator guide

| Page | What it covers |
|---|---|
| [Deploying XMage Nexus](operator-guide/deployment.md) | Docker, static web, the proxy, TLS, tunnels, and scaling |
| [Configuration](operator-guide/configuration.md) | Proxy flags, environment variables, ports, and build-time options |
| [Desktop launcher](operator-guide/desktop-launcher.md) | Packaging, bundled components, manifests, and updates |
| [Operations](operator-guide/operations.md) | Logs, health endpoints, the status dashboard, backups, and upgrades |

## Developer guide

| Page | What it covers |
|---|---|
| [Architecture](developer-guide/architecture.md) | The three tiers, data flow, rendering, fake mode, and i18n |
| [Code map](developer-guide/code-map.md) | Where each part of the repository lives |
| [The proxy](developer-guide/proxy.md) | Sessions, multi-tenancy, callbacks, serialization, and the watchdog |
| [The WebSocket protocol](developer-guide/protocol.md) | Connection, messages, actions, events, types, and versioning |
| [Web client](developer-guide/web-client.md) | React structure, state, board rendering, and test hooks |
| [Testing](developer-guide/testing.md) | Test layers, fake and real backends, fixtures, and the recorder |
| [MCP server](developer-guide/mcp.md) | The `mage_*` automation tools and the gameplay loop |
| [Contributing](developer-guide/contributing.md) | Workflow, adding events and types, style, and tests |
| [Lessons learned](lessons.md) | Durable engineering lessons behind specific fixes |

## Reference

| Page | What it covers |
|---|---|
| [Keyboard shortcuts](reference/keyboard-shortcuts.md) | Global, game, chat, deck builder, and replay shortcuts |
| [Settings reference](reference/settings-reference.md) | Every setting, its default, and where it is stored |
| [Commands](reference/commands.md) | Development, build, test, and deployment commands |
| [Ports](reference/ports.md) | Default ports, what uses them, and conflict fixes |
| [Troubleshooting](reference/troubleshooting.md) | Symptom, cause, and fix for common failures |
| [Frequently asked questions](reference/faq.md) | Cost, accounts, self-hosting, devices, privacy, and contributing |
| [Glossary](reference/glossary.md) | Terms used across the docs |

## Conventions

- Commands and configuration examples use placeholders such as `<server-host>`, `<proxy-host>`,
  `<port>`, and `<path-to-project>`. Replace them with your own values.
- LLM seats, replay-scrubber support, and related controls appear only when the connected
  XMage server advertises the capability. The client is usable against a stock XMage server.
- Screenshots use generic player, table, and deck names. They are illustrative, not a record of
  a particular deployment.

## Legacy documentation

The pages below predate this wiki and are retained as reference for upstream behaviour. They
may contain dated or environment-specific material; use the pages above instead.

| Legacy page | Superseded by |
|---|---|
| [`user-manual.md`](user-manual.md) | [Player guide](player-guide/lobby.md) |
| [`architecture.md`](architecture.md) | [Architecture](developer-guide/architecture.md) |
| [`code-map.md`](code-map.md) | [Code map](developer-guide/code-map.md) |
| [`deployment.md`](deployment.md) | [Deploying XMage Nexus](operator-guide/deployment.md) |
| [`deploy-tunnels.md`](deploy-tunnels.md) | [Deploying XMage Nexus](operator-guide/deployment.md) |
| [`testing.md`](testing.md) | [Testing](developer-guide/testing.md) |
| [`protocol.md`](protocol.md) | [The WebSocket protocol](developer-guide/protocol.md) |
| [`enhancements.md`](enhancements.md) | [Game modes and formats](player-guide/game-modes.md) |
| [`history/`](history/) and [`plans/`](plans/) | Historical design notes, not normative |

