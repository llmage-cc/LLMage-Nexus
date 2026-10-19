# Configuration

This page lists every setting that changes how `Mage.Proxy` and the web client behave: command
line flags, their environment equivalents, the deployment gates that turn a localhost proxy into a
public service, and the build-time variables baked into the web bundle.

> **Who this is for:** an operator who needs to change proxy or client behaviour without editing
> source code.

## How settings are read

The proxy takes `--key value` pairs. Parsing is strict: a trailing `--key` with no value stops
startup, and a value that begins with `--` is rejected instead of silently becoming the next
flag's value. Typos surface at boot, not at the first login.

One setting resolves from the environment when the flag is absent, because a flag puts its value in
the process command line:

| Flag | Environment fallback |
|---|---|
| `--authToken` | `MAGEPROXY_AUTH_TOKEN` |

The Docker image is the exception: its entrypoint maps container environment variables onto a
fixed set of flags, so you configure it with variables rather than arguments.

Startup validation is fail-fast. `--hideServerTarget true` without a pinned target refuses to
start, and so does a malformed `--pinnedXmageTarget`. Both would otherwise produce a proxy whose
connect form has no usable target.

## Network and files

| Flag | Default | Effect |
|---|---|---|
| `--host` | `beta.xmage.today` | Target XMage server used when a `connect` frame omits a host |
| `--port` | `17171` | Target XMage server port |
| `--wsPort` | `8787` | WebSocket gateway port |
| `--httpPort` | `8788` | HTTP port: web client, `/config`, `/health`, `/ready`, `/admin/status` |
| `--bind` | `127.0.0.1` | Interface for both ports. Set `0.0.0.0` to accept remote connections |
| `--webDir` | `web` | Directory served as the web client, resolved against the working directory |
| `--allowedOrigins` | empty | Comma-separated exact browser origins. Empty allows localhost origins only |
| `--username` | empty | Login name used when a `connect` frame omits one |
| `--password` | empty | Password handed to proxy-side SIM seats; browser logins carry their own |

Binding is loopback by default. A proxy started without `--bind` answers only on the same machine,
which is why a container or a reverse proxy deployment has to set it explicitly.

## Deployment gates

These settings decide what a public visitor can see and do. The web reads the result from
`GET /config` before it renders the login form, and the WebSocket gate uses the same resolved
object, so the form and the enforcement can never disagree.

| Flag | Default | Effect |
|---|---|---|
| `--authToken` | empty (open) | Shared secret every `connect` must present, including a reload's re-attach |
| `--pinnedXmageTarget` | empty | `host:port` forced on every connect; the client's host and port are ignored |
| `--hideServerTarget` | `false` | Hides the server fields; requires a pinned target or the proxy refuses to start |
| `--deploymentName` | `XMage Nexus` | Branding string used in the page title |
| `--adminToken` | empty | Bearer token for the read-only `GET /admin/status` endpoint |

`GET /config` is always served, never admin-gated (the pre-connect probe has no token yet), and
sent with `Cache-Control: no-store`:

```json
{"authRequired":true,"hideServerTarget":true,"pinnedTarget":"<server-host>:17171",
 "deploymentName":"XMage Nexus","llmRelay":false}
```

**Auth token.** When set, a missing or wrong token answers a typed `connect_error` and closes the
socket with code `4401`, which tells the browser not to retry. Empty means open — the localhost
default. Prefer the `MAGEPROXY_AUTH_TOKEN` environment variable over the flag on a shared host.

**Pinned target.** A pin wins over the client's values for the dial, for the account key, and for
attach matching, so a client cannot reach a different server by editing the form. Without a pin the
client's host and port are dialled unchanged, which is what makes a single proxy able to serve
several servers.

**Two tokens, two jobs.** `--authToken` gates players. `--adminToken` exposes a read-only
`GET /admin/status` endpoint for monitoring. They are independent; setting one does not set the
other.

> **Reaching `/config` matters.** If the browser cannot reach the HTTP port, the probe degrades to
> defaults — no token field, no pinned target — and a token-protected proxy rejects every login.
> Serve the page from the proxy, or bake `VITE_PROXY_HTTP_BASE` to a reachable base URL.

