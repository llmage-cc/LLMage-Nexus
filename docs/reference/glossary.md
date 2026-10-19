# Glossary

The terms this wiki uses for the client, the proxy, the XMage server, and the development tooling. Entries are short on purpose: each one tells you what the thing is and where to read more. Rules of the game itself are not defined here; they belong to XMage and to Magic.

> **Who this is for:** any reader of this wiki who meets an unfamiliar term, from a new player to a contributor reading the protocol pages.

## Platform and tiers

| Term | Meaning |
|---|---|
| **XMage Nexus** | The web and desktop client this wiki documents: a React interface, a Java WebSocket proxy, and the XMage rules engine behind them. |
| **XMage** | The open-source rules engine and card database that resolves every game. Nexus does not reimplement the rules. |
| **XMage server** | A running `Mage.Server` process. It owns accounts, tables, games, and the card database, and speaks the XMage protocol. |
| **Proxy** | The `Mage.Proxy` process. It accepts browser WebSocket connections, translates JSON into XMage calls, and forwards server events back. |
| **Web client** | The React application in the browser. It talks only to the proxy. |
| **Launcher** | The desktop application. It downloads and starts a bundled Java runtime, XMage server, and proxy, then opens the web client in a native window. |
| **Hosted instance** | A web page and proxy run by someone else, which players reach with a URL. |
| **Self-hosted** | A stack you run yourself: at minimum one proxy serving the web build, optionally with your own XMage server. |

## Connection and sessions

| Term | Meaning |
|---|---|
| **Session** | One account's live connection to the XMage server, held by the proxy. A session survives a browser reload for a grace period. |
| **Attach** | A second WebSocket for the same account and target joining the existing session instead of opening a new one. Two tabs through one proxy attach; two different proxies cannot. |
| **Multi-tenant** | One proxy process serving many independent accounts, each with its own session. |
| **Grace period** | How long a session stays alive after its last socket closes: 180 seconds by default. A reconnecting browser re-attaches inside it. |
| **Leave grace** | The shorter wait, 45 seconds by default, used when the page announced it was closing. A reload returns well inside it. |
| **Restore id** | The server's identifier for an account's last live session, remembered by the proxy so a re-login after a restart or an address change resumes the old session. |
| **Resumed stream** | The proxy's per-session frame log. A reconnecting client presents the last `streamId` and `seq` it processed and receives the frames it missed. |
| **Auth token** | An optional secret a deployment requires on every `connect`. A missing or wrong token is refused with close code `4401`. |
| **Deployment config** | The `GET /config` document a proxy serves: whether a token is required, whether the target is pinned, the deployment name, and whether the LLM relay is on. |
| **Pinned target** | A deployment setting that forces every connection to one XMage `host:port` and hides the target fields in the login form. |
| **Heartbeat** | The client's liveness probe: a `ping` after 15 seconds of silence, and a dropped socket if nothing arrives within 10 seconds. |
| **Relink** | The proxy logging a session back in to the XMage server after the server link drops, for up to ten minutes by default. |
| **Capability gate** | A server-advertised feature check. A request that needs an absent capability is refused with `CAPABILITY_UNAVAILABLE` before any server call. |
| **Readiness** | The proxy's `/ready` endpoint, which answers `503` until the card database is loaded. Gate traffic and scripts on it, not on the port. |
| **Health** | The proxy's `/health` endpoint, which answers `200` while the process runs, whatever the card database is doing. |
| **Watchdog** | The proxy's once-a-minute status line with thread count, live clients, connections, accounts, and card-database state. |
| **Admin status** | The optional `/admin/status` JSON endpoint, enabled by an admin token, listing sessions, users, and recent events. |
| **Origin allowlist** | The exact browser origins a proxy accepts, set with `--allowedOrigins`. Empty means localhost origins only. |

## Playing

