# Mage.Proxy — XMage WebSocket Bridge

A thin bridge between the XMage Java server (jboss-serialization protocol) and
any modern client (JSON over WebSocket). **Zero game logic** — the proxy only
forwards state and actions. All rules engine logic lives in the XMage server.

## Architecture

```
┌──────────────┐   WebSocket JSON   ┌────────────────┐   jboss-serialization   ┌───────────────────┐
│  Web Client  │ ◀────────────────▶ │  Mage.Proxy    │ ◀─────────────────────▶ │  XMage Server     │
│  React + TS  │   port 8787        │  (Java)        │   port 17171            │  (Mage.Server)    │
└──────────────┘                    └────────────────┘                         └───────────────────┘
```

**What the proxy does:**
1. Opens a real XMage session (`SessionImpl`) to the server
2. Receives server callbacks (game events, lobby updates, chat)
3. Serializes them to JSON using `JsonUtil` (reflection-based, field-by-field)
4. Broadcasts them to all connected WebSocket clients
5. Receives actions from clients and forwards them to the server

**What the proxy does NOT do:**
- No game rules logic
- No card database
- No state transformation (JSON mirrors Java fields 1:1)
- No event filtering (forwards everything, except outdated events on reconnect)

## How Serialization Works

The proxy uses `JsonUtil.java` — a reflection-based serializer. Rules:

| Java Type | JSON Representation |
|---|---|
| `String`, `UUID`, `Enum` | `"string"` |
| `int`, `long`, `Integer`, `Long`, `double` | `number` |
| `boolean`, `Boolean` | `boolean` |
| `Date` | `number` (epoch millis) |
| `Optional<T>` | unwrapped (`null` if empty) |
| `List<T>`, `T[]` | `[...]` |
| `Map<K,V>` | `{...}` (keys stringified) |
| Custom objects | `{field1: ..., field2: ...}` (camelCase field names) |
| `null` fields | omitted or `null` |
| `static`, `transient` fields | skipped |
| Technical fields (`serialVersionUID`, `logger`, `Class`, `Throwable`) | skipped |

Field names come from Java reflection (camelCase). The TypeScript types mirror
these exactly — see `schema/contract.schema.json` and `types.generated.ts`.

## Protocol: Client → Proxy (Actions)

Request format:
```json
{"requestId": "42", "action": "connect", "args": {"host": "localhost", "port": 17171}}
```

### Connection & Session

**Multi-tenant:** every WebSocket connection owns its own XMage session
(`SessionImpl`); one proxy process serves many users at once. A second connection
that sends `connect` with the **same account** (`host|username`) attaches to the
existing session (several tabs/windows = one session) instead of opening a new
one. Different accounts are isolated sessions: server→client events of a session
only reach that session's connections.

The `connect` result carries `data.attached`: `true` when the connection
re-attached to a live session (reload or reconnect within the grace period) and
`false` when it opened a new XMage session. With `attached: false` the server
callback ids restart at 1, so the web resets its per-game event ordering. It also
carries `data.streamId` (see the resumable stream below) and, on an attach,
`data.resumed`.

**Resumable stream:** every frame a session broadcasts except `lobby` carries a
`seq`, numbered per proxy session (`OutboundLog`). A `connect` with
`resume: {streamId, seq}` (the last frame the client processed) that attaches to
that same stream gets every later frame replayed in order before the live stream
(`resumed: true`): a `SIDEBOARD`, a game 2 `START_GAME`, a `GAME_OVER` or chat sent
while the client was away is not lost. A newer plain `GAME_UPDATE` of a game
replaces the older one in the log; frames are kept 60 s once delivered and
without limit (up to 2000 frames / 16 MB) while no client is attached. When the
requested `seq` is no longer available the attach answers `resumed: false` and the
client rejoins its game (`joinGame` replay below). Clients drop a frame whose
`seq` they already processed.

**Lost link to the server:** when the proxy loses its XMage server (network,
server hiccup) while clients are attached, it logs the session in again by itself
for up to `--relinkSecs` (default 600 s), hiding the old server session and
passing its restore id as the desktop client does, so the server hands the tables
back. A lost-link report is checked first by pinging the server with the session
itself (`SessionProbe`, up to 45 s): jboss' validator gives up after a 3 s ping
timeout, which a server busy with dead sessions' callbacks exceeds, and logging in
again on such a false alarm would kick the healthy session out. After a false
alarm the proxy's own keep-alive probe (every 20 s) watches the session instead. Clients get `serverLink` frames (`lost`, `retrying` + `attempt`, then
`restored` or `failed`); only after `failed` is `disconnected` sent. A session
lost again within 2 minutes of its relink was taken over by another login of the
same account (the server disconnects the older instance of a user, which looks
exactly like a lost link): the proxy then gives up with
`serverLink: failed, reason: "superseded"` instead of fighting it. A second
`connect` of an account whose login is still running waits for that login and
attaches to it, so one account never opens two server sessions through the proxy. The restore id
also lets a re-login of the same account through the same proxy session get its
old session back after an IP change, and it is remembered per account across
clients and restarts (see below), so a retry, a reload or a deploy is not refused
with "already connected or your IP address changed" while the server still holds
the old session.

**Grace period (`--graceSecs`, default 180 s).** When the last WebSocket of a
session closes, the XMage session stays alive so a reload, a network switch or a
phone in the background can re-attach to the running game. Only when nobody comes
back is it closed for good (the server then removes the player from its tables).
When the last page announced it was closing (`leaving`, sent by the web on
`pagehide`: tab closed, reload, navigation) the shorter `--leaveGraceSecs`
(default 45 s) applies instead: a reload is back within seconds, and the opponent
of a player who closed the tab waits 45 s instead of 3 minutes.
The proxy never closes a session early with `keepMySessionActive`: the server
keeps a zombie session whose callbacks block its threads. When the proxy process
itself stops (restart, deploy) it does **not** disconnect its sessions: the server
sees a lost connection, keeps the tables for its 3-minute window, and the next
login restores them (`User.onReconnect`). A re-login of an account whose session
is idle but not released reuses the same client (its SIM seats included).

**Replay on re-attach:** the proxy's session stays connected, so XMage does not
re-send the state when the web logs in again. The proxy caches, per game, the
last `GAME_INIT`/`GAME_UPDATE` and the last pending prompt (`GAME_ASK`,
`GAME_TARGET`, `GAME_SELECT`, `GAME_PLAY_MANA`, …) and on `joinGame` re-sends them
**to that connection only** (`ReplayCache`). The prompt stays cached until the
player answers it (`sendPlayer*`, or a `PASS_PRIORITY_*` action for a
`GAME_SELECT`; put back if the server rejects the answer) or the game ends — state
updates keep arriving while a prompt is open. The cache is cleared when a new
session starts.

