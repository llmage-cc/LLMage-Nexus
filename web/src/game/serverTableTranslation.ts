type TableTranslationFn = (
  ns: 'game' | 'lobby',
  key: string,
) => string

/**
 * The lobby table info strip is an ENGLISH SERVER PAYLOAD built by
 * `mage.view.TableView`: the short strip shows e.g. `Wins:1 Score: -0-0, SP` and
 * the hover tooltip `Wins required:1 (Best of 1)<br>Seats: 2, SP<br>Game type:...`.
 * The labels leak into every locale; the counts and abbreviations must pass
 * through verbatim. This maps the KNOWN upstream labels to EXISTING localized
 * segments (the same client-side pattern as localizeServerMessage) and leaves
 * anything unrecognized untouched.
 */
export function localizeServerTableInfo(
  raw: string | null | undefined,
  t: TableTranslationFn
): string {
  if (!raw) return ''
  let out = raw

  // The short strip: "Wins:1" (+ " Score: -0-0"). The payload glues the count to
  // the label ("Wins:1"), so the localized label keeps its own separator before
  // the untouched number.
  out = out.replace(/Wins\s*:(?=\d)/gi, `${t('game', 'match_wins')}: `)
  out = out.replace(/\bWins required\s*:/gi, `${t('game', 'match_wins')}:`)
  out = out.replace(/\bScore\s*:/gi, t('game', 'score'))

  // ", SP" duplicates the spectators chip the card already renders; drop it
  // instead of shipping a bare English abbreviation. The full tooltip spells it
  // out ("<br>Spectators allowed (SP)"): localize that label.
  out = out.replace(/\s*,\s*SP\b/gi, '')
  out = out.replace(/<br>Spectators allowed \(SP\)/gi, `<br>${t('lobby', 'tag_spectators')}`)

  return out
}