## Origin policy

`--allowedOrigins` is an exact-match allowlist, not a pattern list. With a value set, only those
strings are accepted; with the flag empty, the proxy accepts origins whose host is `localhost`,
`127.0.0.1`, `::1`, `tauri.localhost`, or `ipc.localhost` (the desktop shell), plus connections
that carry no `Origin` header at all (command-line clients and the test harness).

```bash
--allowedOrigins https://nexus.example.com,https://beta.example.com
```

A rejected handshake closes with code `1008` and logs `[proxy] ws rejected origin=...`. Include
the scheme and omit the trailing slash; `https://nexus.example.com/` does not match.

## LLM endpoints and the relay

Model calls are restricted by host allowlist, and an empty allowlist rejects every endpoint.

| Flag | Default | Effect |
|---|---|---|
| `--allowedModelHosts` | `localhost,127.0.0.1,::1` | Hosts an LLM seat may point its endpoint at |
| `--llmRelayEnabled` | `false` | Registers `POST /llm-relay` on the HTTP port for browser-side provider calls |

The allowlist is also applied to `fetchModels` requests and to the relay target. Cloud metadata
hosts are refused regardless of the list. When the relay is off the route is not registered at
all, so it answers `404`.

The relay is a byte pipe for client-key seats whose provider does not send CORS headers. It
forwards only `authorization`, `content-type`, `accept`, `x-api-key`, `anthropic-version`,
`anthropic-dangerous-direct-browser-access`, and `x-opencode-session`; it never reads, logs, or
stores the authorization header or the body; it refuses `http` except for loopback addresses and
does not follow redirects. Request bodies are capped at 4 MiB, responses at 16 MiB.

## Session timing

| Flag | Default | Effect |
|---|---|---|
| `--graceSecs` | `180` | How long a session survives after its last socket closes |
| `--leaveGraceSecs` | `45` | Shorter grace when the page announced it was closing |
| `--relinkSecs` | `600` | How long the proxy keeps re-logging a session in after losing the server |

The grace period is what makes a reload, a network switch, or a phone going to the background
survive. The leave grace applies when the page sent `leaving` on unload, so an opponent waits 45
seconds instead of three minutes for a player who closed the tab. `--leaveGraceSecs` is clamped to
`--graceSecs`.

## Storage paths

| Flag | Default | Contents |
|---|---|---|
| `--replayDir` | `saved` | Saved `<uuid>.game` replays and `<uuid>.json` sidecars, resolved against the working directory |
| `--reportsDir` | `reports` | Player-submitted issue reports, one JSON file per report |
| `--restoreIds` | `<tmp>/mage-proxy-restore-<wsPort>.json` | Per-account session ids, so a re-login after a deploy takes the old session back |
| `--simRoster` | `<tmp>/mage-proxy-sims-<wsPort>.json` | SIM seat roster (development only) |

`none` disables `--restoreIds` or `--simRoster`. The restore-id store drops entries older than ten
minutes, by which time the server has already released the user. The card database is not a flag:
it is written to `db/` under the working directory on first start and rebuilt whenever the engine
release changes.

Report storage is bounded so an unattended proxy cannot fill its disk:

| Flag | Default | Limit |
|---|---|---|
| `--reportMaxFileBytes` | `98304` | Per report (96 KB) |
| `--reportMaxBytes` | `67108864` | Total directory size (64 MiB) |
| `--reportMaxFiles` | `500` | Number of stored reports |
| `--reportMaxAgeDays` | `14` | Age before pruning |
| `--reportQuotaCount` | `5` | Reports accepted per session |
| `--reportQuotaIntervalSecs` | `30` | Minimum gap between two reports from one session |

## Message limits

| Flag | Default | Effect |
|---|---|---|
| `--maxMessageBytes` | `1048576` | Largest accepted WebSocket frame |
| `--maxMessagesPerSecond` | `100` | Per-connection inbound rate limit |

