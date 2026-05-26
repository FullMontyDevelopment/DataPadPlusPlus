import { useCallback, useMemo } from 'react'
import { desktopClient } from '../../services/runtime/client'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import type { Actions, AppActionContext } from './app-state-types'

type WorkspaceActions = Pick<
  Actions,
  | 'openWorkbenchMessages'
  | 'dismissWorkbenchMessage'
  | 'clearWorkbenchMessages'
  | 'setTheme'
  | 'updateUiState'
  | 'refreshDiagnostics'
  | 'exportWorkspace'
  | 'importWorkspace'
>

export function useWorkspaceActions({
  state,
  dispatch,
  applyPayload,
  handleError,
}: AppActionContext): WorkspaceActions {
  const dismissWorkbenchMessage = useCallback<Actions['dismissWorkbenchMessage']>(
    (id) => {
      dispatch({ type: 'WORKBENCH_MESSAGE_DISMISSED', id })
    },
    [dispatch],
  )

  const clearWorkbenchMessages = useCallback<Actions['clearWorkbenchMessages']>(
    () => {
      dispatch({ type: 'WORKBENCH_MESSAGES_CLEARED' })
    },
    [dispatch],
  )

  const openWorkbenchMessages = useCallback<Actions['openWorkbenchMessages']>(
    () => {
      dispatch({ type: 'WORKBENCH_MESSAGES_OPENED' })
    },
    [dispatch],
  )

  const setTheme = useCallback<Actions['setTheme']>(
    async (theme) => {
      try {
        applyPayload(await desktopClient.setTheme(theme))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const updateUiState = useCallback<Actions['updateUiState']>(
    async (patch) => {
      try {
        applyPayload(await desktopClient.updateUiState(patch))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const refreshDiagnostics = useCallback<Actions['refreshDiagnostics']>(
    async () => {
      try {
        const diagnostics = await desktopClient.createDiagnosticsReport()
        dispatch({ type: 'DIAGNOSTICS_READY', diagnostics })
      } catch (error) {
        handleError(error)
      }
    },
    [dispatch, handleError],
  )

  const exportWorkspace = useCallback<Actions['exportWorkspace']>(
    async (passphrase, includeSecrets = false) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        const exportBundle = await desktopClient.exportWorkspaceBundle(passphrase, includeSecrets)
        dispatch({ type: 'EXPORT_READY', exportBundle })
      } catch (error) {
        handleError(error)
      }
    },
    [dispatch, handleError, state.payload],
  )

  const importWorkspace = useCallback<Actions['importWorkspace']>(
    async (passphrase, encryptedPayload) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(
          await desktopClient.importWorkspaceBundle(passphrase, encryptedPayload),
        )
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  return useMemo(
    () => ({
      openWorkbenchMessages,
      dismissWorkbenchMessage,
      clearWorkbenchMessages,
      setTheme,
      updateUiState,
      refreshDiagnostics,
      exportWorkspace,
      importWorkspace,
    }),
    [
      clearWorkbenchMessages,
      dismissWorkbenchMessage,
      exportWorkspace,
      importWorkspace,
      openWorkbenchMessages,
      refreshDiagnostics,
      setTheme,
      updateUiState,
    ],
  )
}
