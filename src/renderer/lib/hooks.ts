import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api } from './api'

/** Live auto-update status from the main process. */
export function useUpdateStatus(): UpdateStatus | null {
  const [st, setSt] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void api.update.status().then(setSt, () => undefined)
    return api.on('update:status', (x: UpdateStatus) => setSt(x))
  }, [])
  return st
}

/** Re-render on an interval; returns the current timestamp. */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, enabled])
  return now
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({
    data: undefined,
    loading: true,
    error: null
  })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => alive && setState({ data, loading: false, error: null }),
      (err) => alive && setState({ data: undefined, loading: false, error: (err as Error).message })
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
