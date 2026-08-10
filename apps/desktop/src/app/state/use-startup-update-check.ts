import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { AppUpdateSettings, BootstrapPayload } from '@datapadplusplus/shared-types'
import type { Actions, StateShape } from './app-state-types'

const STARTUP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function useStartupUpdateCheck({
  actions,
  enabled = true,
  providerMountedRef,
  runtime,
  status,
}: {
  actions: Actions
  enabled?: boolean
  providerMountedRef: MutableRefObject<boolean>
  runtime: BootstrapPayload['health']['runtime'] | undefined
  status: StateShape['status']
}) {
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || startedRef.current || status !== 'ready' || runtime !== 'tauri') {
      return
    }
    startedRef.current = true

    void actions.getAppUpdateSettings().then((settings) => {
      if (
        !settings?.supported ||
        !shouldRunStartupUpdateCheck(settings) ||
        !providerMountedRef.current
      ) {
        return undefined
      }

      return actions.checkAppUpdate()
    })
  }, [actions, enabled, providerMountedRef, runtime, status])
}

export function shouldRunStartupUpdateCheck(
  settings: Pick<AppUpdateSettings, 'includePrereleases' | 'lastCheckedAt' | 'lastResult'>,
) {
  const expectedChannel = settings.includePrereleases ? 'prerelease' : 'stable'
  if (settings.lastResult?.channel !== expectedChannel) {
    return true
  }
  const { lastCheckedAt } = settings
  if (!lastCheckedAt) {
    return true
  }
  const lastCheckedTime = Date.parse(lastCheckedAt)
  if (Number.isNaN(lastCheckedTime)) {
    return true
  }
  return Date.now() - lastCheckedTime >= STARTUP_UPDATE_CHECK_INTERVAL_MS
}
