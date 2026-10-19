import { useState } from 'react'
import Tabs from '../ui/Tabs'
import { useTranslation } from '../i18n'
import { useStore } from '../state/store'
import FinishedMatchesPanel from './FinishedMatchesPanel'
import ReplayFilesPanel from './ReplayFilesPanel'
import MyMatchStats from './MyMatchStats'
import type { UsersView } from '../net/types'

type Source = 'server' | 'files' | 'mine'

interface MatchesSectionProps {
  users: UsersView[]
  onInspectUser: (username: string) => void
}

export default function MatchesSection({ users, onInspectUser }: MatchesSectionProps) {
  const { t } = useTranslation()
  const capabilities = useStore((s) => s.capabilities)
  // The saved-replays browser is fork-only persistence: its tab
  // and panel must not appear at all without `capabilities.llm`.
  const replayEnabled = capabilities?.llm === true
  const [source, setSource] = useState<Source>('server')

  const active: Source = source === 'files' && !replayEnabled ? 'server' : source

  return (
    <>
      <Tabs<Source>
        variant="underline"
        size="sm"
        value={active}
        onChange={setSource}
        items={[
          { id: 'server', label: t('lobby', 'history_server') },
          { id: 'files', label: t('lobby', 'replay_files_tab'), hidden: !replayEnabled },
          { id: 'mine', label: t('lobby', 'history_mine') },
        ]}
      />
      {active === 'server' ? (
        <FinishedMatchesPanel users={users} onInspectUser={onInspectUser} />
      ) : active === 'files' ? (
        <ReplayFilesPanel />
      ) : (
        <MyMatchStats />
      )}
    </>
  )
}