**Restore ids across restarts:** the server hands a user's session to any login
that presents the session id as its `restoreSessionId`, even from another address.
The proxy remembers, per `host|username`, the id of the account's last live
session and presents it on the next login; the store is bounded and kept on disk
(`--restoreIds`, default `<tmpdir>/mage-proxy-restore-<wsPort>.json`, `none`
disables it; entries older than 10 minutes are dropped, by which time the server
has already removed the user). Without it a re-login after a proxy deploy or an
IP change is refused with "User ... already connected or your IP address changed"
until the server's own timeout. An explicit `disconnect` (logout) drops the
account's entry, so the next login is a fresh session.

**SIM seats across restarts (dev only, `--sim on`):** the playing SIM seats are kept on disk
(`--simRoster`, default `<tmpdir>/mage-proxy-sims-<wsPort>.json`, `none` disables
it; ignored when older than 10 minutes). When their owner logs in again through a
restarted proxy the bots log in with the same name, the server takes it as a
reconnection and hands them their games; a restored bot with no game stops after
60 s. SIM names start from the clock so a new bot never reuses the name of one of
a previous process. A bot whose own link to the server drops logs in again too.
SIM as a whole is a dev/test-harness feature: with the default `--sim off` (Docker,
`deploy/bundle`, launcher) `createTable`/`createTournamentTable` reject `playerTypes`
containing `"SIM"` and no bot ever runs. The product client offers only the server's
native AI (`COMPUTER_MAD`/`COMPUTER_MONTE_CARLO`/`COMPUTER_DRAFT_BOT`).

**Lobby while playing:** with a game in progress (played or watched, with events
in the last 2 minutes) the lobby is published every 20 s instead of every 2 s,
and the server news every 60 s.

**Callback order and login backlog:** server callbacks can reach the proxy out of
order; they are re-sequenced by their per-session `messageId`
(`CallbackSequencer`; a gap not filled within 400 ms is skipped). Everything
broadcast while a login is in progress (the server's reconnect restore arrives
then) is delivered to the logging-in connection right after its `connect` result.

**Compression:** the WebSocket negotiates `permessage-deflate` (a `GameView` frame
of ~200 KB shrinks 10–50×). Sends to one connection are serialized on a private
per-connection lock (`Gateway.send`).

**Server capabilities (LLM-gated features):** every successful `connect` result
(fresh login and attach) carries `data.capabilities`, probed once per login from
the server's own `ServerState` — never from assumptions about the target address:

```json
{"capabilities": {"llm": true, "p1": false, "replayScrubber": true, "replaySidecar": true,
                  "serverVersion": "1.4.62-V1", "playerTypes": ["HUMAN", "COMPUTER_LLM", ...]}}
```

`llm` = the server advertises `COMPUTER_LLM`; `p1` = it advertises `COMPUTER_P1`;
`replayScrubber`/`replaySidecar` ride the `llm` signal (the fork-only
`Replays.seekTo` and sidecar metadata have no signal of their own in this
release); `serverVersion` is the server's version text or `"unknown"`. A failed
connect carries none — a missing block means "old proxy / stock server", and
every LLM-gated feature stays hidden.

`capabilities.replayScrubber` additionally gates the fork-only `replaySeek` verb
(see the Replay subsection of the action catalog): it is the server-side signal
the proxy already probes, and the reflection seam reports the same absence when
the running `SessionImpl` has no `seekTo`.

**Gated dispatch (Fail Fast):** a request that carries LLM wire content
(`llmConfigs` entries) or an LLM seat (`COMPUTER_LLM` in `playerTypes` of a
create, or `playerType: "COMPUTER_LLM"` on join) is rejected with the typed
`ok:false, errorCode:"CAPABILITY_UNAVAILABLE"` BEFORE any server RPC when the
connected server reported no `llm` capability. The web hides the controls
meanwhile (double gating).

