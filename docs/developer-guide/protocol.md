# The WebSocket protocol

The web client and the proxy speak one JSON protocol over a WebSocket. It carries three kinds of traffic: requests that expect a result, server callbacks re-exposed as events, and periodic lobby snapshots. This page describes the framing, the envelopes, the error model and the versioning rules. `Mage.Proxy/README.md` remains the exhaustive catalogue of every action and event; read it when you need a specific verb's arguments.

> **Who this is for:** developers adding an action, handling an event, or changing the contract between the proxy and the client.

## Precedence

When the pieces disagree, this order decides:

1. The XMage server's actual behaviour on the wire.
2. The documented contract in the proxy reference.
3. `web/schema/contract.schema.json` and the types generated from it.
4. Hand-written client types for envelopes and event names.

If the documented contract and the schema disagree, regenerate the schema-derived files first, then fix the code. Never hand-edit a generated file.

## Transport

| Property | Value |
|---|---|
| Endpoint | `ws://<proxy-host>:8787` by default, or `wss://` behind TLS |
| Encoding | Text frames containing one JSON value |
| Compression | `permessage-deflate` negotiated when the client offers it |
| Message size | 1 MiB by default (`--maxMessageBytes`) |
| Rate | 100 messages per second per connection by default (`--maxMessagesPerSecond`) |
| Origin | Localhost origins and no-origin clients by default; exact allowlist with `--allowedOrigins` |

A full game state is roughly 200 KB of repetitive JSON and compresses by an order of magnitude; that transfer is most of the latency a remote player feels.

The proxy closes a connection with specific codes:

| Code | Reason |
|---|---|
| 1008 | Origin not allowed, or message rate exceeded |
| 1009 | Message larger than the configured limit |
| 4401 | Deliberate connect rejection the user can fix: bad auth token, or a name already held by another browser |

Code 4401 is part of the contract, not an implementation detail. A browser that reconnects automatically would resend the same rejected frame forever, so the client must stop and let the user correct the form.

## Envelopes

Every client message is one request:

```json
{"requestId": "42", "action": "connect", "args": {"host": "<server-host>", "port": 17171,
 "username": "Player One", "password": ""}}
```

Every proxy message has a `type`. The envelope set is small:

| `type` | Direction | Meaning |
|---|---|---|
| `result` | reply | Answer to one request, correlated by `requestId`, with `ok`, optional `data`, optional `error` and `errorCode` |
| `event` | push | One re-exposed server callback: `method`, `messageId`, `objectId`, `data`, optional `seq` |
| `lobby` | push | Snapshot of tables, users and server messages |
| `connected` | push | The XMage session is up; sent on login, re-login and attach |
| `disconnected` | push | The session ended and will not be restored |
| `serverLink` | push | Progress of a lost-link recovery: `lost`, `retrying`, `restored`, `failed` |
| `info` | push | Informational message, including the proxy-ready greeting |
| `error` | push | Error message, with `fatal` distinguishing a session-ending failure |
| `connect_error` | reply | Typed rejection of a connect before it is accepted |
| `models_error`, `personalities_error` | reply | Typed failure of an LLM list request, carrying the request id |
| `llm_prompt` | push | The server asks this browser to run an LLM provider call with a locally stored key |

A successful `connect` result also carries `attached`, `streamId` and a `capabilities` object; an attach carries `resumed` when it replayed the missed stream. The client stores the stream id and the last sequence it processed so a reload can ask for exactly the gap.

`lobby` is a snapshot, not a delta: it is re-sent every two seconds, or every twenty seconds while a game is in progress with recent activity, and the server news inside it refreshes once a minute. It is deliberately not numbered in the stream, because replacing it is always safe.

## Requests and results

A result echoes the action and the request id:

```json
{"type": "result", "action": "getTables", "requestId": "42", "ok": true, "data": [...]}
{"type": "result", "action": "joinTable", "requestId": "43", "ok": false,
 "errorCode": "PASSWORD", "error": "Wrong password"}
```

The client keeps one pending promise per request id and arms a 30-second timeout. A request that never receives a result resolves on the client as a failed result with `errorCode: "TIMEOUT"`, so a dropped frame cannot leave a dialog spinning forever. If a reply arrives without a request id, the client falls back to the oldest pending request for that action.

