# Troubleshooting

Failures in XMage Nexus belong to one of three tiers: the browser client, the WebSocket proxy, or the XMage server. This page matches each message to its tier, cause, and fix. Start with the tier that failed first; proxy and server faults look alike on the connect screen.

> **Who this is for:** players on the connect screen or the board, operators running a proxy, and developers running the local test layers.

## Find the failing tier

| What you see | Tier to check | First action |
|---|---|---|
| "Could not connect to WebSocket proxy" | Proxy or the network path | Check proxy process, host, port, scheme |
| "The proxy refused the connection: …" | Proxy access gate | Check token, name, target |
| "Login failed: invalid credentials or server unavailable" | Server or credentials | Check name length, password, target, version |
| Lobby works, table actions fail | Session or server | Reconnect; a self-hosted stack may need a restart |
| Board stops updating | Client-to-proxy link or server | Check the banner, reload; restart a self-hosted stack |

## Sign-in and proxy problems

### The client cannot reach the proxy

The error box reads **"Could not connect to WebSocket proxy"**.

The Proxy field points at no running proxy, the wrong port, or the wrong scheme. The proxy's HTTP port is its WebSocket port plus one by default (8787 for WebSocket, 8788 for HTTP).

- Confirm the process: `curl http://<proxy-host>:8788/health` returns a body with `ok: true`.
- Open `http://<proxy-host>:8788/index.html`. If the proxy's own test page loads, the process is up and the address is wrong.
- Match the scheme to the page: an `https://` page must use `wss://`, or the browser blocks the socket as mixed content.
- A proxy started with defaults binds only `127.0.0.1`. To reach it from another machine, start it with `--bind 0.0.0.0` and allow the port through the firewall.
- A reverse proxy or tunnel must forward the WebSocket upgrade, not only plain HTTP.
- A close with code `1008` and the log line `ws rejected origin=…` means the browser origin is not allowed. Start the proxy with `--allowedOrigins https://example.com`, using the exact origin players load. Without that flag only localhost origins are accepted.

### "The proxy refused the connection"

The message names a reason. The usual one is a missing or wrong auth token: the client receives `Bad or missing auth token` and the socket closes with code `4401`. Paste the token from the operator into **Auth token**. It is kept for the tab and survives a reload, but a rejected connection is not retried automatically.

It also covers a name held by another connection and a disallowed target. Fix the field the reason names.

### "Login failed: invalid credentials or server unavailable"

Check these in order:

1. **Username length.** The server accepts at most 14 characters and answers `User name may not be longer than 14 characters`. A saved or pasted name can exceed the form's limit. The log line `Can't receive server state before other data` is a symptom of any refused login, not a separate handshake bug.
2. **Password.** The public server does not check passwords; the field is disabled and its value ignored. A private server with authentication enabled needs the password of an existing account.
3. **Target.** The **XMage Server** field is the host the *proxy* dials, port 17171 by default. **Local** means localhost from the proxy's machine, not from your browser.
4. **Server state.** A freshly started proxy answers `WARMING_UP` while it builds its card database; see [Proxy is ready but logins fail](#proxy-is-ready-but-logins-fail).
5. **Version.** A refused release is reported as a version mismatch, described below.

### "That account is still connected on the server"

The server still holds the previous session for that name: a second tab or device through a different proxy, a tab closed within the leave grace period, or a proxy restarted without its restore-id store. The server frees it within about a minute. Wait, then retry once. Use **Disconnect** instead of closing the tab when handing an account to another device; through one proxy, a second window attaches to the live session.

### The banner says the proxy connection was lost

The banner reads **"Connection to proxy lost — reconnecting…"**. The client reconnects by itself: it probes an idle socket after 15 seconds, drops it when no frame arrives within 10 seconds, and retries with a backoff capped at 10 seconds. A reload or a network change re-attaches to the session, which is kept for 180 seconds after the last socket closes, or 45 seconds when the page announced that it was closing.

Wait for the banner to clear. If it loops, check `/health` and the network path, then reload once. The board state and the open prompt are replayed on re-attach, so a mid-game reload is safe.

### "This account was logged in somewhere else"

Another login for the same name took the session, and the server disconnected the older instance. Log in again to take it back, and use one window per account while playing.

### Proxy is ready but logins fail

`/health` answers `200` as soon as the process is up, while `/ready` answers `503` until the card database is `READY`. A proxy whose card database failed still accepts sockets, so the login fails with a generic error. Wait for `/ready`, and restart the proxy if `cardDb` reports `FAILED`; the database is rebuilt on start.

## Server version mismatch

The error reads, with the two release strings filled in: **"The XMage server now runs {server} and this proxy still speaks {proxy}, so the server refuses every login through it."**

XMage enforces an exact release match. The public server moves to a new upstream release quickly and refuses older clients, so a proxy built against the previous release cannot log anyone in until it is rebuilt.

| Your setup | Fix |
|---|---|
| Hosted proxy | Wait for the operator to update it, or point Proxy at another proxy. The desktop app with its own stack is unaffected. |
| Self-hosted proxy | Update the engine checkout, rebuild the proxy, then restart the whole stack. |
| Mixed local stack | Rebuild server, plugins, and proxy together; remove versioned plugin jars from the previous release. |

Retrying does not help; the proxy must be rebuilt against the server's release. Operators can run `node scripts/check-upstream-release.mjs` on a schedule to see a newer upstream tag early.

## Deck and table problems

| Message or symptom | Cause | Fix |
|---|---|---|
| "That printing (set/number) does not exist" | The server matches by set code and collector number, not by name, and this pair is absent | Use a suggested printing, auto-resolve, or remove the card |
| "Not implemented on the server" | No printing of that card exists in this release | Replace or remove it |
| The server will load another card instead | The set/number belongs to a different card | Pick a correct printing from the suggestions |
| "XMage (validator) reports this deck illegal" | Deck size, banned list, copy limits, commander pair, color identity | Read the group and message, then fix the deck |
| "Your quit ratio is higher than the table requirement" | Your quit rate is above the table's **Allowed quit %** | Join a table with a higher allowance |
| "You have too many tables not started (max 2)" | Two unstarted tables already belong to you | Start or delete one |
| "Your rating is below the table minimum" | The table filters by rating | Choose another table |
| "Table does not exist or has been closed" | The owner left before the start, or a filter hid it | Re-enter from your table card, or reset the filters |
| "This table is already full" / "Table password is incorrect" | The seat was taken, or the password is wrong | Pick another table, or ask the owner |

Deck validation in the client is advisory: it reports problems before you join, and you can apply the suggested printings, accept a substitution, or remove the cards. The server is the final judge, so a deck it rejects still fails at join.

## Card images, art, and sound

**A card shows its text placeholder instead of art.** Images resolve from an index shipped with the client and load from the Scryfall image CDN. A card missing from the index — a very new printing or an unusual token — has no URL, and there is deliberately no live API fallback. Check that the browser can reach `cards.scryfall.io`; a blocked CDN leaves every card as a placeholder.

**Art appears late on the first game.** Images load from the CDN on demand and are cached by the browser afterwards.

**No sound.** Browsers keep audio locked until the page receives a click or key press. Click once inside the client, then check the master and SFX sliders and the system output device.

## The board looks frozen

Decide first whether the game waits for you. If the action button glows or a prompt is open, it waits for your decision. If the opponent is thinking, the board can stay unchanged for a long time; XMage sends a view when the board changes, so a quiet turn is normal.

If nothing changes for minutes and no prompt is open, check the connection banner. Reload once: the proxy replays the last state and the open prompt. Do not log out; a logout releases the session and can remove you from the table.

On a long-lived local stack, games can start freezing after a few hours. Orphaned sessions and finished matches clog the server's callback channel, and the board never receives another view. Run `node scripts/ctl.mjs restart all` before investigating further.

For large boards — ten-player free-for-all, token-heavy decks — set **Card style** to Compact and turn **Animation effects** off in Settings.

## Launcher problems

The launcher starts a bundled server and proxy and shows a splash state while it works. Its data directory holds `logs/bootstrap.log`, `logs/server.log`, `logs/proxy.log`, and the previous run of each as `*.previous.log`. Set `NEXUS_DATA_DIR` to move that directory.

| Splash error | Cause | Fix |
|---|---|---|
| `ERR_SERVER_START` | Port 17171 is busy, or the server crashed | Quit other Nexus or dev-stack processes; read `server.log` |
| `ERR_PROXY_START` | The proxy could not open 8787/8788 | Read `proxy.log`; check the ports |
| `ERR_WARMING` | The card database did not finish preparing | Retry; allow more time on a slow disk |
| `ERR_OFFLINE` | First run with no network and no components | Connect to the network and retry |
| `ERR_INCOMPLETE` | The downloaded runtime is missing files | Remove the incomplete release folder and start again |
| `ERR_MAC_INTEL` | The build supports Apple Silicon only | Use an arm64 Mac, or the browser client |
| `ERR_PLATFORM` | No build for this OS or architecture | Use a supported platform |
| Update failed | The download was interrupted or blocked | Retry; the installed release keeps working |

It checks for updates once a day and continues offline when the check fails, provided a complete component set is installed.

**The launcher and the dev stack compete for the same ports.** Both want 17171 and 8787. A background copy of the desktop app usually blocks `ctl.mjs start`.

## Port conflicts

| Port | Used by |
|---:|---|
| 17171 | XMage server |
| 8787 | Proxy WebSocket |
| 8788 | Proxy HTTP page and endpoints |
| 5173 | Vite dev server |
| 8789 | Fake server for E2E runs |
| 5175 | Vite for fake E2E runs |
| 8790 | Status dashboard (LAN only) |
| 8797 / 8798 | Second proxy flavor (WebSocket / HTTP) |

Only one process can own a port. `ctl.mjs status` reads pid files, not sockets, so a stale `.run/*.pid` makes a dead process look alive. Find the real owner with `ss -ltnp` on Linux or `lsof -i :<port>` on macOS, then stop and start the stack with `ctl.mjs`.

Fake E2E runs never use 8788; that port belongs to the real proxy. A port conflict in fake mode means a real stack is still up.

## Test runs: fake and real

These failures belong to the developer workflow; commands live in [Commands](commands.md), the layers in [Testing](../developer-guide/testing.md).

| Symptom | Cause | Fix |
|---|---|---|
| `Proxy is still loading card data` | The scripts started before readiness | Wait for `/ready`; check `cardDb` |
| `self-test` or `verify` fails with missing views after hours | Stale stack: over an hour old or many sessions | `node scripts/ctl.mjs restart all` |
| A real-mode spec waits for a player type that is not offered | Real mode targets the public server unless `E2E_SERVER_HOST` is set | Run with `E2E_BACKEND=real E2E_SERVER_HOST=localhost` |
| `BindException: Address already in use` after a restart | The old proxy still holds 8787 while the new one answers HTTP | Wait for the ports to go down, then restart all |
| `WATCHGAME` never arrives on the first cold-start game | The server lost the callback return socket | Run the warm-up, or retry once on a warm server |
| A spec times out clicking the board | A viewer latched open covers the target | Close the info window first |
| Sessions and threads climb across a layer | A script exited without disconnecting | Restart the proxy; keep one `disconnect` per script |

Abandoned browser-run tables also consume server game threads. `node scripts/clean-tables.mjs player` removes the tables owned by that account.

## Browser support

The web client targets current evergreen browsers: Chrome, Edge, Firefox, and Safari. It needs WebSocket, IndexedDB, and the Web Audio API. The desktop app renders in the platform webview — WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux — so a Safari-class engine is a real target.

There is no service worker, so the web client cannot start offline and a reload needs the host. In a private window, storage can be unavailable and decks and settings fall back to memory for that session. Phones can load the client, but the board assumes a desktop viewport, hover previews, and keyboard shortcuts.

## Related

- [Play in your browser](../getting-started/play-in-browser.md)
- [Deployment](../operator-guide/deployment.md)
- [Commands](commands.md)
- [Ports](ports.md)
- [Testing](../developer-guide/testing.md)
- [FAQ](faq.md)