| Action | Args | Description |
|---|---|---|
| `connect` | `{host, port, username, password, resume?: {streamId, seq}}` | Connect to XMage server. While the proxy builds its card DB on first boot it answers `ok:false, errorCode:"WARMING_UP"` — retry in a few seconds. A server running another XMage release refuses the login with `errorCode:"VERSION_MISMATCH"` (the detail keeps the server's `Your version` / `Server version` text): the proxy has to be rebuilt against that release, no retry helps. Result data: `{attached: boolean, streamId: string, resumed?: boolean, capabilities: {...}}` (see "Server capabilities" above) |
| `disconnect` | `{}` | Disconnect from server |
| `leaving` | `{}` | The page is closing; no answer. The session then gets the short grace period (`--leaveGraceSecs`) when this was its last connection |
| `ping` | `{}` | Keepalive and web heartbeat; answered at once on the WebSocket thread (before or after `connect`), never queued behind the session's commands |
| `getServerInfo` | `{}` | Server version, protocol version |
| `getGameTypes` | `{}` | Available game types |
| `getDeckTypes` | `{}` | Available deck types |
| `getPlayerTypes` | `{}` | Available player types (HUMAN, COMPUTER_*) |
| `getExpansionsWithBoosters` | `{}` | Sets with boosters (`{code, name, releaseDate}`), release-date order; `[]` while the card DB is still building |
| `getRoomUsers` | `{}` | Users in the room |
| `getRoomChatId` | `{}` | Chat room ID |
| `getTables` | `{}` | All tables |
| `getFinishedMatches` | `{}` | Match history |
| `getReplayFiles` | `{}` | List the saved replay files in the proxy's replay directory (`--replayDir`, default `saved`, resolved against the proxy process CWD). Result data: `{directory, exists, files:[{gameId, bytes, savedAtMs, meta?}]}` sorted by `gameId`; `meta` is the parsed `<uuid>.json` sidecar verbatim (absent when there is no/unreadable sidecar). Non-UUID `*.game` names are skipped; a missing directory is not an error (`exists:false`, empty list). Reads the PROXY filesystem (not the server), so it carries **no capability gate** — stock-server-compatible. See the Replay section for the full contract. |
| `getP1Decks` | `{}` | List the P1 (Argentum policy-net) training decks for the New-Game seat picker. Result data: `{decks:[{name, deck}], default}` — the 55 Standard training lists plus the deterministic default name. Gated typed `ok:false, errorCode:"CAPABILITY_UNAVAILABLE"` FIRST when the connected server reported no `capabilities.p1` **or** the running artifacts lack the fork-only `mage.cards.decks.P1DeckPool` (absent in stock 1.4.62). See the Lobby section for the full contract. |
| `getServerMessages` | `{}` | Server news/messages |

### Lobby

| Action | Args | Description |
|---|---|---|
| `createTable` | `{name, gameType, deckType, winsNeeded, playerTypes, password, llmConfigs?, ...}` | Create a table. `llmConfigs` carries one entry per `COMPUTER_LLM` seat in `playerTypes` order (see below); rejected typed when the server lacks `capabilities.llm` |
| `createTournamentTable` | `{name, tournamentType, matchType, playerTypes, password, llmConfigs?, ...}` | Create a tournament table (same `llmConfigs` contract as `createTable`) |
| `joinTable` | `{roomId, tableId, playerName, playerType, skill, deck, password}` | Join a table (`playerType: "COMPUTER_LLM"` is rejected typed when the server lacks `capabilities.llm`) |
| `joinTournamentTable` | `{roomId, tableId, playerName, playerType, skill, deck, password}` | Join a tournament table before the tournament starts (same LLM gate as `joinTable`) |
| `leaveTable` | `{tableId}` | Leave a table |
| `removeTable` | `{tableId}` | Remove a table (owner only; a table that no longer exists counts as removed; non-owners get `NOT_AUTHORIZED`) |
| `startMatch` | `{tableId}` | Start the match |
| `startTournament` | `{tableId}` | Start the tournament (tournament tables) |
| `joinTournament` | `{tournamentId}` | Panel-join a started tournament (humans must join or the draft never fires) |
| `joinDraft` | `{draftId}` | Panel-join a started draft |
| `swapSeats` | `{tableId, seatNum1, seatNum2}` | Swap two seats (owner, READY_TO_START only) |
| `watchTable` | `{tableId}` | Watch a table |
| `watchGame` | `{gameId}` | Watch a specific game |
| `stopWatching` | `{gameId}` | Stop watching |
| `joinGame` | `{gameId}` | Join a game (as player) |
| `quitMatch` | `{tableId}` | Quit the match |

#### Per-seat LLM config (`llmConfigs`)

`createTable` and `createTournamentTable` take an optional `llmConfigs` array with
**one entry per `COMPUTER_LLM` seat, in `playerTypes` order** (the k-th LLM seat
consumes the k-th entry; a `null` or absent entry means server defaults for that
seat). It rides to the server as `MatchOptions.llmPlayerConfigs`, which
`TableController.wireLlmConfigs` consumes positionally. Every field is optional;
empty strings and `null` leave the server default, `modelContextWindow: 0` means
auto-detect, and `reasoningEffort: "default"` is the dialog sentinel (not an
override):

```json
"llmConfigs": [{"model": "deepseek-v4", "apiEndpoint": "http://localhost:11434/v1/chat/completions",
                "reasoningEffort": "high", "thinkingEnabled": true, "maxTokens": 4096, ...},
               null]
```

Fields: `model`, `apiEndpoint`, `apiKey`, `useClientKey`, `clientKeyTag`,
`reasoningEffort`, `reasoningEffortLevels`, `thinkingEnabled`, `temperature`,
`temperatureEnabled`, `maxTokens`, `timeoutSeconds`, `streamingEnabled`,
`verboseLogging`, `deckAssessmentEnabled`, `concedeEnabled`, `askReason`,
`transcriptDir`, `personalityEnabled`, `personalityName`, `botName`,
`conversationMaxExchanges`, `conversationMaxHistoryChars`,
`conversationThinkCharsPerMsg`, `summarizeTriggerChars`, `summarizeContextRatio`,
`modelContextWindow`, `summarizeTargetChars`, `summarizeTargetRatio`,
`summarizeKeepExchanges`.

Validated at the protocol edge, Fail Fast, answered `ok:false,
errorCode:"INVALID_ARGUMENT"` with the real reason BEFORE any server RPC:

- `apiEndpoint` must be `http`/`https` and its host must pass the explicit
  `--allowedModelHosts` allowlist (comma-separated; default `localhost,127.0.0.1,::1`;
  an empty value rejects every endpoint). Not a blocklist: an unlisted host is
  refused outright, so a seat config cannot port-scan loopback or reach internal
  services. Cloud metadata hosts (`169.254.169.254`, `169.254.170.2`,
  `metadata.google.internal`) are refused too.
- `apiKey` and `useClientKey: true` are mutually exclusive (ambiguous about which
  key the provider call would use). `useClientKey: true` requires a non-empty
  `clientKeyTag` — the browser tags every client-key seat so the server can name
  which locally-stored key to use; the key itself never travels.
- Wrong field types are rejected with the field name (`llmConfigs[<seat>].<field>`).

#### LLM model / personality lists (`fetchModels` / `fetchPersonalities`)

The per-seat LLM config form fills its Model and Personality fields from two list
verbs instead of free text. Both are gated on `capabilities.llm` and answer a
**typed** error frame — never the generic `error` frame, whose consumer would
leave the form's loading flag stuck.

| Action | Args | Description |
|---|---|---|
| `fetchModels` | `{apiEndpoint}` | List the models an OpenAI-compatible endpoint serves. Success: a plain `result` with `data.models: string[]` (and `data.endpoint` echoing the validated endpoint). The endpoint goes through the SAME policy as `llmConfigs` (`http`/`https` only, cloud-metadata hosts blocked, host on `--allowedModelHosts`) BEFORE any network call; the call runs on a bounded background pool so a slow provider does not stall the session. Ported model-list logic: derives the base URL from the chat-completions URL, probes Ollama `/api/tags` when the endpoint looks like Ollama, then falls back to the OpenAI-compatible `/v1/models` (`data[].id`). |
| `fetchPersonalities` | `{}` | List the engine's personality registry (`mage.players.Personality.allNames()`). Pure in-memory read, answered inline: a plain `result` with `data.personalities: string[]`. |

Errors are typed frames, never `result`/`error`:

- `models_error` `{action:"fetchModels", requestId, ok:false, errorCode, message}` —
  every `fetchModels` failure (gate, endpoint validation, no endpoint, provider
  error, empty list, pool saturated).
- `personalities_error` `{action:"fetchPersonalities", requestId, ok:false, errorCode, message}` —
  every `fetchPersonalities` failure.

`errorCode` is `CAPABILITY_UNAVAILABLE` when the connected server reported no
`capabilities.llm` (rejected FIRST, before any work) or `INVALID_ARGUMENT` for an
endpoint off the allowlist / a non-http(s) scheme / a blocked metadata host / a
missing endpoint; a provider-side failure is `FAILED`. The allowlist is the same
`--allowedModelHosts` used for seat `apiEndpoint`s; the player-facing `message`
names the offending host but never the operator flag.

#### Client-key prompt bridge (`llm_decision` / `llm_error`)

A client-key LLM seat (see `useClientKey` above) keeps its API key in the browser: the server
builds the exact provider request body and hands it to the proxy as the fork-only `LLM_PROMPT`
callback, which the proxy forwards as the typed `llm_prompt` frame (see the Events section). The
browser attaches its own key, POSTs to the provider (directly, or via `/llm-relay`), and returns
the outcome through these two verbs. The key NEVER travels in either direction.

| Action | Args | Description |
|---|---|---|
| `llm_decision` | `{requestId, rawResponse, thinking?, httpStatus?}` | The provider's raw response body for a pending `llm_prompt`. `requestId` must be a UUID (else `INVALID_ARGUMENT`); an empty `rawResponse` is `INVALID_ARGUMENT`. Forwarded to the server through the cached reflection seam (`LlmDecisionSupport`) → `SessionImpl.llmDecision`. |
| `llm_error` | `{requestId, message, retryable, httpStatus?}` | The browser's provider call failed (HTTP error, network error, CORS refusal). `requestId` must be a UUID. Forwarded to `SessionImpl.llmError`. |

Both are gated typed `errorCode:"CAPABILITY_UNAVAILABLE"` (before any RPC) when the connected
server reported no `capabilities.llm`, **or** when the running `SessionImpl` lacks the fork-only
`llmDecision`/`llmError` methods (the same reflection-seam pattern as `replaySeek`). A call that
returns `false` answers `ok:false, errorCode:"FAILED"`. Both are high-frequency `Activity.QUIET`
actions (counted, not logged).

### Deck Management

| Action | Args | Description |
|---|---|---|
| `submitDeck` | `{tableId, deck}` | Submit deck for the match |
| `updateDeck` | `{tableId, deck}` | Update deck |
| `validateDeck` | `{deck}` | Pre-validate a deck against the proxy's card DB (see below) |
| `validateDeckFormat` | `{deck, deckType?, gameType?}` | Run the official XMage `DeckValidator` of that format (sizes, bans, copies, commander/partner, color identity): `{ready, supported, valid, validator, errors:[{type, group?, message?, cardName?}]}`. `supported:false` when the format has no validator |
| `commanderEligibility` | `{names}` | Can each card be a commander, computed with the real card classes: `{ready, results:[{name, eligible}]}` |
| `resolvePrintings` | `{names, strategy?, setCode?}` | The printing XMage's own importers pick for each name (see below) |
| `cardPrintings` | `{names, limit?}` | Printings of each card implemented in this release (`[]` = not implemented; `limit:1` is enough to know) |

Deck format:
```json
{
  "name": "My Deck",
  "cards": [{"cardName": "Lightning Bolt", "setCode": "2XM", "cardNumber": "162", "amount": 4}],
  "sideboard": [{"cardName": "Path to Exile", "setCode": "2XM", "cardNumber": "30", "amount": 2}],
  "commanders": [{"cardName": "Sidar Kondo of Jamuraa", "setCode": "CMR", "cardNumber": "535", "amount": 1}]
}
```

`commanders` (optional, 1–2 cards) carries the **explicitly designated**
commander(s) for Commander games (a legal pair: Partner, Partner with, Friends
forever, Doctor's companion or Choose a Background + Background). `DeckJson.parse`
moves each entry from `cards` to `sideboard` — where XMage expects commanders
(`GameCommanderImpl` treats all sideboard cards as commanders and
`AbstractCommander` validates the pair). Without this field the proxy keeps its
heuristic in `DeckValidation.normalizeForXMage` (first legal card in deck order),
which only ever sends one commander.

#### Deck pre-validation (`validateDeck`)

Replicates **exactly** the target XMage server's `Deck.load` semantics (upstream:
strict `CardRepository.findCard(set, number)`, card name ignored) using only
public upstream APIs (`CardRepository`, `CardScanner`) against the proxy's own
card DB, built from the same `mage-sets` release the fork pins. No fork code is
used, so the report is valid for any server on the same XMage version
(`beta.xmage.today` included).

The DB is built lazily on first proxy start (`CardScanner.scan()`, ~10 s in
background, stored in `Mage.Proxy/db/`, gitignored) and rebuilt automatically
whenever the fork build changes (new release ⇒ new card list).

Response `data` (advisory — `ready:false` means the DB isn't available and the
client must not block):

```json
{
  "ready": true,
  "missing": [
    {"cardName": "Rhystic Tutor", "setCode": "CY", "cardNumber": "77", "amount": 1,
     "reason": "OUTDATED_PRINTING",
     "suggestions": [{"cardName": "Rhystic Tutor", "setCode": "PCY", "cardNumber": "77"}]}
  ],
  "mismatches": [
    {"cardName": "Rhystic Tutor", "setCode": "C20", "cardNumber": "77", "amount": 1,
     "resolvedName": "Banisher Priest", "suggestions": [...]}
  ],
  "fixedDeck": {"name": "...", "cards": [...], "sideboard": [...]}
}
```

**Entries without a printing** (`"4 Lightning Bolt"` from a plain-text list)
never reach the server blank: `DeckJson.resolvePrinting` gives them, at the
protocol edge, the printing XMage's text importers pick
(`CardRepository.findPreferredCoreExpansionCard`), for every deck the proxy
forwards (`joinTable`, `submitDeck`, `updateDeck`, SIM seats, validation).
`sources` maps the resolved entry back to the blank one the client stored. They
stay blank only while the card DB is still building (validation then reports
them as `missing`).

- `missing`: the server will throw `Card not found` at join. `reason` is
  `OUTDATED_PRINTING` (the card name exists in other printings — repairable by
  swapping set/number) or `UNIMPLEMENTED` (no printing exists). `fixedDeck` is
  the deck without the rejected cards.
- `mismatches`: the server ACCEPTS the entry but loads a **different card**
  (set/number of another card — the name is ignored upstream). Surfaced so the
  player can swap to a correct printing instead of silently playing the wrong card.

#### Card catalog (`resolvePrintings`, `cardPrintings`)

Read-only lookups on the same card DB (`CardCatalog.java`), so the client never
has to guess from Scryfall what the server has. Both answer `ready:false` while
the DB is building; the client then keeps its Scryfall-only path.

```json
// resolvePrintings {names:["Lightning Bolt","Fire // Ice","Fake"], strategy:"default"}
{"ready": true, "results": [
  {"name": "Lightning Bolt", "found": true, "cardName": "Lightning Bolt", "setCode": "M11", "cardNumber": "149"},
  {"name": "Fire // Ice", "found": true, "cardName": "Fire // Ice", "setCode": "APC", "cardNumber": "128"},
  {"name": "Fake", "found": false}]}
// cardPrintings {names:["Lightning Bolt","Fake"], limit:1}
{"ready": true, "results": [
  {"name": "Lightning Bolt", "printings": [{"setCode": "J21", "cardNumber": "787"}]},
  {"name": "Fake", "printings": []}]}
```

`strategy`: `default` (`findPreferredCoreExpansionCard`, what the importers
use), `oldest` (`findOldestNonPromoVersionCard`) or `set` with `setCode`
(`findCardWithPreferredSetAndNumber`, falls back to the default). Names are
deduplicated and capped at 500 per request; split/MDFC/adventure names resolve
by full name or by front face, like `CardRepository.findCards`.

Related hardening: join/submit/update failures now classify
`Card not found` as `errorCode: "CARD_NOT_FOUND"` and always carry the server's
detail text (login failures too — `SHOW_USERMESSAGE` lists are parsed). SIM
seats strip rejected cards from their deck and report join failures to the web
as non-fatal `{type:"error"}` broadcasts instead of leaving the seat silently
empty.

### Game Actions

| Action | Args | Description |
|---|---|---|
| `sendPlayerUUID` | `{gameId, value}` | Select target/card (UUID) |
| `sendPlayerBoolean` | `{gameId, value}` | Answer yes/no, keep/mulligan, pass priority (`false` = pass) |
| `sendPlayerInteger` | `{gameId, value}` | Choose a number (X cost, amount) |
| `sendPlayerString` | `{gameId, value}` | Choose a string option |
| `sendPlayerManaType` | `{gameId, value}` | Choose mana type |
| `sendPlayerAction` | `{gameId, action, data}` | Advanced actions (e.g., `PASS_PRIORITY_UNTIL_STACK_RESOLVED`). `REQUEST_AUTO_ANSWER_TEXT_YES/NO` with `data` = the ask's `options.autoAnswerMessage` makes `HumanPlayer.chooseUse` answer that question itself from then on (`REQUEST_AUTO_ANSWER_RESET_ALL` forgets them all) |
| `updatePreferences` | `{phases?, confirmEmptyManaPool?}` | Sync user prefs to server (`UserData`, applied live via in-place `update()`): phase-stop matrix and/or empty-mana-pool pass confirm (`HumanPlayer.passWithManaPoolCheck`) |
| `cheatSetup` | `{gameId, playerId, zones:{hand?, battlefield?, library?, graveyard?, exile?}}` | **Test only**: place named cards into zones (P1; requires fork server with `testMode=true`, else `ok:false`; unknown card/zone/player → `ok:false`). Call once the game has processed ≥1 normal action (e.g. after the first land drop) — on the very first priority of turn 1 it freezes the game loop (runs off the game thread while still starting up) |

### Replay

Server-side replays exist only on LLMage servers (the fork persists the game plus its sidecar
metadata). The server→browser frames (`REPLAY_GAME`/`REPLAY_INIT`/`REPLAY_UPDATE`/`REPLAY_DONE`)
ride the ordinary `event` envelope and need no proxy work: `data` is the full `GameView`
serialized by `JsonUtil` reflection, so it already carries `replayStateIndex`, `replayStateCount`,
`replayLLMBuckets`, `replayHasLlmPlayers`, `gameLog` and `gameLogCount` when the running artifacts
provide them. See the Replay events subsection below for the frame shapes.

Every replay verb carries `gameId` (`requiresGameId`) and is a high-frequency action
(`Activity.QUIET`): counted, not logged.

| Action | Args | Description |
|---|---|---|
| `replayGame` | `{gameId}` | Load a replay into the session (`ReplaySession`). Refused with `ok:false, errorCode:"FAILED"` while a live game is being played or watched for this session — stop watching/playing first. On success a `REPLAY_GAME` event arrives and the player-action gate opens |
| `startReplay` | `{gameId}` | Start playback of the loaded replay (first frame = `REPLAY_INIT`) |
| `stopReplay` | `{gameId}` | Stop the replay (ends the server-side `ReplaySession`; a `REPLAY_DONE` follows). Closes the player-action gate |
| `replayNext` | `{gameId}` | Step one play forward (`REPLAY_UPDATE`; a boundary yields `REPLAY_DONE`) |
| `replayPrevious` | `{gameId}` | Step one play back |
| `replaySkipForward` | `{gameId, moves}` | Jump `moves` plays forward (the fork clamps at its own maximum) |
| `replaySeek` | `{gameId, stateIndex}` | **Fork-only scrubber.** Jump to an absolute state index. Result `{ok}`; typed `errorCode:"CAPABILITY_UNAVAILABLE"` when the connected server reported no `capabilities.replayScrubber` **or** the running `SessionImpl` has no fork-only `seekTo`, and typed `errorCode:"INVALID_ARGUMENT"` when `stateIndex` is missing/negative or is `>= replayStateCount` from the last forwarded replay frame. The call itself goes through a cached reflection seam (`ReplaySeekSupport`), never a hard compile-time call |

`stateIndex` is a zero-based index into the replay's state track (`0..replayStateCount-1`); the
range check only runs once a `replayStateCount` is known, otherwise the index is forwarded and the
server's own semantics decide (an out-of-range seek makes the server throw with no answer, so the
local check exists to keep the scrubber from hanging a round-trip).

