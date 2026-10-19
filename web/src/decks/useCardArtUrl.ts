import { useEffect, useState } from 'react'
import { cardArtPreference } from '../cards/artPreferences'
import { useCustomCardArt } from '../cards/customCardArt'
import type { CardRef } from '../cards/scryfallCards'
import { resolveArtUrl } from '../cards/offlineIndex'

/**
 * URL de arte (CDN cards.scryfall.io) de una carta, resuelta contra el índice
 * offline (nombre / impresión → uuid → CDN). Sustituye a la antigua resolución
 * vía `api.scryfall.com` (límite 2 req/s: agotarlo dejaba el arte en blanco);
 * el CDN no tiene límite. Un miss devuelve null y la UI pinta su placeholder.
 */
export function useCardArtUrl(card: CardRef | null | undefined): string | null {
  // Arte propio del usuario primero (misma prioridad que en partida).
  const customArt = useCustomCardArt(card?.cardName ?? null)
  const [url, setUrl] = useState<string | null>(null)
  const preferred = card ? cardArtPreference(card.cardName) : null
  const ref = card && preferred ? { ...card, setCode: preferred.setCode, cardNumber: preferred.cardNumber } : card
  const key = ref ? `${ref.cardName}|${ref.setCode ?? ''}|${ref.cardNumber ?? ''}` : ''
  useEffect(() => {
    if (!ref || (!ref.cardName && !(ref.setCode && ref.cardNumber))) {
      setUrl(null)
      return
    }
    let cancelled = false
    void resolveArtUrl(ref).then((art) => {
      if (!cancelled) setUrl(art)
    })
    return () => {
      cancelled = true
    }
  }, [key])
  if (customArt) return customArt
  return url
}
