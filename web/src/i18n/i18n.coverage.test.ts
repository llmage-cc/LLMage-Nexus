import { describe, it, expect } from 'vitest'
import { en } from './locales/en'
import { es } from './locales/es'
import { de } from './locales/de'
import { fr } from './locales/fr'
import { it as itLocale } from './locales/it'
import { pt } from './locales/pt'
import { ja } from './locales/ja'
import { ru } from './locales/ru'
import { zhs } from './locales/zhs'
import type { TranslationSchema } from './types'

const WHITELIST = new Set<string>([
  'lobby.brand_title',
  'login.server_xdhs',
  'lobby.create_seat_sim',
  'lobby.create_draft_timing_regular',
  'lobby.dev_title',
  'lobby.join_sb_suffix',
  'lobby.create_time_min_short',
  'lobby.leaderboard_col_elo',
  'dialogs.voting_vs',
  'board.token',
  'board.morph',
  'board.manifest',
  'board.disguise',
  'board.cloak',
  'board.opp_dead',
  'decks.browser_filter_aggro',
  'decks.browser_filter_midrange',
  'decks.browser_filter_control',
  'decks.browser_filter_combo',
  'decks.browser_filter_ramp',
  'decks.browser_filter_tribal',
  'decks.browser_filter_precon',
  'decks.filter_cmc',
  'decks.sample_mulligan',
  'dialogs.mulligan_btn',
  'game.board_view',
  'game.game_menu',
  'game.opp_hand_stack',
  'game.opp_hand_view',
  'game.auto_mulligan',
  'game.preset_manual',
  'game.pass_options',
  'game.automation',
  'game.skip_turn',
  'game.skip_end_step',
  'game.skip_next_main',
  'game.skip_my_turn',
  'game.skip_stack',
  'game.skip_before_mine',
  'game.skip_cancel',
  'game.skip_active_to',
  'wiki.shortcuts_skips',
  'game.category_planeswalkers',
  'game.type_planeswalker',
  'game.construct_pool',
  'game.construct_total',
  'game.sideboard_pool',
  'game.draft_booster',
  'game.draft_title',
  'game.sideboard_title',
  'game.booster_label',
  'game.tab_chat',
  'game.tab_log',
  // LLM is an acronym in every locale — nothing to translate.
  'game.tab_llm',
  'game.visual_feed',
  'lobby.create_option_booster_draft',
  'lobby.create_option_elimination',
  'lobby.create_option_sealed',
  'lobby.create_skill_casual',
  'lobby.create_tab_general',
  'lobby.history_timeouts',
  'lobby.leaderboard_col_pos',
  'lobby.leaderboard_col_winrate',
  'lobby.leaderboard_progress_value',
  'login.avatar',
  'login.proxy',
  'system.news_nexus',  'login.server_local',
  'wiki.shortcuts_esc',
  'common.error',
  'common.no',
  'lobby.staging_vs',
  'board.pile_top',
  'lobby.board_pod',
  'lobby.board_arena',
  'keywords.bushido_name',
  'keywords.indestructible_name',
  'keywords.mentor_name',
  'keywords.modular_name',
  'keywords.ninjutsu_name',
  // Replay position label is a pure numeric format ("3 / 12") — nothing to translate.
  'game.replay_position_label',
  // "Match" is the German word too (loanword) — not an English leak.
  'lobby.match_badge',
  // "Format" is the German and French word as well (the deck picker's Format
  // dropdown) — not an English leak.
  'decks.picker_format',
  // v0.4.7-riding German cognates/loanwords — identical in de by language, not
  // by leak: "Hand", "Land", "Name", "Set", "Pause", "Deck {n}", "Blitz",
  // "Champion", "Echo", "Mill", "Opus", "Partner", "Warp", "Bronze", "Gold",
  // "Cube", "Online", "Offline", "Version", "Streaming", "Commander", "Skill",
  // "Phase", "Standard", "Limited", "Constructed".
  'common.online',
  'common.offline',
  'lobby.filter_format_limited',
  'lobby.filter_tourney_constructed',
  'lobby.filter_tourney_limited',
  'lobby.create_field_seat_skill',
  'lobby.create_tourney_limited',
  'lobby.create_tourney_constructed',
  'lobby.create_field_cube',
  'lobby.create_llm_field_streaming',
  'lobby.tier_bronze',
  'lobby.tier_gold',
  'lobby.board_standard',
  'lobby.ui_scale_cjk',
  'game.phase',
  'game.replay_pause',
  'game.hand',
  'game.type_land',
  'game.hand_rail_label',
  'game.pile_hand',
  'game.tracker_sort_name',
  'game.tab_commander',
  'decks.commander',
  'decks.suggestions_cat_manaartifacts',
  'decks.box_new_deck',
  'decks.sample_land',
  'decks.filter_set',
  'decks.sort_name',
  'decks.import_setup_format',
  'board.zone_hand',
  'board.zone_sideboard',
  'board.pile_hand',
  'system.app_version',
  'keywords.blitz_name',
  'keywords.champion_name',
  'keywords.echo_name',
  'keywords.opus_name',
  'keywords.partner_name',
  'keywords.warp_name',
])

