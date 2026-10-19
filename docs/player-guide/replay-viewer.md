# Replay viewer

A replay reopens a finished game on the same board you played it on: every permanent, every life total, every card in a graveyard, frame by frame. You can step through it, jump to a position, watch it play itself, and switch which seat is drawn as your side. This page covers where replays come from, the controls, and what a replay cannot do.

> **Who this is for:** a player who wants to review a finished game, check a ruling, or watch a match they missed.


## Where replays come from

A replay is written by the game server, not by your browser. The server saves the finished game and a small metadata file beside it: winner, players, decks, score, and the table name. Only servers that persist saves produce replays; on a server that does not, the History view simply has no replay controls.

Two entry points open the viewer, both under **History** in the lobby:

- **Server** lists the room's finished matches. Each match shows a replay button per game — **Watch Replay** when the match had one game, **Replay G2** and so on when it had several.
- **Saved replays** lists the replay files the proxy can see, merged with the room's finished matches. It has a search box, a source filter (matches, files, or both), and sortable columns for date, name, winner, and size. Rows backed by a saved file also offer the `.game` download, and a save written before metadata existed is marked **legacy**: it still loads, but only its id, date, and size are known.

Both views are part of the same server capability: if the connected server does not report replay support, neither the **Saved replays** tab nor the replay buttons appear.

## Opening a replay

Clicking a replay button loads the game and starts it at the first frame. The board is the saved state, drawn exactly as it was, and a **Loading replay…** label stays under the playback bar until the first frame arrives.

The proxy refuses to load a replay while this session is playing or watching a live game. When a load is refused, the reason appears on the row you clicked and in the lobby banner instead of leaving the button spinning.

## Playback controls

| Control | What it does |
|---|---|
| **⏮ Previous** | Step back one play |
| **▶ Play** / **⏸ Pause** | Start or stop automatic playback |
| **⏭ Next** | Step forward one play |
| **⏩ Skip 10** | Jump ten plays forward |
| **⏹ Stop Replay** | Leave the viewer and return to the lobby |
| Slider | Jump to any position in the saved game |
| **You** seat buttons | Choose which seat is drawn as your own side |

Playback is step-driven. **Play** asks the server for the next frame once per second, and the server's frame is what advances the board; the viewer never moves a local cursor, so a slow frame cannot leave the picture out of step with the position label. The slider shows `current / total` once the server reports a frame count, and **Frame N** before that.

Reaching the end of the saved game is not an exit. The viewer keeps the last frame, shows **End of replay — step back to continue**, and lets you step backwards or scrub. Only **Stop Replay** (or Escape) leaves the viewer.

## Keyboard

| Key | Action |
|---|---|
| `Space` | Play or pause |
| `→` | Next frame |
| `←` | Previous frame |
| `Esc` | Leave the replay |

These keys belong to the viewer only while nothing else needs them: typing in the chat or a search box keeps the keystrokes, and an open dialog takes the whole keyboard. The full shortcut list is in [Keyboard shortcuts](../reference/keyboard-shortcuts.md).

## Choosing a perspective

A replay has no seat of its own, so the viewer picks one for you: the seat whose name matches the account you are connected with, or the first player in the game when there is no match. The **You** row in the playback bar has one button per seat and switches the board live — the chosen seat is drawn at the bottom with its own side and pile positions, and the other seats move to the top.

The choice belongs to the open replay. It is not saved, and opening another replay starts from the automatic pick again. An unknown or missing seat falls back to that automatic pick rather than showing a blank board.

## Reading a replay

The board behaves like a game board with the action controls removed: hovering a card previews it, right-clicking opens the card inspector, and the pile overlays list the graveyards, exile, and library of the frame. Clicking a permanent does not play it — a replay has no priority.

The drawer tabs work on the saved state. **Log** shows the game log up to the current frame, so stepping forward reveals events as they happened. **Stack** shows what was on the stack at that moment, and **Commander** shows the damage matrix.

**LLM** is the replay's sidecar view: for a game with LLM seats, it rebuilds the conversation as of the current frame, merging what each seat had said up to that point. Scrubbing backwards drops the later exchanges and stepping forward brings them back, so you can read exactly what a model knew when it made a decision. Each seat's block can download its transcript. A game without LLM seats has no such tab.

## Limitations

- **Replays need a server that saves them.** A stock server persists nothing, so the History view offers no replay at all, and the viewer's controls do not render.
- **Seeking needs server support.** The slider and Skip ask the server to jump; on a server that cannot seek, the request is refused and the viewer stays where it was. Stepping with **Next** always works.
- **A replay is read-only.** Play, pass, target, and every other player action are refused while a replay is loaded. Leaving the viewer is the only way back to a live table.
- **One file per game.** A best-of-three match stores each game separately, which is why the match row shows a replay button per game.
- **Older saves are thinner.** A save without metadata shows as legacy, and a save written before the log was captured has no log to step through.
- **Games only.** Drafts, sealed pools, and tournament brackets are not replayable; their results appear in the bracket and standings instead.

## Related

- [Board and controls](board-and-controls.md)
- [Game modes and formats](game-modes.md)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
- [Lobby](lobby.md)
