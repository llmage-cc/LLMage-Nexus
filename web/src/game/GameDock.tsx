import { createContext, useContext, useLayoutEffect } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { HandPromptSlotContext } from '../board/BoardShell'
import { useStore } from '../state/store'
import { useInfoWindows } from './infoWindowState'
import './GameDock.css'

const DOCK_GAP = 8
const DOCK_FALLBACK = 104
const BOTTOM_RESOURCES_SELECTOR = '.pz-bottom-row .resource-bar'

const PromptSlotContext = createContext<HTMLElement | null>(null)

const HandPromptContext = createContext<HTMLElement | null>(null)

interface PromptSlotProviderProps {
  value: HTMLElement | null
  /** Slot above the own hand, published by the board through `onHandSlot`. */
  hand?: HTMLElement | null
  onHandSlot?: ((el: HTMLElement | null) => void) | null
  children: ReactNode
}

export function PromptSlotProvider({ value, hand = null, onHandSlot = null, children }: PromptSlotProviderProps) {
  return (
    <PromptSlotContext.Provider value={value}>
      <HandPromptContext.Provider value={hand}>
        <HandPromptSlotContext.Provider value={onHandSlot}>{children}</HandPromptSlotContext.Provider>
      </HandPromptContext.Provider>
    </PromptSlotContext.Provider>
  )
}

export function DockPrompt({ children }: { children: ReactNode }) {
  const slot = useContext(PromptSlotContext)
  return slot ? createPortal(children, slot) : <>{children}</>
}

/** Prompt about the own hand: floats above the fan when the board publishes
 *  its hand slot, otherwise falls back to the dock. */
export function HandPrompt({ children }: { children: ReactNode }) {
  const slot = useContext(HandPromptContext)
  return slot ? createPortal(children, slot) : <DockPrompt>{children}</DockPrompt>
}

export function useDockOffset(wrapRef: RefObject<HTMLElement | null>, deps: readonly unknown[]) {
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const bar = wrap.querySelector<HTMLElement>(BOTTOM_RESOURCES_SELECTOR)
      const wrapRect = wrap.getBoundingClientRect()
      const zoom = wrap.offsetHeight > 0 ? wrapRect.height / wrap.offsetHeight : 1
      const px = bar && zoom > 0
        ? Math.round(Math.max(0, (wrapRect.bottom - bar.getBoundingClientRect().top) / zoom) + DOCK_GAP)
        : DOCK_FALLBACK
      wrap.style.setProperty('--dock-bottom', `${px}px`)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    const bar = wrap.querySelector(BOTTOM_RESOURCES_SELECTOR)
    if (bar) observer.observe(bar)
    return () => observer.disconnect()
  }, deps)
}

interface GameDockProps {
  action: ReactNode
  rewind?: ReactNode
  onPromptSlot: (el: HTMLElement | null) => void
}

export default function GameDock({ action, rewind = null, onPromptSlot }: GameDockProps) {
  // With a read-only viewer open (card inspector z 12000, stack/revealed/
  // companion viewers z 100, both in the body-level overlayRoot) the non-modal
  // confirmation used to paint underneath — and it is the turn's only exit:
  // with no visible bar the user can neither answer nor close (soft lock).
  // Every infoWindow viewer paints the same full-screen backdrop
  // (PileOverlay), companion included, so none is excluded.
  const inspectedCard = useStore((s) => s.inspectedCard)
  const viewer = useStore((s) => s.viewer)
  const infoWindows = useInfoWindows()
  const hasQuietViewer = !!inspectedCard
    || !!viewer
    || infoWindows.windows.open.length > 0
  return (
    <div
      className="game-dock"
      data-testid="game-dock"
      data-prompt-above-modal={hasQuietViewer || undefined}
    >
      <div className="game-dock-prompt" ref={onPromptSlot} />
      <div className="game-dock-row">
        {rewind && (
          <div className="game-dock-rewind" data-testid="game-dock-rewind">
            {rewind}
          </div>
        )}
        {action}
      </div>
    </div>
  )
}