While a replay is loaded or playing, the player-action verbs (`sendPlayerAction`, `sendPlayerUUID`,
`sendPlayerBoolean`, `sendPlayerInteger`, `sendPlayerString`, `sendPlayerManaType`, and the
test-only `cheatSetup`) are refused with the typed `ok:false,
errorCode:"CAPABILITY_UNAVAILABLE"` before any server RPC: a replay carries no seat, and this is
the Fail Fast counterpart of the web client's spectator gate. The gate opens when a replay is
loaded/started and closes on `stopReplay` or on a non-boundary `REPLAY_DONE` (a boundary
`"end of replay"` keeps the session alive so the user can still step back).

#### Saved replay file listing (`getReplayFiles`)

`getReplayFiles` lists the `saved/` directory the PROXY reads replays from — the saved-replay
**file browser** of the History panel. It reads the proxy filesystem, never the server, so it is
stock-server-compatible and **not** gated on `capabilities.replayScrubber`; the fork-only part is
only the load/navigate flow above.

```json
{"action":"getReplayFiles","requestId":"1","args":{}}
→ {"type":"result","action":"getReplayFiles","requestId":"1","ok":true,
   "data":{"directory":"/srv/xmage/saved","exists":true,
           "files":[{"gameId":"<uuid>","bytes":1048576,"savedAtMs":1699999999999,
                     "meta":{"winner":"Alice","turns":12,"tableName":"…","players":[…]}}]}}
```