| Term | Meaning |
|---|---|
| **Lobby** | The screen after login: live tables, online users, room chat, filters, leaderboard, and deck management. |
| **Room** | A server-side namespace that holds tables and chat. The default room is what the lobby shows. |
| **Table** | A match invitation with a format, seats, and options. A table becomes a game when its owner starts it. |
| **Seat** | One place at a table, occupied by a human, a server AI, or, in development and test runs only, a scripted bot. |
| **Host** | The player who created a table. Only the host can start or delete it. |
| **Staging** | The waiting room between joining and starting, where seats fill and players chat. |
| **Spectator** | A player watching a live game without a seat. |
| **Priority** | The right to act at the current moment. The action button shows when priority is yours. |
| **Pass** | Giving priority away. Auto-pass settings do it for defined situations. |
| **Stack** | The zone where cast spells and activated abilities wait to resolve; the last one put there resolves first. |
| **Mulligan** | The opening-hand redraw. Nexus uses the London mulligan: draw seven again, then put N cards on the bottom. |
| **Sideboard** | The cards outside the main deck, swapped in between games of a best-of-three or best-of-five match. |
| **Command zone** | Where a commander waits and returns when it leaves the battlefield. |
| **Commander tax** | The extra generic mana a commander costs for each earlier cast from the command zone. |
| **Free-for-all (FFA)** | A multiplayer table with three to ten seats and one winner. |
| **Pod** | The four-seat layout used for Commander and small multiplayer games. |
| **Two-Headed Giant** | A team format with two players per side sharing a life total. |
| **Draft / Sealed** | Limited formats: draft by picking from packs, or sealed by building from unopened packs. Both end in a 40-card deck. |
| **Swiss / bracket** | Tournament pairings: Swiss rounds by record, or a single-elimination bracket. |
| **Replay** | A saved game played back through the viewer. Availability depends on whether the server persists games. |
| **Scrubber** | The replay seek control. It needs a server that supports seeking; otherwise the viewer only steps forward and back. |
| **State index** | A zero-based position in a replay's state track, used by the scrubber. |
| **Sidecar** | The `<uuid>.json` file next to a saved `<uuid>.game`, holding metadata such as winner, turns, and players. A missing or unreadable sidecar never hides the replay. |

## Decks and cards

| Term | Meaning |
|---|---|
| **Deck type** | The server-side name of a deck category, such as `Constructed - Modern`. It must match a name the connected server configures. |
| **Format** | The rules set a table plays: Standard, Modern, Commander, draft, and so on. |
| **Printing** | A specific appearance of a card, identified by set code and collector number. The server matches on this pair, not on the card name. |
| **`validateDeck`** | The proxy's pre-flight check of a deck against its own card database. Its report is advisory: `ready: false` never blocks, and the client lets you apply or dismiss the findings. |
| **`validateDeckFormat`** | XMage's official format validator, run by the proxy: deck size, bans, copy limits, commander legality, color identity. |
| **Outdated printing** | A deck entry whose card name exists but whose set and number do not. The fix is another printing. |
| **Unimplemented** | A card with no printing in the running XMage release. It cannot be played on that server. |
| **Mismatch** | A deck entry the server accepts but loads as a different card, because the set and number belong to another card. |
| **Fixed deck** | The deck the validator returns with rejected entries removed. |
| **Quit ratio** | The maximum share of games a player may have quit and still join a table, set as **Allowed quit %**. The default is 100, which imposes no limit. |
| **Partner** | A commander ability that allows a second commander, as with Partner, Partner with, or Choose a Background. The deck carries both in its commander list. |

## LLM play

| Term | Meaning |
|---|---|
| **LLM seat** | A seat played by a language model through the server's LLM player plugin (`COMPUTER_LLM`). Only servers that advertise the capability offer it. |
| **Provider endpoint** | The chat-completions URL an LLM seat calls. Without one, the seat uses the deployment default. |
| **Client key** | An API key supplied by the player for one seat. It stays in the browser and is sent to the model provider, not to the XMage server. |
| **LLM relay** | An optional proxy route that forwards model calls for deployments that cannot call the provider directly. It is off by default. |

## Development and testing

| Term | Meaning |
|---|---|
| **Fake server** | A Node WebSocket server that speaks the real protocol from fixtures, with no Java and no proxy. It backs the default E2E mode. |
| **Fixture** | A protocol frame or deck stored as test data. Recorded fixtures are captured from a real server and replayed in tests. |
| **Scenario** | A declarative script that drives the fake server through a game or a lobby flow. |
| **Recorder** | The script that drives a real local game and captures a matching server frame into a fixture. |
| **Contract schema** | The JSON Schema that defines the views and payloads on the wire. Generated TypeScript types and validators come from it; it is never hand-edited. |
| **Generated types** | The TypeScript and validation code produced from the contract schema. Regenerate them after a schema change. |
| **SIM** | The proxy's scripted bot seats, enabled only with `--sim on`. Development and test use only; release builds and the web client never offer it. |
| **Fake E2E** | Browser tests against the fake server. Deterministic, and no stack is required. |
| **Real E2E** | The same browser tests against a live server, proxy, and client. It detects protocol drift and needs a running stack. |
| **Layer** | A named group of checks in the test orchestrator, such as `unit`, `java`, `self-test`, or `e2e`. |
| **Demo mode** | A static build that runs the fake-server core inside the browser. It is scripted, not the XMage engine. |
| **MCP server** | A separate stdio server exposing `mage_*` tools for scripted play and automation. |
| **Offline image index** | The generated card, printing, and token maps shipped with the client. They build direct image-CDN URLs; a miss shows a text placeholder. |
| **`VITE_*` variables** | Build-time settings baked into the web bundle: default proxy and server addresses, deployment lock, replay-directory visibility. |
| **i18n** | Internationalization. The English locale is the source, and eight translations ship with it. |

## Related

- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)
- [Architecture](../developer-guide/architecture.md)
- [Protocol](../developer-guide/protocol.md)
- [Commands](commands.md)
