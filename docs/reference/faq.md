# Frequently asked questions

Direct answers to the questions players, hosts, and contributors ask before or while using XMage Nexus. Each answer states the current behavior and points to the page that covers it in depth.

> **Who this is for:** anyone deciding whether Nexus fits their use, from a first-time player to someone planning to host a server.

## What is XMage Nexus?

A web and desktop client for XMage. The browser interface, a Java WebSocket proxy, and the XMage rules engine work together: the proxy translates between JSON over WebSocket and the XMage protocol, and the engine applies the rules and owns the cards. Nexus is a client, not a new game or a new rules engine.

## Is it free?

Yes. The client and proxy are released under the MIT License, and the XMage engine is MIT as well. There is no subscription, store, or paid tier. If you host a server or a proxy, you pay only for the machine, the tunnel, and the bandwidth you use.

## Do I need to install anything to play?

Not for browser play. Open a hosted instance, or a self-hosted page, enter a username, and connect. The browser needs a reachable proxy and, through it, a reachable XMage server. The desktop app is the installable option.

## Desktop app or browser: which should I use?

Use the browser to join a shared instance without installing anything. Use the desktop app when you want a local game: it bundles the Java runtime, an XMage server, and the proxy, starts them with one click, and updates itself. Once installed, local play against the AI works without a network; card images still come from the internet.

## Do I need Java on my machine?

No, for either client. The desktop launcher ships its own Java runtime, and browser play runs no Java locally. Java 17 is needed only to build the proxy and server from source, with Maven 3.9 and Node.js 20 or newer; running a prebuilt proxy needs a Java 17 runtime.

## Do I need an account?

On the public server, no. The name you type becomes your identity, and the server keeps your match record under it. A self-hosted server can enable authentication; then you need an account that server knows and its password. The public server does not check passwords and ignores the password field.

## Why is the username limited to 14 characters?

The XMage server rejects names longer than its default maximum of 14 characters, and the connect form enforces the same 14. A name pasted from elsewhere can still be too long, and the client then shows a generic login failure.

## Can I use the same account in two tabs?

Through the same proxy, yes: the second connection attaches to the live session, and both windows see the same game. Two different proxies cannot attach to one session. The server refuses the second login until the first session expires, which takes about three minutes.

## Can I play on a phone or tablet?

There is no mobile app. The web client loads in a phone browser, but the board is built for a desktop-sized viewport, with hover previews, drag targets, and keyboard shortcuts. A tablet in landscape is the closest fit; a phone is not suited to a full game.

## Can I play offline?

With the desktop app, yes, against the bundled server's AI and with no network. Card art still resolves from the Scryfall image CDN, so art the browser has not cached shows a text placeholder. The browser client cannot start offline: it has no service worker, and both the proxy and the server are remote.

## Can I play against the computer?

Yes, on a server that offers AI seats. The XMage server provides its own bot player types, including a rules-based AI, a Monte Carlo AI, and a draft bot. The create-table seat picker lists exactly what the connected server advertises; a local server offers more than the public one.

## Which formats can I play?

Constructed formats (Standard, Modern, Pioneer, Legacy, Vintage, Pauper), Commander, booster draft and sealed, and Swiss or bracket tournaments. Free-for-all tables are available as well. Two-Headed Giant appears in some inherited XMage documentation, but the server's game-type list has no two-headed entry, so it cannot be created. The format list comes from the connected server, so a custom server may offer more or fewer.

## How many players fit at one table?

A duel seats two players. Free-for-all supports three to ten seats. Draft pods are built for eight players, or four in a smaller pod. Sealed events use the same tournament flow with a 40-card build.

## Is there matchmaking or a ranked queue?

No. Nexus has no matchmaking queue and no ranked ladder. You create a table or join one from the lobby, optionally with a password, a format, and a rating minimum. The leaderboard shows the match statistics the server reports for players in the room.

## Can I play against an LLM?

Only on a server built with the LLM player plugin and advertising an LLM seat; the public XMage server does not. On such a server you pick the seat type, then set a provider endpoint and an API key for that seat. The key stays in the browser and never reaches the server. A seat without an endpoint falls back to the deployment default and fails if the deployment serves none.

## Where are my decks stored?

In this browser's IndexedDB, not on the server, until you submit a deck to a table. Another browser, another profile, or cleared site data starts empty. Export a backup JSON from the Decks view before clearing browser data, and restore it from the same view.

## Can I import a deck from Moxfield or Archidekt?

Yes. Paste a Moxfield or Archidekt deck URL, or paste a plain text list; `.dck` files and Arena exports also import. Export supports plain text, `.dck`, and Arena format. The builder normalizes the set and collector number of each entry and flags printings the server would reject.

## Which languages does the client support?

Nine interface languages: English, Spanish, German, French, Italian, Japanese, Portuguese, Russian, and Simplified Chinese. Card text has its own language setting, so the interface and the cards can differ.

## Can I spectate or watch replays?

You can spectate a live table from the lobby. Replays depend on the server: a stock XMage server does not save games, while a server that persists them exposes a replay viewer with stepping and, where supported, seeking. The History panel also lists saved `<uuid>.game` files that the proxy can read.

## What does the proxy see and store?

The proxy sees the traffic it forwards: logins, lobby actions, table lifecycle, and game actions. Its activity log records connection events, login results, and lifecycle actions, and deliberately omits passwords, chat text, and deck contents. Your decks, settings, language, and saved connection stay in the browser.

## Who runs the server I play on?

It depends on the instance. A hosted page is run by whoever publishes it, the official XMage server is run by the XMage project, and a local stack is run by you. The client connects wherever the Proxy and XMage Server fields point, and it does not choose a server for you.

## Can I host a server for my friends?

Yes. Run one proxy and serve the static web build, or let the proxy serve it; players then need only a browser. A tunnel or reverse proxy exposes it beyond your network, and TLS is required for a secure page. The operator guide covers ports, configuration, and deployment.

## Is Nexus affiliated with Wizards of the Coast?

No. XMage Nexus is an independent client, not affiliated with or endorsed by Wizards of the Coast or Scryfall. Magic: The Gathering, its mana symbols, card names, and card artwork are trademarks or copyrights of Wizards of the Coast. Card images and data come from Scryfall under the Wizards Fan Content Policy.

## How do I report a bug or contribute?

Open an issue on the project repository, or use **Export diagnostics** in the client to attach recent frames and logs to a report. The contributing page describes the workflow, the test layers to run, and the English-only rule for code, comments, and documentation.

## Related

- [Troubleshooting](troubleshooting.md)
- [Overview](../getting-started/overview.md)
- [Play in your browser](../getting-started/play-in-browser.md)
- [Deployment](../operator-guide/deployment.md)
- [Glossary](glossary.md)
