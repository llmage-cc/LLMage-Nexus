# Settings reference

The settings dialog groups the client options into five sections. This page is the exhaustive table: the exact label you see, the value the client starts with, what the option changes, and the storage key that keeps it. The player guide tours the dialog; this page is for exact lookups.

> **Who this is for:** A player looking up an exact option or default, or an operator checking what the client stores on a device.

## Where settings live

- **Settings dialog.** Open it from the login screen, the lobby, or the game screen. The left rail has Language, Interface, Board, Sound & effects, and Gameplay.
- **In-game menu.** The ⋯ menu repeats the mana-payment switches, the auto-answer list, and the choice-memory list, so you can change them without leaving a game.
- **Player context menu.** The hand-request permission lives here, not in the settings dialog.

Most settings are stored per browser profile, on the device. Gameplay preferences also travel to the server: when a game starts, the client sends phase stops, mana-payment switches, and auto-answers; the hand-request permission is sent when you change it.

## Language

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Language | The browser language when it is one of the nine supported; otherwise English | Language of buttons, menus, dialogs, and help text. Changing it re-renders the interface without a reload. | `nexus_lang` |
| Card language | English | Language used when the client fetches card names and rules text. The localized name is what the card tile shows; the original name stays in the card's hover title. | `nexus_card_lang` |

The interface supports Spanish, English, German, French, Italian, Portuguese, Russian, Japanese, and Simplified Chinese. Card data supports the same nine.

## Interface

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Interface size | 100 percent | Scales the whole interface. The stepper moves through 90, 100, 115, 130, and 150 percent and then in 10 percent steps, clamped to 50–200 percent. `Ctrl`/`Cmd` + `+`, `-`, and `0` change the same value. | `mage-web-appearance` |
| Automatic CJK boost | On | Adds 15 percent on top of the chosen scale when the interface language is Japanese or Simplified Chinese. The switch is disabled in every other language. | `mage-web-appearance` |

The scale is applied as a CSS zoom on the document root, so dialogs, cards, and the board grow together. A manual scale and the CJK boost stack: 150 percent plus the boost renders at roughly 172 percent.

## Board

### Layout

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Board Layout (default) | Standard | Standard shows one opponent at a time, Pod (2×2) shows every opponent in a grid, Arena gives your own battlefield the full width. | `mage-web-appearance` |

Picking a layout pins it. Until you pick one, Standard switches to Pod automatically when a game has two or more opponents, and Arena falls back to Standard in a duel. A game with more than four players always uses Standard, because the other layouts cannot show that many seats.

### Card presentation

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Card style | Classic | Classic draws the full printed card. Compact draws an Arena-style art tile with name, type, and mana cost. | `mage-web-appearance` |
| Tapped cards | Sideways (90°) | Sideways turns a tapped permanent fully on its side. Tilted leans it 45 degrees instead. | `mage-web-appearance` |
| Rendered cards (readable text) | Off | Draws cards from their data instead of the printed image, keeping rules text sharp at any size. While it is on, Card style is fixed to the full card shape and the style buttons are disabled. | `mage-web-appearance` |
| Fit battlefield cards to the space | On | Makes permanents as large as the free space allows: a sparse board gets big cards, a crowded one shrinks them. | `mage-web-appearance` |

### Hand

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Hand as a column | Off | Shows the hand as a left-hand column with every card readable at once. Turning it on turns the row off. | `mage-web-appearance` |
| Hand as a scrollable row | Off | Shows full cards in a horizontal row with a slider instead of the fan. Turning it on turns the column off. | `mage-web-appearance` |
| Card width | 260 px | Width of the cards in the column or row. Range 120–460 px in 10 px steps. The control appears only while one of the two hand modes is on. | `mage-web-appearance` |

### Overlays and markers

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Cost symbols in hand | On | Adds mana-cost bubbles to hand cards. The printed cost is already on the image, so this is a second copy for readability. | `mage-web-appearance` |
| Power / toughness on the board | Always | Always draws the numeric badge on every creature; Only when changed shows it only while a creature is buffed or debuffed; Never removes it. | `mage-web-appearance` |
| Summoning sickness indicator | Corner clock | Corner clock marks a creature that cannot attack or use tap abilities with a small clock. Hourglass over the card dims the whole card instead. | `mage-web-appearance` |

### Cosmetics

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Playmat | Classic | Background of the battlefield. Arcane, Verdant, Tides, Ember, Dawn, and Abyss are static; Aurora drifts slowly; Your colours follows your commander or the colours on your board. Custom uses an uploaded image. | `mage-web-appearance`; a custom image also uses `mage-web-custom-playmat` |
| Card sleeve | Classic card back | Art shown on face-down cards: the official back, five built-in designs, or a custom upload. | `mage-web-appearance`; a custom image also uses `mage-web-custom-sleeve` |
| Your card images | Empty | Per-card art you upload, visible only to you. Stored as images, not as a setting; the manager lists the count and approximate size and can remove them all. | IndexedDB `xmage-custom-card-art` / `art` |

## Sound & effects

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Animation effects | On | Turns board animations on or off. | `mage-web-settings` |
| Speed | 1× | Animation speed: 0.5×, 1×, or 1.5×. | `mage-web-settings` |
| Sound effects | On | Master switch for game audio. Turning it off disables the volume sliders, the priority cue, and music. | `mage-web-audio` |
| Master volume | 80 percent | Overall output level, 0–100 percent in 5 percent steps. | `mage-web-audio` |
| Priority cue | Every prompt | Every prompt beeps on every server ask; On priority beeps only when priority arrives; Never is silent. | `mage-web-audio` |
| SFX volume | 80 percent | Level of game sounds relative to the master volume. | `mage-web-audio` |
| Music | On | Adaptive soundtrack that intensifies as a game gets close. Disabled while sound effects are off. | `mage-web-music` |
| Music volume | 35 percent | Music level relative to the master volume. The slider is disabled while music or sound is off. | `mage-web-music` |
| UI volume | 70 percent | Level of interface clicks and similar sounds. | `mage-web-audio` |

