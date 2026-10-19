import { useState, useEffect, useMemo, useCallback } from 'react'
import Button from '../ui/Button'
import ChipButton from '../ui/ChipButton'
import Chip from '../ui/Chip'
import CloseButton from '../ui/CloseButton'
import EmptyState from '../ui/EmptyState'
import ErrorBanner from '../ui/ErrorBanner'
import Icon from '../ui/Icon'
import type { MatchView } from '../net/types'
import { getFinishedMatches, getReplayFiles, replayGame, type ReplayFileEntry } from '../net/commands'
import { useStore } from '../state/store'
import { setStoreError, clearError, replayLoadErrorMessage } from '../state/actions'
import { useTranslation } from '../i18n'
import {
  buildReplayRows,
  compareRows,
  formatBytes,
  formatWhen,
  markRowsWithSave,
  replayDownloadUrl,
  relativeTimeParts,
  rowMatches,
  type ReplayRow,
  type SortKey,
  type SortDir,
  type SourceFilter,
} from './replayFiles'
import './ReplayFilesPanel.css'

/**
 * The proxy's `getReplayFiles` carries the server's ABSOLUTE replay dir.
 * A player-facing client must not leak the server filesystem layout, so the raw
 * path is rendered ONLY when this build flag is on (admin/debug builds). The file
 * browser itself is unaffected: the rows come from the same listing.
 */
const SHOW_REPLAY_DIR = import.meta.env.VITE_SHOW_REPLAY_DIR === 'true'

const SORT_KEYS: { key: SortKey; labelKey: 'replay_files_col_date' | 'replay_files_col_name' | 'replay_files_col_winner' | 'replay_files_col_size' }[] = [
  { key: 'date', labelKey: 'replay_files_col_date' },
  { key: 'name', labelKey: 'replay_files_col_name' },
  { key: 'winner', labelKey: 'replay_files_col_winner' },
  { key: 'size', labelKey: 'replay_files_col_size' },
]

/**
 * All-saves replay browser.
 *
 * Lists the server's saved replay FILES (proxy `getReplayFiles`) merged and
 * deduped with the room's finished matches, with search, column sort and the
 * resolved replay directory. A saved file with no sidecar JSON is still loadable
 * and carries a "legacy" marker. Nothing is polled: the lists are fetched on
 * mount and on an explicit Refresh.
 *
 * Rows load through the EXISTING flow — `replayGame(gameId)` → the REPLAY_GAME
 * callback opens the viewer + auto-starts (same as FinishedMatchesPanel).
 *
 * Gating: rendered only while `capabilities?.llm === true`. With capabilities
 * null or `llm:false` this returns null (the fork-only persistence rule).
 */
