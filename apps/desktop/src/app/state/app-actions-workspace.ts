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
  | 'setSafeModeEnabled'
  | 'updateUiState'
  | 'refreshDiagnostics'
  | 'exportResultFile'
  | 'exportWorkspace'
  | 'importWorkspace'
  | 'exportWorkspaceFile'
  | 'importWorkspaceFile'
  | 'updateWorkspaceBackupSettings'
  | 'listWorkspaceBackups'
  | 'createWorkspaceBackupNow'
  | 'restoreWorkspaceBackup'
  | 'deleteWorkspaceBackup'
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

  const setSafeModeEnabled = useCallback<Actions['setSafeModeEnabled']>(
    async (enabled) => {
      try {
        applyPayload(await desktopClient.setSafeModeEnabled(enabled))
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

  const exportResultFile = useCallback<Actions['exportResultFile']>(
    async (request) => {
      try {
        return await desktopClient.exportResultFile(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
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

  const exportWorkspaceFile = useCallback<Actions['exportWorkspaceFile']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.exportWorkspaceBundleFile(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const importWorkspaceFile = useCallback<Actions['importWorkspaceFile']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.importWorkspaceBundleFile(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateWorkspaceBackupSettings = useCallback<Actions['updateWorkspaceBackupSettings']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateWorkspaceBackupSettings(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const listWorkspaceBackups = useCallback<Actions['listWorkspaceBackups']>(
    async () => {
      try {
        return await desktopClient.listWorkspaceBackups()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const createWorkspaceBackupNow = useCallback<Actions['createWorkspaceBackupNow']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.createWorkspaceBackupNow(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const restoreWorkspaceBackup = useCallback<Actions['restoreWorkspaceBackup']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.restoreWorkspaceBackup(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const deleteWorkspaceBackup = useCallback<Actions['deleteWorkspaceBackup']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.deleteWorkspaceBackup(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  return useMemo(
    () => ({
      openWorkbenchMessages,
      dismissWorkbenchMessage,
      clearWorkbenchMessages,
      setTheme,
      setSafeModeEnabled,
      updateUiState,
      refreshDiagnostics,
      exportResultFile,
      exportWorkspace,
      importWorkspace,
      exportWorkspaceFile,
      importWorkspaceFile,
      updateWorkspaceBackupSettings,
      listWorkspaceBackups,
      createWorkspaceBackupNow,
      restoreWorkspaceBackup,
      deleteWorkspaceBackup,
    }),
    [
      clearWorkbenchMessages,
      dismissWorkbenchMessage,
      exportWorkspace,
      exportResultFile,
      exportWorkspaceFile,
      importWorkspace,
      importWorkspaceFile,
      updateWorkspaceBackupSettings,
      listWorkspaceBackups,
      createWorkspaceBackupNow,
      restoreWorkspaceBackup,
      deleteWorkspaceBackup,
      openWorkbenchMessages,
      refreshDiagnostics,
      setSafeModeEnabled,
      setTheme,
      updateUiState,
    ],
  )
}
