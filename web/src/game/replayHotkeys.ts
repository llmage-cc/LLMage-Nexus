/** What a replay-view keypress means, given which overlay (if any) owns the keyboard. */
export type ReplayHotkey = 'play' | 'next' | 'previous' | 'exit' | null

/**
 * Map a keypress to the viewer's action. Space toggles play/pause, the arrows
 * step, Escape exits. The keys are the viewer's only while nothing else needs
 * them: a text field (chat input, search box) keeps them, and an open modal
 * dialog (settings, an action dialog) owns the whole keyboard.
 */
export function replayHotkey(
  key: string,
  opts: { typing: boolean; dialogOpen: boolean },
): ReplayHotkey {
  if (opts.dialogOpen || opts.typing) return null
  switch (key) {
    case ' ': return 'play'
    case 'ArrowRight': return 'next'
    case 'ArrowLeft': return 'previous'
    case 'Escape': return 'exit'
    default: return null
  }
}

/** True when a keypress is going into a text field — those keys belong to the field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true
}

/** True when a modal dialog is open over the board (settings, action dialogs). */
export function replayDialogOpen(root: ParentNode = document): boolean {
  return root.querySelector('[data-testid="settings-modal"], [role="dialog"][aria-modal="true"]') != null
}