Only `connect` and `ping` are allowed before login. Everything else on an unauthorized connection answers `NOT_AUTHORIZED`. `ping` is answered immediately on the WebSocket thread, never queued behind session work, because the client's heartbeat treats a slow queue as a dead socket.

## Session and information actions

| Action | Purpose |
|---|---|
| `connect` | Log in, attach to a live session, or resume a stream. Arguments include host, port, username, password, an optional browser id, an optional auth token and an optional resume token |
| `disconnect` | Log out and end the session |
| `leaving` | The page is closing; no answer. Shortens the session grace period |
| `ping` | Keep-alive, answered with `pong` |
| `getServerInfo` | Server host, version text, session id, connection state and the protocol version |
| `getGameTypes`, `getDeckTypes`, `getPlayerTypes`, `getTournamentTypes`, `getDraftCubes` | Capability lists used to build the create-table and join forms |
| `getExpansionsWithBoosters` | Sets with boosters, in release order; empty while the card index builds |
| `getTables`, `getRoomUsers`, `getFinishedMatches`, `getServerMessages` | Lobby reads |
| `getRoomChatId`, `getTableChatId`, `getGameChatId`, `getTournamentChatId` | Resolve a chat channel for a context |
| `joinChat`, `leaveChat`, `sendChatMessage` | Chat operations |

## Game actions

Game input is deliberately generic: the server decides what a value means for the prompt it asked.

| Action | Arguments | Meaning |
|---|---|---|
| `sendPlayerUUID` | `gameId`, `value` | Choose a card, permanent or player by id |
| `sendPlayerBoolean` | `gameId`, `value` | Answer a yes/no question or pass priority |
| `sendPlayerInteger` | `gameId`, `value` | Choose a number |
| `sendPlayerString` | `gameId`, `value` | Choose from a list of strings |
| `sendPlayerManaType` | `gameId`, `value` | Pay from the mana pool with a chosen type |
| `sendPlayerAction` | `gameId`, `action`, `data` | Advanced or engine-specific action, such as passing priority until the stack resolves |

Every one of these requires a `gameId`; the proxy rejects the request with `GAME_ID_REQUIRED` when it is absent. While a replay is loaded, all player-action verbs are refused with `CAPABILITY_UNAVAILABLE` before any server call, because a replay has no seat.

Around the game loop sit deck submission and validation, replay navigation, draft picks and tournament joins. The proxy reference lists every one with its arguments; the important contract for a client author is that a rejected action always returns a typed code and the server's own detail text, never an empty failure.

## Events

An event mirrors the server callback:

```json
{"type": "event", "method": "GAME_UPDATE", "messageId": 412, "objectId": "<game-id>",
 "data": {"gameView": {"...": "..."}}, "seq": 87}
```

| Field | Meaning |
|---|---|
| `method` | The server callback name, such as `GAME_INIT`, `GAME_UPDATE`, `GAME_SELECT`, `CHATMESSAGE` |
| `messageId` | The server's per-session callback counter, restored to order by the proxy |
| `objectId` | The game, table, tournament or chat the callback belongs to, when it has one |
| `data` | The serialized payload. Its shape depends on the method |
| `seq` | Position in this session's frame stream, absent on frames replayed to one connection |

Events fall into four groups:

- **Lifecycle:** match start, game initialization, game over, end-of-game summary, sideboard between games.
- **State:** full game updates, with or without an accompanying information message.
- **Interaction:** questions the player must answer — priority, target selection, mana payment, amount, color, mode, pile, card order and the rest. These are the frames that open a prompt in the client.
- **Social and lobby:** chat messages, server announcements, table joins, watch notifications.

The client keeps a per-game ordering guard and ignores an event from a game it has already left. The proxy drops events for games the session never joined, so a shared connection cannot leak another player's board into yours.

For the exhaustive list of methods and their payloads, including replay and LLM frames, use the proxy reference. Adding a new event means handling the method in the client's event router and listing it among the known event names; the coverage guard fails until both exist.

## Stream resume

Each session has an id and a monotonically increasing frame sequence. A client that reconnects sends:

```json
{"requestId": "7", "action": "connect", "args": {"host": "<server-host>", "port": 17171,
 "username": "Player One", "password": "", "resume": {"streamId": "<stream-id>", "seq": 86}}}
```

If the stream is still known, the proxy sends the result, then every frame after `seq` in order, then continues live. If the requested position has been evicted, it answers `resumed: false` and the client rejoins its game to receive the latest state and prompt. The client discards any frame whose sequence it has already processed, so a frame in flight in both directions is harmless.

## Types on the wire

Serialization mirrors Java fields one to one. That gives the contract four rules that are easy to remember:

- Field names are camelCase, exactly as declared in the Java class.
- UUIDs and enums are strings; dates are epoch milliseconds.
- Maps become objects keyed by the string form of the key.
- `Optional` is unwrapped; nulls, static fields, transient fields, loggers, `Class` and `Throwable` do not appear.

`web/schema/contract.schema.json` describes every view type; `web/src/net/types.generated.ts` is generated from it. Hand-written types cover only envelopes, event names and deck shapes.

## Errors

| `errorCode` | Cause |
|---|---|
| `BAD_JSON` | The frame is not valid JSON or lacks the expected object shape |
| `NOT_AUTHORIZED` | A non-public action arrived before `connect` |
| `GAME_ID_REQUIRED` | A game-scoped action omitted `gameId` |
| `INVALID_ARGUMENT` | An argument is missing, malformed or refused by policy |
| `UNKNOWN_ACTION` | No handler claims the action |
| `FAILED` | The server rejected the call without a more specific classification |
| `WARMING_UP` | The proxy is still building its card database; retry shortly |
| `VERSION_MISMATCH` | The server runs a different XMage release than the proxy was built against |
| `CAPABILITY_UNAVAILABLE` | The request needs a feature the connected server does not advertise |
| `CARD_NOT_FOUND` | The server cannot load a card in the submitted deck |
| `INVALID_DECK`, `INVALID_DECK_TYPE`, `INVALID_GAME_TYPE` | The server rejected the deck or the format |
| `PASSWORD`, `SEAT`, `TABLE_LIMIT`, `RATING`, `QUIT_RATIO` | Table or account policy refusals |

Errors are actionable, not decorative: the client maps a version mismatch to a dedicated message, a card-not-found to a deck repair dialog, and a capability rejection to hiding the feature.

## Versioning

Two versions travel independently:

- **The JSON protocol version** is a single number, currently `1`, reported by `getServerInfo`. It changes only when the envelope contract changes incompatibly.
- **The XMage release** is the engine version the proxy compiles against, currently `1.4.62-V1`. The server's handshake requires a matching release; a different one is refused with `VERSION_MISMATCH` and a detail naming both versions. No retry helps; the proxy must be built against that release.

Compatibility inside one release is additive. New view fields appear in the schema and the generated types, and a client that does not know a field ignores it. New events are added to the known-method list; unknown methods are ignored rather than crashing the router.

The `capabilities` object on a successful connect tells the client what the connected server can actually do:

```json
{"llm": true, "p1": false, "replayScrubber": true, "replaySidecar": true,
 "serverVersion": "1.4.62-V1", "playerTypes": ["HUMAN", "COMPUTER_LLM"]}
```

A missing block means an old proxy or a stock server, and every capability-gated feature stays hidden. Two-sided gating is deliberate: the client hides the controls, and the proxy rejects a request that carries gated content before any server call.

Changing the contract is a regeneration, not an edit:

```bash
cd web
npm run gen-types && npm run gen-zod && npm run gen-server-state
npm run gen-types:validate && npm run gen-zod:validate && npm run gen-server-state:validate
```

Unit-level guards then check that every callback has a handler, every field the server can emit is modelled, engine-only state is tracked, and the configured game and deck types stay covered. A protocol change that skips those guards fails the `unit` layer before it can reach a release.

## Related

- [The proxy](proxy.md)
- [Architecture](architecture.md)
- [Code map](code-map.md)
- [Web client internals](web-client.md)
- [Testing](testing.md)
- [Glossary](../reference/glossary.md)
- [Protocol (inherited upstream page)](../protocol.md) — older upstream-authored description; this guide is authoritative.