- `directory` is the ABSOLUTE path actually read: `--replayDir` (default `saved`) resolved against
  the proxy process CWD, exactly what `GameReplay.loadGame` resolves against the SERVER's CWD — so
  a proxy sharing the server's working directory lists its replays with no configuration. A
  differing working directory is then immediately visible instead of silently listing nothing.
- `files` is sorted by `gameId` ascending. Each row carries `bytes` (file length) and `savedAtMs`
  (last modified), always.
- `meta` is the parsed `<uuid>.json` sidecar **verbatim** (the server writes it at save time); the
  key is ABSENT when there is no sidecar or it is unreadable. A torn sidecar degrades the row to a
  legacy row — it never removes a loadable replay.
- A non-UUID `*.game` name is SKIPPED (logged): the desktop client only accepts `<uuid>.game`
  (`replayInit` takes a UUID), so listing it would offer a guaranteed failure.
- A missing directory is NOT an error: `exists:false` and an empty `files` list (a warning names
  the absolute path). The caller sees `ok:true` either way.
### Reports

| Action | Args | Description |
|---|---|---|
| `report_issue` | `{kind, fingerprint, text, viewport, errors, bundle}` | Player-submitted report. Needs an authorized session (like every non-`connect` action). The payload is stored verbatim under `--reportsDir` (`reports/<date>/<id>.json`) and one line goes to the activity log (`report ref=… kind=… bytes=… turn=… step=… fp="…" text="…"`); the `text` in the log is squeezed to 120 single-line characters. Caps: 96 KB per report, 5 reports per session, one per 30 s, and a repeated `fingerprint` inside a session counts as a duplicate. A refused report still answers `ok:true` with `stored:false` and the `reason`, except `too large`, which answers an error (that one is a client bug). Nothing is forwarded to GitHub: `scripts/issue-from-report.mjs` is how a report becomes an issue, run by a person. Verified end to end by `scripts/verify-report.mjs` (the `verify` layer). See `docs/plans/2026-10-09-report-pipeline-design.md`. |

