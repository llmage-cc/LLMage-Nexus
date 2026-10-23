import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getNews, hasUnseenNews, loadNewsCache } from './news'

export function useNewsBadge(): { unseen: boolean; refresh: () => void } {
  const [tick, setTick] = useState(0)
  // `getNews()` is a network round-trip: it routinely resolves after the screen that asked for
  // the badge is gone (vitest tears jsdom down between files). Dispatching then walks React's
  // update path, which reads `window` — an uncaught `ReferenceError` that fails the run even
  // though every assertion passed. The continuation therefore checks this flag before any setState.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])
  const unseen = useMemo(
    () => hasUnseenNews(loadNewsCache()?.releases ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  )
  const refresh = useCallback(() => {
    void getNews().then(({ releases }) => {
      if (!aliveRef.current) return
      if (releases.length > 0) setTick((t) => t + 1)
    })
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { unseen, refresh }
}
