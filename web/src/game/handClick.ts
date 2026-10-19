/**
 * Hand-click gate, shared by the send path (GameScreen) and the slot
 * affordance (HandBar). With no prompt open, a click on the hand can only be a
 * play: if the app has not marked the card as playable, the client already
 * knows the server would reject the send (stale marker, play window closed) —
 * do not send knowingly. With a prompt open the hand can be the selector of a
 * uuid choice or a mana payment: that click is decided by its own branch, not
 * by this gate.
 *
 * The same predicate decides whether the slot advertises itself as clickable:
 * a click the gate drops must not paint `clickable`, `cursor: pointer`, or
 * `role=button`/focus (an affordance defect).
 */
export function isUnplayableHandClick(hasOpenPrompt: boolean, playableIds: ReadonlySet<string>, id: string): boolean {
  return !hasOpenPrompt && !playableIds.has(id)
}
