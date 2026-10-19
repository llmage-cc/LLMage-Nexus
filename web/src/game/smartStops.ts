import type { GameView, PlayableObjectStats } from '../net/types'

const MANA_ABILITY_RE = /:\s*Add\s+(\{|one |two |three |an |x )/i

function hasNonManaAction(stats: PlayableObjectStats | undefined): boolean {
  if (!stats) return false
  return (stats.basicPlayAbilities?.length ?? 0) > 0
    || (stats.basicCastAbilities?.length ?? 0) > 0
    || (stats.other ?? []).some((a) => !MANA_ABILITY_RE.test(a.value))
}

export function meaningfulPlayables(game: GameView, playableIds: string[] = []): string[] {
  const ids = new Set<string>()
  for (const [id, stats] of Object.entries(game.canPlayObjects?.objects ?? {})) {
    if (hasNonManaAction(stats)) ids.add(id)
  }
  const hand = game.myHand ?? {}
  for (const id of playableIds) if (id in hand) ids.add(id)
  return [...ids]
}
