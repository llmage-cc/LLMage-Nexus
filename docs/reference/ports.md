# Ports

A Nexus deployment is an XMage server, a proxy that bridges browsers to it, and a static web client the proxy serves. Development adds a Vite dev server and, for browser tests, a fake server. The defaults are ordinary, but mixing them up is the most common reason a local stack "starts" and then refuses every connection. This page lists every default port, what listens on it, who connects, and how a conflict shows up.

> **Who this is for:** An operator opening firewall rules, or a developer whose stack will not bind.

## Port map

| Port | Protocol | Process | Default source | Who connects |
|---|---|---|---|---|
| `17171` | TCP | XMage server | XMage's own server port; the proxy's `--port` default | The proxy (outbound). Browsers never connect here directly. |
| `8787` | WebSocket | Proxy gateway | `--wsPort` | The web client. |
| `8788` | HTTP | Proxy HTTP server | `--httpPort` | The web client's static files, health probes, and admin tools. |
| `5173` | HTTP | Vite dev server | `web/vite.config.ts` | Your browser during development. |
| `5175` | HTTP | Vite for fake browser tests | Playwright config, fake mode | Playwright only. |
| `8789` | WebSocket | Fake XMage server | Fake fixture default | Playwright, or the standalone fake playground. |
| `8790` | HTTP | Optional status dashboard | `STATUS_PORT` | A browser on the local network. |
| `8797`, `8798` | WebSocket, HTTP | Optional second proxy instance | Packaging config | The web client configured for the alternate server build. |

## What each port carries

### 17171 — the XMage server

The XMage server listens for game clients. In a Nexus deployment its only client is the proxy, which opens one XMage session per browser session. The browser never dials 17171: the login form sends the server host and port to the proxy over the WebSocket, and the proxy makes the TCP connection.

That direction matters for firewalls. A remote XMage server must be reachable **from the proxy host**, not from the player's browser. The browser only needs the proxy's WebSocket and HTTP ports.

### 8787 — the proxy WebSocket gateway

Every browser action travels here as JSON: connect, lobby, table, deck, game commands, replay commands. One WebSocket connection equals one XMage session — except a reconnect or second tab, which attaches to the existing one — and each session carries its own target server, so a single proxy can serve several players connected to different servers.

By default the gateway binds to loopback. Exposing it means passing a non-loopback `--bind` and listing the public page origin in `--allowedOrigins`; without that list, only localhost origins are accepted.

### 8788 — the proxy HTTP server

The same proxy process serves HTTP on the next port. It carries:

| Path | Purpose |
|---|---|
| `/`, `/index.html` | Static files from the proxy's `--webDir`: the built web client, which is what a container serves. |
| `/health` | Liveness. Answers while the process is up and reports whether the card database is ready, plus session, thread, and uptime counts. |
| `/ready` | Readiness. Returns success only after the card database finishes building. Start-up scripts and load balancers wait for this. |
| `/config` | Pre-connect information for the login form: whether an auth token is required, the pinned target and whether it is hidden, the deployment name, and whether the model relay is on. Always served, never admin-gated. |
| `/admin/status` | Session detail for operators. Registered only when an admin token is configured. |
| `/llm-relay` | Same-origin relay for model calls. Registered only when the relay flag is on; otherwise the path returns not found. |
| `/replay-file/<uuid>.game` | Download of a saved replay from the configured replay directory. |

`/health` and `/ready` are unauthenticated and carry no session data. Static files and `/config` are safe to expose with the WebSocket; `/admin/status` is not.

### 5173 and 5175 — Vite

`5173` is the development server for the React client. It proxies nothing: the page it serves opens its WebSocket to the proxy (8787 by default), and the proxy connects to the XMage server. `5175` is the same dev server started by Playwright in fake mode, on a dedicated port with strict binding so a test round can never reuse your open dev server.

### 8789 — the fake server

The fake backend used by browser tests speaks the same WebSocket protocol but runs entirely in Node, with no Java, no proxy, and no XMage server. Each test starts its own instance on a dynamic port, so the fixed `8789` only matters for the standalone fake playground and for any tool that assumes the default.

Keep 8789 away from 8788. The real proxy owns 8788 whenever the stack is up, and a fake server configured onto that port would collide with it.

### 8790 — the optional status dashboard

The repository includes a small LAN-only status service that reads the host's service journal and shows players online, game history, logs, and host metrics. It listens on `STATUS_PORT` (default 8790) and accepts only clients inside `STATUS_ALLOW`; loopback is rejected on purpose, because the service is meant to be reached from the local network and never through a public tunnel. It pings the proxy's HTTP endpoint for a latency figure but reads no session data from it.