### Chat

| Action | Args | Description |
|---|---|---|
| `getRoomChatId` | `{roomId?}` | Chat id of the main room |
| `getTableChatId` | `{tableId}` | Chat id of a table waiting room |
| `getGameChatId` | `{gameId}` | Chat id of a running game |
| `getTournamentChatId` | `{tournamentId}` | Chat id of a tournament |
| `joinChat` | `{chatId}` | Join chat room |
| `leaveChat` | `{chatId}` | Leave chat room |
| `sendChatMessage` | `{chatId, text}` | Send message |

## Protocol: Proxy → Client (Events)

### Envelope Types

| Type | Description |
|---|---|
| `connected` | WebSocket connected, ready to send `connect` |
| `disconnected` | The XMage session ended (after `serverLink: failed`, or no relink possible) |
| `serverLink` | The proxy lost the XMage server and logs in again: `{state: "lost" \| "retrying" \| "restored" \| "failed", attempt?}` |
| `info` | Server info message |
| `error` | Error message |
| `lobby` | Lobby state (tables, users) — broadcast every ~2s |
| `result` | Response to an action (`ok: true/false`) |
| `event` | Server callback (game events, chat, etc.) |
| `llm_prompt` | **Typed frame** for the fork-only client-key bridge (see below) — NOT an `event` |

### Client-key prompt (`llm_prompt`)

The fork-only `LLM_PROMPT` callback is forwarded as this TYPED frame instead of the generic `event`
envelope (compared by method name, so the proxy still compiles against a stock build that lacks the
constant). The payload (`mage.interfaces.LLMPromptPayload`) is read by reflection; it carries **no
key** — the browser attaches its own and answers with `llm_decision` / `llm_error`.

```json
{"type":"llm_prompt","requestId":"<uuid>","seatId":"<uuid>","gameId":"<uuid>",
 "playerName":"…","requestBody":"{…provider request…}","apiEndpoint":"https://…","stream":false,
 "timeoutSeconds":30,"clientKeyTag":"…"}
```

### Game Events (forwarded from XMage server)

These are the core events the web client must handle. Every event has:
```json
{"type": "event", "method": "GAME_INIT", "messageId": 42, "objectId": "game-uuid", "data": {...}}
```

#### Game Lifecycle

| Event | Data | When |
|---|---|---|
| `START_GAME` | `{gameId, tableName}` | Match started |
| `GAME_INIT` | `{gameView: GameView}` | Initial game state |
| `GAME_OVER` | `{gameId, winnerName, message}` | Game ended |
| `END_GAME_INFO` | `{gameInfo, matchInfo, won, wins, loses, matchView}` | End-of-game summary (match continues or ends) |
| `SIDEBOARD` | `{deck, currentTableId, time, flag}` | Between games in a match |

#### Game State Updates

| Event | Data | When |
|---|---|---|
| `GAME_UPDATE` | `{gameView: GameView}` | State changed (card moved, phase changed, etc.) |
| `GAME_UPDATE_AND_INFORM` | `{gameView: GameView, message}` | State changed + info message |

#### Replay

Forwarded as ordinary `event` frames (same envelope as above). `data` is the full `GameView`; the
replay-specific fields it may carry are all optional and only present on servers whose artifacts
expose them.

| Event | Data | When |
|---|---|---|
| `REPLAY_GAME` | `{gameId}` (in the envelope `objectId`) | The replay session was created server-side (after `replayGame`) |
| `REPLAY_INIT` | `{gameView: GameView}` | First frame of playback (after `startReplay`) |
| `REPLAY_UPDATE` | `{gameView: GameView}` | One navigation step (next/previous/skip/seek) |
| `REPLAY_DONE` | result string (`"stopped replay"` \| `"end of replay"` \| a corrupt-file message) | Playback stopped, hit a boundary, or failed. The web classifies the reason from the string: `"end of replay"` is a boundary (keep the board, allow stepping back), `"stopped replay"` ends the viewer |

#### Player Interaction (must respond)

| Event | Data | Expected Response |
|---|---|---|
| `GAME_SELECT` | `{gameView, message, options}` | Priority window — pass or act |
| `GAME_ASK` | `{question, options, gameId}` | Yes/no question (mulligan, etc.) |
| `GAME_TARGET` | `{message, targets, options, gameId}` | Choose a target |
| `GAME_TARGET_PLAYER` | `{message, targets, options, gameId}` | Choose a player |
| `GAME_TARGET_AMOUNT` | `{message, min, max, gameId}` | Choose amount for target |
| `GAME_PLAY_MANA` | `{message, options, gameView}` | Pay mana (click sources on battlefield) |
| `GAME_PLAY_XMANA` | `{message, options, gameId}` | Pay X mana (confirm/cancel) |
| `GAME_GET_AMOUNT` | `{message, min, max, gameView}` | Choose a number (X cost) |
| `GAME_GET_MULTI_AMOUNT` | `{messages, gameId}` | Choose multiple numbers |
| `GAME_SELECT_AMOUNT` | `{message, min, max, gameId}` | Choose an amount |
| `GAME_CHOOSE_ABILITY` | `{message, choices, gameView}` | Choose an ability |
| `GAME_CHOOSE_ONE` | `{message, options, gameId}` | Choose one option |
| `GAME_CHOOSE_MODE` | `{message, options, gameId}` | Choose a mode |
| `GAME_CHOOSE_COLOR` | `{message, options, gameId}` | Choose a color |
| `GAME_CHOOSE_NUMBER` | `{message, min, max, gameId}` | Choose a number |
| `GAME_CHOOSE_STRING` | `{message, options, gameId}` | Choose a string |
| `GAME_CHOOSE_BETWEEN` | `{message, options, gameId}` | Choose between options |
| `GAME_CHOOSE_PILE` | `{message, cardsView1, cardsView2, gameId}` | Choose a pile |
| `GAME_CHOOSE_CARDS` | `{message, options, gameId}` | Choose N cards |
| `GAME_CHOOSE_CARDS_ORDER` | `{message, options, gameId}` | Order cards |
| `GAME_SELECT_CARDS` | `{message, cardsView1, gameId}` | Select cards |
| `GAME_SELECT_TARGETS` | `{message, options, gameId}` | Select targets |
| `GAME_SELECT_PLAYER` | `{message, targets, options, gameId}` | Select a player |

#### Lobby & Chat

| Event | Data | When |
|---|---|---|
| `JOINED_TABLE` | `{tableId, tableName}` | Joined a table |
| `CHATMESSAGE` | `{chatId, username, message, messageType}` | Chat / game-log / status message. `messageType` is the XMage `ChatMessage.MessageType` (`GAME` = game log, `TALK` = player chat, `STATUS`/`USER_INFO` = system noise, `WHISPER_FROM`/`WHISPER_TO` = private). The proxy forwards the whole `ChatMessage` payload as-is, plus injects `chatId` from the callback envelope (the server payload carries no chat id). |
| `SERVER_MESSAGE` | (string or object) | Server announcement |
| `WATCHGAME` | `{gameId}` | Watching a game |