export default function ReplayFilesPanel() {
  const { t } = useTranslation()
  const capabilities = useStore((s) => s.capabilities)
  const replayEnabled = capabilities?.llm === true

  const [matches, setMatches] = useState<MatchView[]>([])
  const [files, setFiles] = useState<ReplayFileEntry[]>([])
  const [directory, setDirectory] = useState('')
  const [exists, setExists] = useState(true)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })
  const [replayingGameId, setReplayingGameId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ gameId: string; message: string } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setRowError(null)
    try {
      const [matchData, fileData] = await Promise.all([getFinishedMatches(), getReplayFiles()])
      setMatches(matchData)
      setFiles(fileData.files)
      setDirectory(fileData.directory)
      setExists(fileData.exists)
    } catch {
      // Ignore transient errors; the list simply stays as it was.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!replayEnabled) return
    void fetchData()
  }, [replayEnabled, fetchData])

  const rows = useMemo(() => {
    const all = buildReplayRows(matches, files, sourceFilter)
    return markRowsWithSave(all, files)
      .filter((r) => rowMatches(r, searchQuery.trim()))
      .sort((a, b) => compareRows(a, b, sort.key, sort.dir))
  }, [matches, files, sourceFilter, searchQuery, sort])

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' }))

  const handleReplay = async (gameId: string) => {
    if (!replayEnabled) return
    setReplayingGameId(gameId)
    setRowError(null)
    try {
      const res = await replayGame(gameId)
      // The proxy answers the load with a result; the REPLAY_GAME callback then
      // opens the viewer (and auto-starts). Surface a refusal instead of leaving
      // the button spinning as if it were a slow load — ON the row that was
      // clicked, and on the lobby banner for a failure raised from elsewhere.
      if (!res.ok) {
        const message = replayLoadErrorMessage(res.error, t('lobby', 'replay_files_load_failed'))
        setRowError({ gameId, message })
        setStoreError(message)
      } else {
        // A load that starts clears the previous failure's banner: it would
        // otherwise hang over a replay that is opening fine.
        clearError()
      }
    } catch {
      const message = t('lobby', 'replay_files_load_failed')
      setRowError({ gameId, message })
      setStoreError(message)
    } finally {
      setReplayingGameId(null)
    }
  }

  const relativeLabel = (ms: number | null): string => {
    if (ms == null) return ''
    const { key, count } = relativeTimeParts(ms)
    return key === 'time_just_now' ? t('lobby', key) : t('lobby', key, { count: String(count) })
  }

  // Fork-only persistence: no capabilities (or no llm) hides the whole panel.
  if (!replayEnabled) return null

  const totalFiles = files.length
  const totalMatches = matches.filter((m) => m.replayAvailable === true && (m.games?.length ?? 0) > 0).length

  return (
    <div className="replay-files-panel">
      <div className="replay-files-header">
        <div className="replay-files-title-wrap">
          <div className="replay-files-title-row">
            <span className="replay-files-icon"><Icon name="folder" size={18} /></span>
            <h2 className="replay-files-title">{t('lobby', 'replay_files_title')}</h2>
            <Chip tone="brand">{rows.length}</Chip>
          </div>
          <p className="replay-files-subtitle">{t('lobby', 'replay_files_subtitle')}</p>
        </div>

        <div className="replay-files-actions">
          <div className="replay-files-search-wrap">
            <input
              type="text"
              className="replay-files-search-input"
              placeholder={t('common', 'search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <CloseButton variant="plain" size="sm" className="replay-files-search-clear" label={t('common', 'clear')} onClick={() => setSearchQuery('')} />
            )}
          </div>

          <div className="replay-files-filter-chips">
            <ChipButton active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}>
              {t('lobby', 'replay_files_source_all', { count: String(totalMatches + totalFiles) })}
            </ChipButton>
            <ChipButton active={sourceFilter === 'match'} icon="scrollText" onClick={() => setSourceFilter('match')}>
              {t('lobby', 'replay_files_source_match')}
            </ChipButton>
            <ChipButton active={sourceFilter === 'file'} icon="save" onClick={() => setSourceFilter('file')}>
              {t('lobby', 'replay_files_source_file')}
            </ChipButton>
          </div>

          <Button variant="subtle" className={`replay-files-refresh-btn ${loading ? 'spinning' : ''}`} onClick={fetchData} disabled={loading} title={t('common', 'refresh')}>
            <span className="refresh-icon"><Icon name="refresh" size={13} /></span>
            <span>{loading ? t('common', 'loading') : t('common', 'refresh')}</span>
          </Button>
        </div>
      </div>

      <div className={`replay-files-dir ${exists ? '' : 'missing'}`}>
        <span className="replay-files-dir-label"><Icon name="save" size={12} /> {t('lobby', 'replay_files_dir_label')}</span>
        <code className="replay-files-dir-path">
          {!exists
            ? t('lobby', 'replay_files_dir_missing')
            : SHOW_REPLAY_DIR
              ? directory || '—'
              : t('lobby', 'replay_files_dir_saved')}
        </code>
      </div>

      {!exists ? (
        <EmptyState size="lg" boxed fill icon="folder" iconSize={26} title={t('lobby', 'replay_files_dir_missing')} />
      ) : rows.length === 0 ? (
        <EmptyState size="lg" boxed fill icon="inbox" iconSize={26} title={t('lobby', 'replay_files_empty')}>
          {searchQuery ? t('lobby', 'no_tables_found') : t('lobby', 'replay_files_empty')}
        </EmptyState>
      ) : (
        <div className="replay-files-list">
          <div className="replay-files-row replay-files-header-row">
            {SORT_KEYS.map(({ key, labelKey }) => {
              const active = sort.key === key
              return (
                <Button
                  key={key}
                  variant="link"
                  size="sm"
                  className={`replay-sort-header ${active ? 'active' : ''}`}
                  onClick={() => onSort(key)}
                  title={t('lobby', labelKey)}
                >
                  {t('lobby', labelKey)}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </Button>
              )
            })}
            <span />
          </div>

          {rows.map((r) => (
            <ReplayFileRowView
              key={`${r.source}:${r.gameId}`}
              row={r}
              onReplay={handleReplay}
              replaying={replayingGameId === r.gameId}
              relativeLabel={relativeLabel}
              error={rowError?.gameId === r.gameId ? rowError.message : null}
              onDismissError={() => setRowError(null)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReplayFileRowView({
  row,
  onReplay,
  replaying,
  relativeLabel,
  error,
  onDismissError,
}: {
  row: ReplayRow
  onReplay: (gameId: string) => void
  replaying: boolean
  relativeLabel: (ms: number | null) => string
  error: string | null
  onDismissError: () => void
}) {
  const { t } = useTranslation()
  const relative = relativeLabel(row.dateMs)
  return (
    <div className="replay-files-row replay-files-item">
      <div className="replay-cell replay-cell-date">
        <span className="replay-date-abs">{formatWhen(row.dateMs)}</span>
        {relative && <span className="replay-date-rel">{relative}</span>}
        {row.rated && <span className="replay-rated" title={t('lobby', 'tag_rated')}><Icon name="star" size={11} /></span>}
      </div>

      <div className="replay-cell replay-cell-name">
        <div className="replay-name-line">
          <span className="replay-name">
            {row.name || <span className="replay-id">{row.gameId.slice(0, 8)}…</span>}
          </span>
          {row.legacy && <Chip tone="warn" size="xs" title={t('lobby', 'replay_files_legacy_title')}>{t('lobby', 'replay_files_legacy')}</Chip>}
        </div>
        {(row.gameType || row.deckType) && (
          <div className="replay-type-line">{[row.gameType, row.deckType].filter(Boolean).join(' — ')}</div>
        )}
      </div>

      <div className="replay-cell replay-cell-winner">
        {row.winner || (row.legacy ? <span className="replay-muted">—</span> : row.score || <span className="replay-muted">—</span>)}
      </div>

      <div className="replay-cell replay-cell-size">{row.bytes != null ? formatBytes(row.bytes) : <span className="replay-muted">—</span>}</div>

      <div className="replay-cell replay-cell-action">
        {row.hasSave && (
          <a
            className="ui-btn ui-btn--soft ui-btn--sm replay-download-btn"
            data-testid={`replay-download-${row.gameId}`}
            href={replayDownloadUrl(row.gameId)}
            download={`${row.gameId}.game`}
            title={t('lobby', 'replay_files_download')}
          >
            <span className="replay-icon"><Icon name="download" size={12} /></span>
            <span>{t('lobby', 'replay_files_download')}</span>
          </a>
        )}
        <Button variant="soft" size="sm" onClick={() => onReplay(row.gameId)} disabled={replaying} title={t('lobby', 'match_replay_single')}>
          <span className="replay-icon"><Icon name="play" size={12} /></span>
          <span>{replaying ? t('common', 'loading') : t('lobby', 'match_replay_single')}</span>
        </Button>
      </div>

      {error && (
        <ErrorBanner
          message={error}
          onClose={onDismissError}
          className="replay-row-error"
          testId={`replay-row-error-${row.gameId}`}
        />
      )}
    </div>
  )
}
