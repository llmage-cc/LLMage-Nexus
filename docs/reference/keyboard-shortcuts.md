# Keyboard shortcuts

You can play a whole game with the mouse, but most turns come down to one decision: do you have a response, or do you pass? The web client binds a small set of keys that answer that question without moving the pointer, step through a replay, or change the interface scale. This page lists every binding the client implements, what each one does, and the situations where the client deliberately ignores it. It is the canonical shortcut list for the wiki.

> **Who this is for:** A player who wants to handle priority, card inspection, and replay playback from the keyboard.

## How the client decides which key wins

Three rules cover almost every case:

- **Text entry wins.** While focus is in a text field, a search box, a select, or any editable element, the client does not treat the key as a shortcut. Typing `1` in chat sends a message that starts with 1; it does not choose an option.
- **A dialog takes Space and Enter first.** With a dialog open, Space and Enter activate its focused control rather than the game underneath. Skip keys are different: the client ignores them while focus is in a text field or a decision prompt is open, but not while the settings or help dialog is open, so an F-key pressed there still reaches the game.
- **Escape closes the topmost layer.** Card inspector, pile viewer, hand viewer, context menu, settings, and help all close on Escape and leave the game underneath untouched.

On the game table, Space is reserved for priority. Cards and other clickable table elements activate with Enter, so focusing a card never passes for you by accident.

## Global shortcuts

These work anywhere in the client, including the lobby and the deck builder.

| Keys | Action | Notes |
|---|---|---|
| `Ctrl`/`Cmd` + `+` or `=` | Increase interface size | Steps through the same stops as Settings → Interface: 90, 100, 115, 130, 150 percent, then 10 percent steps. |
| `Ctrl`/`Cmd` + `-` or `_` | Decrease interface size | Same stops in reverse. |
| `Ctrl`/`Cmd` + `0` | Reset interface size to 100 percent | Equivalent to clicking the percentage in Settings → Interface. |
| `Esc` | Close the topmost dialog or overlay | Does nothing when the open dialog requires an answer. |
| `Alt` (hold) | Peek at the board behind a dialog | Visual only. The backdrop still blocks clicks, so you cannot act on the board while peeking. |
| `Tab` / `Shift` + `Tab` | Move focus forward or backward | In a modal, focus wraps inside the dialog instead of escaping to the page behind it. |

The interface scale stays between 50 and 200 percent. The value is shared with the Settings dialog, so a change made with the keyboard shows up there immediately and survives a reload.

## In a game

| Keys | Action | Notes |
|---|---|---|
| `Space` | Main action: pass priority or decline the current prompt | Ignored while a decision dialog is open, while typing, during a rollback vote, and in the replay viewer. |
| `Enter` | Activate the focused card or control | The keyboard path for a card that Space would otherwise pass over. |
| `Ctrl`, `Cmd`, or `Shift` + click a card | Play the card and keep priority | Sends the hold-priority action before the play, so you can respond to your own spell. Holding the setting instead (Settings → Gameplay → Hold Priority) applies to every play. |
| `Shift` or `F` | Flip the inspected card | Only while the card inspector is open and the card has a second face. |
| `F3` | Cancel the active priority skip | Available whenever a skip is running. |

### Priority skips

Each skip sends one action to the server and keeps passing until the named point. The same commands appear in the pass menu next to the action button, with the key printed beside each entry.

| Key | Menu label | Passes until |
|---|---|---|
| `F4` | Next turn | The next turn begins, whoever's it is. |
| `F5` | End step | The end step of the current turn. |
| `F7` | Next main | The next main phase. |
| `F9` | My turn | Your next turn begins. |
| `F10` | Stack resolved | The stack is empty. |
| `F11` | End before mine | The end step before your next turn. |

`F6` and `F8` are not bound. While a skip is active, the action button shows the destination, and `F3` or the Cancel skip entry in the pass menu stops it.

Function keys are sometimes claimed by the operating system, the window manager, or a browser extension before the page sees them. If a skip key does nothing while the game has focus, check those layers before assuming the client ignored it.

## Decision dialogs

When the server asks a question, the dialog that appears supports these keys:

| Keys | Action |
|---|---|
| `1` to `9` | Choose the option with that number. The number is printed on every option, but only the first nine are bound to keys. |
| Arrow keys | Move the highlight between options in a full decision dialog. |
| `Enter` | Confirm the highlighted option, or submit the typed value in a text-choice prompt. |
| `Esc` | Does not dismiss a decision prompt. Answer it, or use its Cancel button when the prompt allows cancelling. |

Compact ask bars, which appear over the board instead of a full dialog, accept the number keys but not the arrow keys.

## Deck builder

These bindings apply to a deck strip, the small card tile that shows a card and its count in the current deck. Focus a strip with `Tab`, then use:

| Keys | Action |
|---|---|
| `Enter` or `Space` | Move one copy between zones: main deck and sideboard in the deck builder, or pool and main deck while building a limited deck. |
| `+` or `=` | Add one copy. |
| `-` or `_` | Remove one copy. |
| Click | Move one copy between the same zones. |
| `Shift` + click | Same as a plain click on an editable strip. |
| Right-click | Same as a plain click on an editable strip. |

On an editable deck strip, every mouse gesture moves a copy across zones; the `+` and `-` keys are the way to change the count without moving the card. A read-only strip, such as the one in the deck inspector, ignores keys and clicks.

## Draft

| Key | Action |
|---|---|
| `F9` | Restore every pick you hid in the current draft. The same action is available from the "Show hidden picks" control. |

Hiding a pick removes it from the visible booster without affecting the pick you send; `F9` brings the hidden cards back so you can review them.

## Chat and lobby

| Keys | Where | Action |
|---|---|---|
| `Enter` | Chat input | Send the message. The chat box is a form, so Enter submits it. |
| `Enter` | Login form | Submit the connection form from any field. |
| `Enter` | Deck box or deck tile | Open the focused deck. |
| `Esc` | Table filter search box | Clear the search text without closing the lobby. |

Chat messages have a length limit; a message over the limit is rejected locally and replaced with a notice instead of being sent.

## Replay viewer

The replay viewer takes the keyboard while its controls are visible. Keys are ignored if focus is in a text field or a modal dialog is open.

| Keys | Action |
|---|---|
| `Space` | Play or pause. In a replay, Space never passes priority. |
| `Right arrow` | Step forward one state. |
| `Left arrow` | Step back one state. |
| `Esc` | Leave the replay and return to the previous view. |

The position slider is a native range control, so the arrow keys also move it when it has focus.

## Navigation in dialogs and tab strips

- Tab strips respond to `Left` and `Right` arrows, plus `Home` and `End` for the first and last tab.
- A modal dialog traps Tab and Shift+Tab inside itself until it closes.

## Where the in-app list lives

Open the game menu (the button at the top of the game screen) and choose **Wiki, Glossary & Help**, then the **Shortcuts & Controls** tab. The card summarizes the main bindings; this page is the exact list, including the keys the card does not mention.

## Related

- [Board and controls](../player-guide/board-and-controls.md)
- [Replay viewer](../player-guide/replay-viewer.md)
- [Settings reference](settings-reference.md)
- [Troubleshooting](troubleshooting.md)