## TypeScript Types

The type contract lives in two files:

| File | Purpose |
|---|---|
| `src/net/types.generated.ts` | **Auto-generated** from `schema/contract.schema.json`. Do not edit manually. |
| `src/net/types.ts` | **Hand-maintained**. Proxy-specific types (envelopes, deck, events). Re-exports view types from generated. |

### Regenerating Types

When XMage upstream changes view classes (new fields, renamed fields):

```bash
cd web
npm run gen-types          # regenerate types.generated.ts
node ../../scripts/gen-types.mjs --validate   # CI drift check
```

The schema (`schema/contract.schema.json`) describes the wire format. Update it
when Java view classes change, then regenerate.

### Adding a New Event

1. **If it's a game event** (forwarded from server):
   - Add the event handler in `web/src/state/eventHandler.ts` (a `case` in the
     `handleEvent` router + body in `web/src/state/events/<domain>.ts`)
   - Or add feedback parsing in `web/src/game/feedback/` (if it's a player interaction)
   - Add the event method to `EVENT_METHODS` in `types.ts`

2. **If it's a new data type** (new Java view class):
   - Add the definition to `schema/contract.schema.json`
   - Run `npm run gen-types` to regenerate TypeScript interfaces
   - Use the new type in your event handler

3. **If it's a proxy action** (client → server):
   - Add a `case` in the domain class (`InfoCommands` / `TableCommands` /
     `TournamentCommands` / `GameCommands`), reachable from the
     from the `ProxyClient.handleCommand` router; add to `requiresGameId` in
     `ProxyClient.java` if the action is game-scoped (the replay verbs all carry
     `gameId`, so they are listed there)
   - Add the TypeScript type in `types.ts` if needed

## What's NOT Supported (and Why)

| Gap | Reason | Impact |
|---|---|---|
| Card images | Binary data not serialized through JsonUtil | Cosmetic — can load from Scryfall API |
| Deck editor | Pure UI, no protocol gap | Build in TypeScript |
| Tournament UI | Protocol actions (`createTournamentTable`, `joinTournament`, `joinDraft`, …) exist, web UI partial | Build in TypeScript |
| Replay system | Load/start/stop/step/seek and the saved-replay **file browser** (`getReplayFiles`: a `saved/*.game` listing + sidecar metadata on the proxy's filesystem) are implemented | Against LLMage servers (gated by `capabilities.replayScrubber`) the whole flow works — `replayGame`/`startReplay`/`replayNext`/`replayPrevious`/`replaySkipForward`/`replaySeek`; stock servers do not persist replays, but the file listing still works (it reads the proxy filesystem) |
| Admin tools | Proxy doesn't expose admin actions | Would need proxy modification |

**Key insight**: The proxy is a thin bridge. If the Java server sends it, the proxy
forwards it. If the Java client can do it, the web client can too — the only
limitation is what's implemented in TypeScript.

## Development

```bash
# Start the stack
node scripts/ctl.mjs start all

# Run tests
node scripts/test.mjs          # full suite
node scripts/test.mjs unit     # unit only
node scripts/test.mjs typecheck # type check only

# Tail logs
node scripts/tail.mjs proxy    # proxy logs
node scripts/tail.mjs server   # server logs
```

Ports:
- XMage server: `17171` (testMode)
- Proxy WebSocket: `ws://127.0.0.1:8787`
- Proxy test page: `http://127.0.0.1:8788/index.html`
- Vite dev: `http://localhost:5173`

## Activity log and admin status

Every WebSocket open/close, login (ok/fail/attach), lifecycle action (createTable, joinTable, watchGame, …) and
session end is printed to stdout as `[activity] <ISO time> <event> user=… ip=… …` (readable with `docker logs -f`).
High-frequency game input and polling actions are counted but not logged. Passwords, chat text and deck contents are
never recorded. The client IP comes from `X-Forwarded-For` when present (reverse proxy), else the socket address.

The high-frequency (counted, not logged) set includes the replay verbs — `replayGame`, `startReplay`,
`stopReplay`, `replayNext`, `replayPrevious`, `replaySkipForward`, `replaySeek` — plus the
`sendPlayer*` input and the lobby/chat polling actions. The `replayGame`/`startReplay`/`stopReplay`
lifecycle transitions are still visible game-side through the `[activity]` game lines
(`replayStates`/`replayPrompts` in `/admin/status`).

With `--adminToken <secret>` (Docker: `ADMIN_TOKEN`), `GET /admin/status` on the HTTP port returns JSON — uptime,
open connections, live sessions, connected users (server, ip, windows, actions, last action) and the last 500 events.
Send `Authorization: Bearer <secret>` (header only — a `?token=` query string was removed: it landed in the access
log, the browser history and every proxy in between). Only `GET` is accepted, and without a token the endpoint does
not exist.

## Health and readiness

Both are unauthenticated, carry no session data, and answer on the HTTP port:

- `GET /health` — liveness. `200` as long as the process answers, whatever the card database is doing.
- `GET /ready` — readiness. `503` until `DeckValidation` is `READY`, then `200`. Gate traffic (or the
  launcher's own wait) on this one: a proxy whose card database `FAILED` still accepts logins, which is the
  usual reason a player sees a confusing "login failed" during a deploy.

```json
{"ok":true,"liveness":false,"ready":true,"cardDb":"READY","sessions":3,"threads":41,"uptimeSeconds":3600}
```

### Replay file download (`GET /replay-file/<uuid>.game`)

Serves a saved replay's BYTES from the same `--replayDir` the `getReplayFiles` listing reads:
`Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<uuid>.game"`,
`Content-Length` from the file size, `Cache-Control: no-store`. Gate decision:
**no additional capability gate** — the listing already exposes the same game ids to the same
clients, and the deployment's own access control (bind address, access key, reverse proxy) is
what decides who reaches the proxy at all.

Hardening is in the URL contract, not per-client state: the path's stem must be exactly 36
hex/dash characters followed by `.game` (the listing's own UUID shape), the file is resolved
under the canonical replay dir and refused if a per-file symlink escapes it (a symlinked
replay *directory* still serves — the rig's server/proxy sharing convention is exactly that),
and anything else (non-GET, bad name, traversal, missing file/dir) is a bare `404` (`405`
non-GET). The web's `ReplayFilesPanel` renders a per-row Download anchor to
`/replay-file/<uuid>.game` when the listing shows a save on disk — a real browser download
(not fetch + blob) so a large save never materialises in the JS heap; pinned by
`ReplayFileDownloadTest` (proxy) and the `llmage-replay-files` e2e.

The static file server sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a
`Content-Security-Policy`; fingerprinted `assets/*` (`name-<8 char base64url hash>.ext`) are cached for a year,
everything else is `no-cache` so a deploy does not keep serving the old client.

## Deployment config (`GET /config`)

Hosted deployments need three knobs the localhost defaults keep as no-ops. The web reads them from
`GET /config` before it renders the connect form; the WebSocket gate and the HTTP probe share one
resolved config, so they can never disagree.

- `--authToken <t>` (env fallback `MAGEPROXY_AUTH_TOKEN`, used only when the flag is absent — a
  `-D`/`--flag` puts the secret in `/proc/<pid>/cmdline`). When set, **every** `connect` must carry
  `args.authToken` equal to it; attach does **not** bypass (the token is presented on every connect,
  including a reload's auto-attach). A missing/wrong token answers the typed
  `{type:"connect_error", message:"Bad or missing auth token"}` **and** closes the socket with
  code **4401** (`"Auth token required"`) — the browser will not retry while the socket is open, so
  the close is mandatory. Empty = OPEN (localhost dev unchanged).
- `--pinnedXmageTarget host:port` + `--hideServerTarget` (default `false`). `hideServerTarget=true`
  **requires** a pinned target: the proxy refuses to start otherwise (fail fast — without a pin the
  browser has no target to fall back to). A malformed pin also refuses to start. When pinned, the
  proxy **forces** that target on every connect and ignores the client's host/port — for the **dial**
  as well as for the account key and the attach match, so a client cannot bypass the pin by sending
  another target (one deployment, one effective target; unpinned, the client's values are dialed
  unchanged).
- `--deploymentName <name>` (default `"XMage Nexus"`) — the branding string the web puts in the page
  title (base, before the attention-alert prefix). No fork-hardcoded branding.

`GET /config` is **always served** (never admin-gated; the pre-connect probe has no token),
`Cache-Control: no-store`, `GET` only:

```json
{"authRequired":false,"hideServerTarget":false,"pinnedTarget":null,
 "deploymentName":"XMage Nexus","llmRelay":false}
```

`authRequired` = a token is configured; `pinnedTarget` = the raw `host:port` string or JSON `null`;
`llmRelay` = the `--llmRelayEnabled` toggle from the section below.

### Anon same-name guard

The XMage server runs anon mode with `ANON_IDENTIFY_BY_HOST=true`: a connect with an existing anon
name from the **same host** silently kills the older session. Every browser dialed through one proxy
appears at the server under the proxy's own host, so any two webui users who pick the same anon name
kick each other in a ping-fail/reconnect loop. The proxy is the only component that sees both the
anon name and the per-browser `browserId` (`web:<username>:<uuid>`, sent on `connect` as
`args.browserId`), so the guard lives here.

A connect whose anon name is already held at that `host:port` by a **different** non-empty
`browserId` is refused **before the dial** with the typed
`{type:"connect_error", message:"This name is already in use on that server — pick another name or wait"}`
and a **4401** close — the older session is never touched. A same-`browserId` retake is the legitimate
reconnect-takeover path → allowed, replacing the entry. Both `browserId`s empty (old clients, direct
WS probes) do **not** block — the old behaviour. The registration is released on **every** teardown
path (failed dial, WS close, rejection close), identity-checked so a name re-registered by another
browser after the holder died is never dropped. The scope is per `host:port` — a multi-server proxy
does not block "Bob" on server A because "Bob" is on server B — and case-insensitive.

### `userIdStr` (shared-IP discrimination)

The `connect`'s `browserId` is set as `Connection.userIdStr` (the server's admin/shared-IP
discrimination), so the server sees a real per-browser id instead of the host proxy's for every
player behind it. Absent `browserId` (old clients) keeps a sane fallback built from the proxy
process's own identity, exactly as before.

## Same-origin LLM relay (`/llm-relay`)

With `--llmRelayEnabled true` (default **false**), the proxy registers `POST|GET|OPTIONS
/llm-relay?url=<absolute provider URL>` on the HTTP port. It is a **dumb byte relay** for client-key
LLM calls to providers without CORS support: the browser POSTs same-origin (no CORS applies), the
relay echoes the request to the provider and returns the upstream status, Content-Type (default
`application/json`) and body with `Access-Control-Allow-Origin: *`. When the knob is off the path is
not registered at all, so it 404s.

Security rules (ported exactly from the LLMage Jetty relay — do not loosen):

- It never reads, parses, logs or stores the `Authorization` header or any body: the key transits
  in-memory bytes only and is never persisted.
- Only these request headers are forwarded upstream: `authorization`, `content-type`, `accept`,
  `x-api-key`, `anthropic-version`, `anthropic-dangerous-direct-browser-access`,
  `x-opencode-session` (never cookies, never `Origin`, never arbitrary client headers).
- The target scheme must be `https`, or `http` **only** for `localhost` / `127.0.0.1` / `::1` /
  `0.0.0.0` (relayed bodies carry the user's key, which must never cross the wire in cleartext).
- Cloud-metadata hosts `169.254.169.254`, `169.254.170.2`, `metadata.google.internal` are blocked.
- The host must pass the **same allowlist** as the seat endpoints (`--allowedModelHosts`, default
  `localhost,127.0.0.1,::1`).
- Redirects are **not** followed (a `Location` target was never validated); request body cap 4 MiB,
  response cap 16 MiB; connect timeout 30 s, read timeout 600 s.

Answers: a missing `url` → `400`; a malformed URL → `400`; a policy rejection → `403` with the
reason text. A preflight `OPTIONS` answers `200` with `Access-Control-Allow-Methods: POST, GET,
OPTIONS`, `Access-Control-Allow-Headers: authorization, content-type, accept, x-opencode-session`,
`Access-Control-Max-Age: 600` and an empty body.

## Watchdog

The proxy logs one line per minute on its roster tick, and the same numbers are in
`/admin/status` under `runtime` and `sessions`.

```
watchdog: threads=54 (peak 79), openConns=0, accounts=0, clientsAlive=0 (created=3 disposed=3),
          wsErrors=0, cardDb=READY
```

`clientsAlive` is `clientsCreated - clientsDisposed` and is the number to read across ticks: one
live session accounts for one, a client released after a rejected login for none. Anything that
climbs while `openConns`/`accounts` do not is a client that nothing can reach, and the line turns
into a `WARNING` once it exceeds the reachable count by more than five. This exists because the
proxy ran for weeks leaking two to five non-daemon threads per failed login with no counter
anywhere that would have shown it.

`sessions` holds the per-connection detail: `connected`/`relinking`/`released`, the grace timer
countdown, `gamesInProgress`, `pendingGapEvents` (callbacks held by the ordering sequencer),
`outboundFrames`/`outboundChars` (the resumable stream buffer), `replayStates`/`replayPrompts`
(the reconnect cache), `sessionGameIds`, `failedKeepAlives`, `lobbyPublishFailures`,
`relinkAttempts` and `simsAlive`. A session that is stuck on a silent relink or a lobby that
stopped publishing is otherwise indistinguishable from a player who went away.

Note that the fork routes JUL through log4j, so these lines land on **stderr** (`.run/proxy.err.log`),
not `proxy.out.log`.
