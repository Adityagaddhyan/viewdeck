import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppError } from '@shared/types/result'
import { asAppError } from './ipc'

export interface AsyncState<T> {
  data: T | undefined
  error: AppError | null
  loading: boolean
  /** Re-runs the loader. Resolves with the new data, or undefined on error. */
  reload: () => Promise<T | undefined>
}

/**
 * Runs `load` when `deps` change and tracks data/error/loading. Stale responses
 * (from an earlier deps value) are ignored, so a fast region switch can't show
 * the previous region's databases.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<AppError | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)

  const run = useCallback(async () => {
    const gen = ++generation.current
    setLoading(true)
    setError(null)
    try {
      const result = await load()
      if (gen === generation.current) setData(result)
      return result
    } catch (err) {
      if (gen === generation.current) setError(asAppError(err))
      return undefined
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, deps)

  useEffect(() => {
    if (enabled) void run()
  }, [run, enabled])

  return { data, error, loading, reload: run }
}
