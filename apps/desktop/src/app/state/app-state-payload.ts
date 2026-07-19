import { startTransition, type Dispatch } from 'react'
import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { createId } from './helpers'
import type { AppAction } from './app-state-types'

export function dispatchBootstrapPayload(
  dispatch: Dispatch<AppAction>,
  payload: BootstrapPayload,
) {
  startTransition(() => {
    dispatch({ type: 'COMMAND_SUCCESS', payload })
    if (payload.persistenceWarning) {
      dispatch({
        type: 'WORKBENCH_MESSAGE_ADDED',
        openMessages: false,
        message: {
          id: createId('message'),
          severity: 'warning',
          message: payload.persistenceWarning.message,
          source: 'Workspace persistence',
          createdAt: new Date().toISOString(),
          details: payload.persistenceWarning.code,
        },
      })
    }
  })
}
