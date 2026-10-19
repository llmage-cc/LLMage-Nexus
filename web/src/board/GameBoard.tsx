import { useMemo } from 'react'
import OpponentZone from './OpponentZone'
import PlayerZone from './PlayerZone'
import BoardShell, { BoardDivider } from './BoardShell'
import { useBoardPresenter, useBoardPlayers } from './useBoardPresenter'
import { opponentRevealedCards } from './revealedCards'
import { useSpectatorBottomHand, useSwitchedHand, type BoardProps } from './boardShared'
import { EMPTY_TARGET_ZONES } from './targetZones'
import './GameBoard.css'

export interface GameBoardProps extends BoardProps {
  focusedOpponentId?: string
}

export default function GameBoard({
  game,
  targetIds = [],
  chosenTargetIds = [],
  onTargetClick,
  targetZone = null,
  targetZones = EMPTY_TARGET_ZONES,
  playableIds = [],
  onPlayableClick,
  onCardHover,
  combatSelectable = [],
  combatMode = null,
  combatChosen = [],
  onCombatClick,
  attackingIds = [],
  blockingIds = [],
  crossZonePlayables = [],
  onPlayCrossZone,
  focusedOpponentId,
}: GameBoardProps) {
  const { me, opps, isSpectator, perspective } = useBoardPlayers(game, true)
  const presenter = useBoardPresenter({
    game,
    targetIds,
    chosenTargetIds,
    targetZone,
    playableIds,
    combatSelectable,
    combatMode,
    combatChosen,
    crossZonePlayables,
    onTargetClick,
    onPlayableClick,
    onCombatClick,
    onCardHover,
  })
  const { handleCardHover, handleCardClick, targetIdSet, playableIdSet } = presenter

  const oppBottom = isSpectator ? (opps.length >= 2 ? opps[opps.length - 1] : opps[0]) : undefined
  const topOpps = isSpectator ? (opps.length >= 2 ? opps.slice(0, opps.length - 1) : []) : opps

  /** Bottom player hand: the spectator's watched hand, or the replay perspective
   *  seat's visible hand; a controlled live game uses `myHand` (the hand bar). */
  const bottomSeat = isSpectator ? oppBottom : me
  const bottomHand = useSpectatorBottomHand(game, isSpectator || perspective, bottomSeat)
  /** Mano ajena bajo control (Switch Hands): sustituye a la propia. */
  const switchedHand = useSwitchedHand(game)

  const currentOpp = useMemo(() => {
    if (topOpps.length <= 1) return topOpps[0]
    if (focusedOpponentId) {
      const found = topOpps.find((p) => p.playerId === focusedOpponentId)
      if (found) return found
    }
    const activeOpp = topOpps.find((p) => p.playerId === game?.activePlayerId)
    if (activeOpp) return activeOpp
    return topOpps[0]
  }, [topOpps, focusedOpponentId, game?.activePlayerId])

  return (
    <BoardShell
      className="game-board"
      testId="game-board"
      presenter={presenter}
      handBar={isSpectator || perspective ? null : {
        cards: switchedHand ?? game?.myHand ?? {},
        onCardClick: onPlayableClick,
        onHover: (card, rect) => handleCardHover(card, rect, { fromHand: true }),
        playableIds: playableIdSet,
        targetIds: targetIdSet,
      }}
    >
      <OpponentZone
        key={currentOpp?.playerId}
        player={currentOpp}
        onCardClick={handleCardClick}
        onCardHover={handleCardHover}
        targetIds={targetIdSet}
        targetZone={targetZone}
        targetZones={targetZones}
        revealedCards={opponentRevealedCards(game, currentOpp)}
        playableIds={playableIdSet}
        combatSelectable={combatSelectable}
        combatMode={combatMode}
        combatChosen={combatChosen}
        attackingIds={attackingIds}
        blockingIds={blockingIds}
      />
      <BoardDivider />
      <PlayerZone
        player={isSpectator ? oppBottom : me}
        hand={perspective || isSpectator ? bottomHand : (game?.myHand ?? {})}
        isControlled={perspective ? true : undefined}
        onCardClick={handleCardClick}
        onHandCardClick={onPlayableClick}
        onCardHover={handleCardHover}
        targetIds={targetIdSet}
        targetZone={targetZone}
        targetZones={targetZones}
        playableIds={playableIdSet}
        combatSelectable={combatSelectable}
        combatMode={combatMode}
        combatChosen={combatChosen}
        attackingIds={attackingIds}
        blockingIds={blockingIds}
        crossZonePlayables={isSpectator && !perspective ? [] : crossZonePlayables}
        onPlayCrossZone={onPlayCrossZone}
        helperEmblems={game?.myHelperEmblems}
        showHand={isSpectator || perspective}
      />
    </BoardShell>
  )
}