## Gameplay

### Automation preset

| Preset | What it sets |
|---|---|
| Simple (Arena style) | Smart stops on, automatic mana payment with smart tapping, no pool confirmation, and every phase stop off. |
| Balanced | Smart stops on, smart mana payment, pool confirmation on, and every phase stop on. |
| Manual | Smart stops off, automatic mana payment off, pool confirmation on, and every phase stop on. |

Choosing a preset writes its values into the settings below and records its name. Changing any value the preset owns (smart stops, hold priority, mana payment, phase stops) switches the label back to custom.

### Automation

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Hold Priority (Ctrl) | Off | Keeps priority after you cast a spell or activate an ability. Holding `Ctrl`, `Cmd`, or `Shift` while clicking a card does the same for one play. | Not stored; applies to the current session and is sent to the game when toggled |
| Smart stops | Off | Passes automatically unless you can play a land, cast a spell, activate an ability, or have a combat decision. Takes precedence over ordinary auto-pass. | `mage-web-smart-stops` |
| Auto-mulligan | Off | Answers the mulligan prompt with "keep" and answers the starting-player choice automatically. Spectators always behave this way. | Not stored; applies to the current session |
| Save game logs | On | Keeps the log of finished games on this device. The store holds the most recent 20 games. | `mage-web-game-log`; logs in IndexedDB `mage-nexus-game-logs` / `logs` |
| Browser notifications | On, when the browser supports them | Alerts you when your turn starts or a decision is needed while the tab is in the background. The first enable asks for browser permission; if permission is denied, the dialog says so. | `mage-web-browser-notifications` |

### Mana payment

| Setting | Default | Effect | Stored in |
|---|---|---|---|
| Pay automatically | On | When off, produced mana goes only to the pool and you click the mana symbols to pay. | `mage-web-mana-payment` |
| Pool mana needs manual use | On | Mana already in the pool when you start casting must be spent by clicking its symbols. | `mage-web-mana-payment` |
| Use first mana ability when tapping | Off | Taps a land using its first mana ability. | `mage-web-mana-payment` |
| Confirm passing with mana in pool | On | Asks before passing priority while your pool still holds mana. | `mage-web-mana-payment` |
| Smart mana payment | Off | Taps sources for you while keeping colors open for instants in hand. Clicking a source yourself takes over. | `mage-web-mana-payment` |

### Default phase stops

The grid has two rows, your turn and the opponent's turn, and seven stops per row: upkeep, draw, main 1, begin combat, end combat, main 2, and end step. Every stop starts on. These values apply when you join each game; changing a stop from the phase bar during a game affects that game only.

Stored in `mage-web-phase-stops`.

### Auto-answers and choice memory

| Item | Default | Effect | Stored in |
|---|---|---|---|
| Auto-answers | Empty | Rules that answer a repeated yes/no prompt automatically. You create them with the "Always answer like this" checkbox on a prompt; the list here shows the pattern, the answer, and a delete button, plus clear all. Rules are also sent to the server for the current game. | `mage-web-auto-answers` |
| Choice memory | Empty | Previously chosen answers for repeated named choices, offered again next time. Managed from the in-game ⋯ menu rather than the settings dialog. | `mage-web-choice-memory` |

## Settings outside the dialog

| Setting | Default | Where | Effect | Stored in |
|---|---|---|---|---|
| Allow hand requests: on | On | Player context menu | Lets other players ask to see your hand. Turning it off answers future requests with a refusal. | `mage-web-hand-requests` |
| Board layout pinned | Off | Set automatically when you choose a layout | Stops Standard from switching to Pod in multiplayer games. | `mage-web-appearance` |

## What the client stores

| Storage | Contents |
|---|---|
| `nexus_lang`, `nexus_card_lang` | Interface and card language. |
| `mage-web-appearance` | Layout, scale, CJK boost, card and tap style, hand mode, overlays, P/T badge, sickness marker, playmat, sleeve. |
| `mage-web-settings` | Animation effects and speed. |
| `mage-web-audio`, `mage-web-music` | Sound, music, volumes, priority cue. |
| `mage-web-mana-payment`, `mage-web-phase-stops`, `mage-web-smart-stops`, `mage-web-gameplay-preset` | Gameplay automation. |
| `mage-web-auto-answers`, `mage-web-choice-memory` | Learned prompt answers. |
| `mage-web-game-log`, `mage-web-browser-notifications`, `mage-web-hand-requests` | Log saving, notification permission, hand requests. |
| `mage-web-custom-playmat`, `mage-web-custom-sleeve` | Uploaded images as data URLs. |
| IndexedDB `xmage-custom-card-art` | Per-card custom art. |
| IndexedDB `mage-nexus-game-logs` | Saved game logs, capped at 20. |
| IndexedDB `mage-nexus` / `decks-v2` | Decks and folders. |

Clearing the site data for the client removes all of the above, including decks and custom art. There is no settings export; to reproduce a setup on another device, set the values again or copy the browser profile.

## Related

- [Settings](../player-guide/settings.md)
- [Card images and art](../player-guide/card-images-and-art.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Commands](commands.md)