function flatten(obj: TranslationSchema): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [cat, vals] of Object.entries(obj as unknown as Record<string, Record<string, string>>)) {
    for (const [k, v] of Object.entries(vals)) {
      out[`${cat}.${k}`] = v
    }
  }
  return out
}

const locales: Record<string, TranslationSchema> = { en, es, de, fr, it: itLocale, pt, ja, ru, zhs }

describe('i18n coverage guard', () => {
  it('no language has missing or extra keys vs en', () => {
    const base = flatten(en)
    const baseKeys = new Set(Object.keys(base))
    for (const [lang, dict] of Object.entries(locales)) {
      const flat = flatten(dict)
      const keys = new Set(Object.keys(flat))
      const missing = [...baseKeys].filter(k => !keys.has(k))
      const extra = [...keys].filter(k => !baseKeys.has(k))
      expect(missing, `${lang} missing keys: ${missing.join(', ')}`).toEqual([])
      expect(extra, `${lang} extra keys: ${extra.join(', ')}`).toEqual([])
      const empty = Object.entries(flat).filter(([, v]) => v === '').map(([k]) => k)
      expect(empty, `${lang} empty values: ${empty.join(', ')}`).toEqual([])
    }
  })

  it('es is 100% translated after whitelist (magic terms excluded)', () => {
    const base = flatten(en)
    const esFlat = flatten(es)
    let identicalAfterWhitelist = 0
    const identicalKeys: string[] = []
    for (const k of Object.keys(base)) {
      if (esFlat[k] === base[k] && !WHITELIST.has(k)) {
        identicalAfterWhitelist++
        identicalKeys.push(k)
      }
    }
    expect(identicalKeys, `es identical* (${identicalAfterWhitelist}): ${identicalKeys.join(', ')}`).toEqual([])
    expect(identicalAfterWhitelist).toBe(0)
  })

  it('other languages do not regress beyond their measured baseline of English-identical values', () => {
    const base = flatten(en)
    // Measured after the v0.4.7 upstream merge (2026-10-14): upstream added new
    // untranslated keys across all locales (join-notification, chat-lobby toggle,
    // rendered-card/hand-column labels, seat-type names). Baselines are raw
    // identical-after-whitelist counts; any new key that is legitimately identical
    // to English (cognates, proper nouns, acronyms) belongs in WHITELIST.
    const baseline: Record<string, number> = { de: 58, fr: 63, it: 24, pt: 22, ja: 8, ru: 6, zhs: 8 }
    for (const [lang, max] of Object.entries(baseline)) {
      const flat = flatten(locales[lang])
      let identicalAfterWhitelist = 0
      for (const k of Object.keys(base)) {
        if (flat[k] === base[k] && !WHITELIST.has(k)) identicalAfterWhitelist++
      }
      expect(
        identicalAfterWhitelist,
        `${lang} identical* ${identicalAfterWhitelist} exceeds baseline ${max} — traduce o ajusta whitelist`
      ).toBeLessThanOrEqual(max)
    }
  })

  it('reported leaks render translated in every locale (connection screen + saved replays)', () => {
    const base = flatten(en)
    // The an earlier pass saw these English on the FR connection screen and in the DE/FR/etc.
    // saved-replays panel; the guard fails if any locale falls back to the English value.
    const mustDiffer = [
      'login.auth_token',
      'login.auth_token_placeholder',
      'login.pinned_target',
      'errors.proxy_rejected',
      'lobby.replay_files_tab',
      'lobby.replay_files_title',
      'lobby.replay_files_subtitle',
      'lobby.replay_files_empty',
      'lobby.replay_files_load_failed',
      'wiki.shortcuts_f11',
    ]
    for (const [lang, dict] of Object.entries(locales)) {
      if (lang === 'en') continue
      const flat = flatten(dict)
      const leaked = mustDiffer.filter((k) => flat[k] === base[k])
      expect(leaked, `${lang} still renders English for: ${leaked.join(', ')}`).toEqual([])
    }
  })

  it('the reported German leakers are no longer identical to English', () => {
    const base = flatten(en)
    const deFlat = flatten(de)
    // Each key was reported rendering its English value in the de UI.
    const reported = [
      'errors.proxy_rejected',
      'login.auth_token',
      'login.auth_token_placeholder',
      'login.pinned_target',
      'lobby.create_tab_general',
    ]
    for (const k of reported) {
      expect(deFlat[k], `${k} still identical to en`).toBeDefined()
      expect(deFlat[k], `${k} still identical to en`).not.toBe(base[k])
    }
  })

  it('reports coverage table (snapshot sanity)', () => {
    const base = flatten(en)
    const total = Object.keys(base).length
    expect(total).toBeGreaterThan(800)
    // es must be near 100% after the whitelist
    const esFlat = flatten(es)
    let identicalAfterWhitelist = 0
    for (const k of Object.keys(base)) if (esFlat[k] === base[k] && !WHITELIST.has(k)) identicalAfterWhitelist++
    const pct = ((total - identicalAfterWhitelist) / total) * 100
    expect(pct).toBeGreaterThanOrEqual(99.5)
  })
})
