import { useEffect, useRef } from 'react'
import type { MutableRefObject, Dispatch } from 'react'
import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { createWorkbenchMessage } from './app-state-reducer-helpers'
import type { Actions, AppAction, StateShape } from './app-state-types'

const STARTUP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function useStartupUpdateCheck({
  actions,
  dispatch,
  providerMountedRef,
  runtime,
  status,
}: {
  actions: Actions
  dispatch: Dispatch<AppAction>
  providerMountedRef: MutableRefObject<boolean>
  runtime: BootstrapPayload['health']['runtime'] | undefined
  status: StateShape['status']
}) {
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current || status !== 'ready' || runtime !== 'tauri') {
      return
    }
    startedRef.current = true

    void actions.getAppUpdateSettings().then((settings) => {
      if (
        !settings?.supported ||
        !shouldRunStartupUpdateCheck(settings.lastCheckedAt) ||
        !providerMountedRef.current
      ) {
        return undefined
      }

      return actions.checkAppUpdate().then((result) => {
        if (!providerMountedRef.current || result?.status !== 'available' || !result.candidate) {
          return
        }

        dispatch({
          type: 'WORKBENCH_MESSAGE_ADDED',
          message: createWorkbenchMessage(
            `DataPad++ ${result.candidate.version} is available.`,
            'Updates',
            'info',
            result.message,
          ),
        })
      })
    })
  }, [actions, dispatch, providerMountedRef, runtime, status])
}

function shouldRunStartupUpdateCheck(lastCheckedAt?: string | null) {
  if (!lastCheckedAt) {
    return true
  }
  const lastCheckedTime = Date.parse(lastCheckedAt)
  if (Number.isNaN(lastCheckedTime)) {
    return true
  }
  return Date.now() - lastCheckedTime >= STARTUP_UPDATE_CHECK_INTERVAL_MS
}