### 8797 and 8798 — a second proxy

A deployment that serves two XMage server builds can run a second proxy instance with its own card database, on `8797` for WebSocket and `8798` for HTTP. The packaging step assigns those ports to the second instance, and the web client selects it through a build-time default. A single-server deployment never opens these ports.

## Changing a port

The proxy takes every port as a flag:

```bash
java -jar Mage.Proxy/target/mage-proxy-<version>.jar --host <server-host> --port 17171 \
  --wsPort 8787 --httpPort 8788 --bind 127.0.0.1 --webDir ./web
```

The container image maps the same values through `XMAGE_HOST`, `XMAGE_PORT`, `WS_PORT`, `HTTP_PORT`, and `BIND`. If you change the WebSocket port, change the client's default too, either at build time with the `VITE_DEFAULT_PROXY_HOST` and `VITE_DEFAULT_PROXY_PORT` variables or at run time in the login form. The same applies to the XMage server fields (`VITE_DEFAULT_SERVER_HOST`, `VITE_DEFAULT_SERVER_PORT`).

Other processes have their own switches:

| Process | Switch |
|---|---|
| Vite dev server | `npm --prefix web run dev -- --port <port>`, add `--strictPort` to fail instead of moving to the next free port |
| Playwright dev server | `E2E_PORT` |
| Fake playground | `FAKE_PORT` |
| Status dashboard | `STATUS_PORT`, `STATUS_BIND` |

## Conflict symptoms

| Symptom | Likely cause | Fix |
|---|---|---|
| Proxy log shows `BindException: Address already in use`, but the process stays up and `/ready` answers | The WebSocket port belongs to another process, often a previous proxy still shutting down. The HTTP server bound, the WebSocket server did not. | Stop every stack on the machine, confirm the port is free, then start again. Restarting only the proxy is not enough if the old process still holds the port. |
| Clients connect to the page but every WebSocket attempt fails | Same as above: 8788 is served by the new process, 8787 by the old one. | Check the listener on 8787, not only the page on 8788. |
| Two checkouts behave inconsistently, tests hit the wrong game | Two stacks share the same default ports. Ports are machine-wide, not per checkout. | Run one stack at a time, or give the second one different ports and matching client defaults. |
| Vite prints a URL with 5174 instead of 5173 | 5173 was busy, and the dev server moved to the next free port because strict binding is off. | Open the printed URL, or stop whatever owns 5173. |
| Playwright fails before any test with a port-in-use error | The fake round uses strict binding on 5175, so it refuses to move. | Stop the process on 5175, or set `E2E_PORT` for this round. |
| `dev.mjs` waits and then reports the XMage server did not start | 17171 is occupied, or the server died during start-up. | Read the server log; if another server owns the port, stop it or point the proxy elsewhere. |
| `docker compose up` fails with "port is already allocated" | A local stack already holds 8787 or 8788. | Stop the local stack, or change the published ports in the compose file. |
| Login fails with a version mismatch | The proxy reached an XMage server of a different release than the one it was built against. Not a port conflict, but often caused by pointing 17171 at the wrong server. | Point the proxy at the intended server and rebuild if its release differs. |
| Connections are refused right after start, and the client shows "Preparing card database…" | The port is open but the proxy is still building its card database. `/health` answers, `/ready` does not. | Wait for `/ready`, or run the warm-up script. |

## Diagnosing

Start with the stack's own view, then confirm at the socket level:

```bash
node scripts/ctl.mjs status
node scripts/tail.mjs proxy 40
curl -s http://127.0.0.1:8788/health
curl -s http://127.0.0.1:8788/ready
curl -s http://127.0.0.1:8788/config
```

On Linux, list the listeners:

```bash
ss -ltnp | grep -E ':(17171|8787|8788|5173|5175|8789|8790|8797|8798)\b'
```

On macOS, the equivalent is:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

A healthy local stack shows three processes: the server on 17171, the proxy on 8787 and 8788, and Vite on 5173. `/ready` must report the card database as ready before any game test will pass, even when every port is open. A process that listens on only one of the proxy's two ports is the signature of a half-dead proxy; stop it and start the stack again rather than restarting a single component.

## Related

- [Deployment](../operator-guide/deployment.md)
- [Configuration](../operator-guide/configuration.md)
- [Commands](commands.md)
- [Troubleshooting](troubleshooting.md)
