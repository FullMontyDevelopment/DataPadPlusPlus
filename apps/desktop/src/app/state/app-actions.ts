import { useMemo } from 'react'
import {
  activeConnectionForSnapshot,
  activeEnvironmentForSnapshot,
} from './app-state-selectors'
import type { Actions, AppActionContext, AppContextValue } from './app-state-types'
import { useConnectionActions } from './app-actions-connections'
import { useQueryTabActions } from './app-actions-tabs'
import { useRuntimeActions } from './app-actions-runtime'
import { useUpdateActions } from './app-actions-updates'
import { useWorkspaceActions } from './app-actions-workspace'

type AppActionBindings = Pick<
  AppContextValue,
  'actions' | 'activeConnection' | 'activeEnvironment'
>

export function useAppActions(context: AppActionContext): AppActionBindings {
  const connectionActions = useConnectionActions(context)
  const queryTabActions = useQueryTabActions(context)
  const runtimeActions = useRuntimeActions(context)
  const updateActions = useUpdateActions(context)
  const workspaceActions = useWorkspaceActions(context)

  const snapshot = context.state.payload?.snapshot
  const activeConnection =
    snapshot && snapshot.connections.length > 0
      ? activeConnectionForSnapshot(snapshot)
      : undefined
  const activeEnvironment =
    snapshot && snapshot.environments.length > 0
      ? activeEnvironmentForSnapshot(snapshot)
      : undefined

  const actions = useMemo<Actions>(
    () => ({
      ...connectionActions,
      ...queryTabActions,
      ...runtimeActions,
      ...updateActions,
      ...workspaceActions,
    }),
    [connectionActions, queryTabActions, runtimeActions, updateActions, workspaceActions],
  )

  return {
    actions,
    activeConnection,
    activeEnvironment,
  }
}