A board update frame is a few hundred kilobytes, so the default frame cap is generous; the rate
limit is what stops a runaway client from saturating the proxy.

## SIM kill switch

The proxy can drive simulated seats through its own WebSocket channel. This is a test-harness
feature, not a product one: the web client never offers a SIM seat, and bot seats in the product
use the server's native AI (`COMPUTER_MAD`, `COMPUTER_MONTE_CARLO`, `COMPUTER_DRAFT_BOT`).

| Flag | Default in release artifacts | Effect |
|---|---|---|
| `--sim` | `off` | `on` enables SIM seats and the roster restore |

> **Development/test only.** Keep `--sim off` on any deployment other players can reach. With the
> switch off, table creation rejects `playerTypes` containing `SIM` and no bot ever starts. The
> Docker image, the deployment bundle, and the launcher all leave it off; only the development
> stack turns it on.

## Web build variables

These are read at build time and baked into `web/dist`. Changing one requires a rebuild, not a
restart.

| Variable | Default | Effect |
|---|---|---|
| `VITE_DEFAULT_PROXY_HOST` | `localhost` | Proxy host or full `ws://`/`wss://` URL pre-filled on the login form |
| `VITE_DEFAULT_PROXY_PORT` | `8787` | Proxy port pre-filled on the login form |
| `VITE_DEFAULT_SERVER_HOST` | `localhost` | XMage server pre-filled on the login form |
| `VITE_DEFAULT_SERVER_PORT` | `17171` | XMage server port pre-filled |
| `VITE_DEFAULT_XDHS_PROXY_HOST` | empty | Second proxy flavour, if you run one |
| `VITE_DEFAULT_XDHS_PROXY_PORT` | `8797` | Second proxy flavour port |
| `VITE_PROXY_HTTP_BASE` | derived | Overrides the base URL used for the `/config` probe |
| `VITE_LOCK_DEPLOYMENT` | off | Removes the server choice and always connects to the baked target |
| `VITE_BUNDLED_DECKS` | on | Ships the built-in starter decks and deck corpus |
| `VITE_SIM_SEATS` | off in production builds | Offers SIM seats in the create-table dialog (development only) |
| `VITE_SHOW_REPLAY_DIR` | off | Shows the replay directory path in the replay panel |

A hosted build normally sets the connection defaults so players only type a name and password. If
you also set `VITE_LOCK_DEPLOYMENT=1`, a stale saved connection or a `?server=` deep link cannot
point the client at another server.

The `/config` probe URL is derived from the proxy host and port: `http`/`https` on `port + 1`, or
the page origin itself when the page is HTTPS and the socket port is `443`. Set
`VITE_PROXY_HTTP_BASE` only when that derivation cannot work — for example a static host on one
domain and a proxy on another.

## Launcher settings

The desktop app reads its own environment variables at start: `NEXUS_DATA_DIR` (data root),
`NEXUS_MANIFEST` (component manifest URL or file), `NEXUS_TARGET` (platform tag), and
`NEXUS_SERVER_PORT`, `NEXUS_WS_PORT`, `NEXUS_HTTP_PORT` (port overrides). They exist for testing
and for unusual layouts. Normal installs need none of them. See
[Desktop launcher](desktop-launcher.md).

## Common combinations

| Situation | Settings |
|---|---|
| Local development | defaults; `--bind 127.0.0.1`; the development stack turns SIM on, a plain proxy start leaves it off |
| LAN play | `--bind 0.0.0.0`; `--allowedOrigins http://<host>:8788`; publish the ports |
| Public behind TLS | `--bind 127.0.0.1`; `--allowedOrigins https://nexus.example.com`; `--authToken` from the environment |
| Public, one server only | the above plus `--pinnedXmageTarget <server-host>:17171 --hideServerTarget true` |
| Client-key LLM seats | `--allowedModelHosts <provider-host>`; `--llmRelayEnabled true` if the provider lacks CORS |

## Related

- [Deployment](deployment.md)
- [Operations](operations.md)
- [Desktop launcher](desktop-launcher.md)
- [Proxy](../developer-guide/proxy.md)
- [Commands](../reference/commands.md)
