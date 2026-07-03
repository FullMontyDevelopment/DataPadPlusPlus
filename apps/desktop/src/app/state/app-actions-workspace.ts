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
  | 'setKeyboardShortcut'
  | 'setFirstInstallGuideStatus'
  | 'setExplorerFolderOrder'
  | 'updateUiState'
  | 'refreshDiagnostics'
  | 'listAppLogFiles'
  | 'readAppLogFile'
  | 'clearAppLogFile'
  | 'deleteAppLogFile'
  | 'exportResultFile'
  | 'exportWorkspace'
  | 'importWorkspace'
  | 'exportWorkspaceFile'
  | 'importWorkspaceFile'
  | 'getWorkspaceSwitcherStatus'
  | 'setWorkspaceSwitcherEnabled'
  | 'createWorkspace'
  | 'renameWorkspace'
  | 'switchWorkspace'
  | 'updateWorkspaceBackupSettings'
  | 'updateWorkspaceSearchSettings'
  | 'getDatastoreSecurityCheckStatus'
  | 'updateDatastoreSecurityCheckSettings'
  | 'refreshDatastoreSecurityChecks'
  | 'getDatastoreApiServerStatus'
  | 'getDatastoreApiServerMetrics'
  | 'getDatastoreApiServerLogs'
  | 'createDatastoreApiServer'
  | 'updateDatastoreApiServer'
  | 'discoverDatastoreApiServerResources'
  | 'discoverDatastoreApiServerQuerySources'
  | 'addDatastoreApiServerResources'
  | 'removeDatastoreApiServerResource'
  | 'addDatastoreApiServerCustomEndpoint'
  | 'updateDatastoreApiServerCustomEndpoint'
  | 'removeDatastoreApiServerCustomEndpoint'
  | 'exportDatastoreApiServerProjectFile'
  | 'updateDatastoreApiServerSettings'
  | 'startDatastoreApiServer'
  | 'stopDatastoreApiServer'
  | 'deleteDatastoreApiServer'
  | 'getDatastoreMcpServerStatus'
  | 'getDatastoreMcpServerMetrics'
  | 'getDatastoreMcpServerLogs'
  | 'createDatastoreMcpServer'
  | 'updateDatastoreMcpServer'
  | 'updateDatastoreMcpServerSettings'
  | 'startDatastoreMcpServer'
  | 'stopDatastoreMcpServer'
  | 'deleteDatastoreMcpServer'
  | 'createDatastoreMcpServerToken'
  | 'deleteDatastoreMcpServerToken'
  | 'previewDatastoreMcpClientSetup'
  | 'applyDatastoreMcpClientSetup'
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

  const setKeyboardShortcut = useCallback<Actions['setKeyboardShortcut']>(
    async (shortcutId, shortcut) => {
      try {
        applyPayload(await desktopClient.setKeyboardShortcut(shortcutId, shortcut))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const setFirstInstallGuideStatus = useCallback<Actions['setFirstInstallGuideStatus']>(
    async (status, currentStepId) => {
      try {
        applyPayload(await desktopClient.setFirstInstallGuideStatus(status, currentStepId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const setExplorerFolderOrder = useCallback<Actions['setExplorerFolderOrder']>(
    async (request) => {
      try {
        applyPayload(await desktopClient.setExplorerFolderOrder(request))
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

  const listAppLogFiles = useCallback<Actions['listAppLogFiles']>(
    async () => {
      try {
        return await desktopClient.listAppLogFiles()
      } catch (error) {
        if (!isMissingDesktopCommandError(error)) {
          handleError(error)
        }
        return undefined
      }
    },
    [handleError],
  )

  const readAppLogFile = useCallback<Actions['readAppLogFile']>(
    async (fileName) => {
      try {
        return await desktopClient.readAppLogFile(fileName)
      } catch (error) {
        if (!isMissingDesktopCommandError(error)) {
          handleError(error)
        }
        return undefined
      }
    },
    [handleError],
  )

  const clearAppLogFile = useCallback<Actions['clearAppLogFile']>(
    async (fileName) => {
      try {
        return await desktopClient.clearAppLogFile(fileName)
      } catch (error) {
        if (!isMissingDesktopCommandError(error)) {
          handleError(error)
        }
        return undefined
      }
    },
    [handleError],
  )

  const deleteAppLogFile = useCallback<Actions['deleteAppLogFile']>(
    async (fileName) => {
      try {
        return await desktopClient.deleteAppLogFile(fileName)
      } catch (error) {
        if (!isMissingDesktopCommandError(error)) {
          handleError(error)
        }
        return undefined
      }
    },
    [handleError],
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

  const getWorkspaceSwitcherStatus = useCallback<Actions['getWorkspaceSwitcherStatus']>(
    async () => {
      try {
        const status = await desktopClient.getWorkspaceSwitcherStatus()
        dispatch({ type: 'WORKSPACE_SWITCHER_STATUS_READY', status })
        return status
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [dispatch, handleError],
  )

  const refreshWorkspaceSwitcherStatus = useCallback(async () => {
    const status = await desktopClient.getWorkspaceSwitcherStatus()
    dispatch({ type: 'WORKSPACE_SWITCHER_STATUS_READY', status })
  }, [dispatch])

  const setWorkspaceSwitcherEnabled = useCallback<Actions['setWorkspaceSwitcherEnabled']>(
    async (request) => {
      try {
        const status = await desktopClient.setWorkspaceSwitcherEnabled(request)
        dispatch({ type: 'WORKSPACE_SWITCHER_STATUS_READY', status })
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [dispatch, handleError],
  )

  const createWorkspace = useCallback<Actions['createWorkspace']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.createWorkspace(request))
        await refreshWorkspaceSwitcherStatus()
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, refreshWorkspaceSwitcherStatus, state.payload],
  )

  const renameWorkspace = useCallback<Actions['renameWorkspace']>(
    async (request) => {
      try {
        const status = await desktopClient.renameWorkspace(request)
        dispatch({ type: 'WORKSPACE_SWITCHER_STATUS_READY', status })
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [dispatch, handleError],
  )

  const switchWorkspace = useCallback<Actions['switchWorkspace']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.switchWorkspace(request))
        await refreshWorkspaceSwitcherStatus()
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, refreshWorkspaceSwitcherStatus, state.payload],
  )

  const updateWorkspaceBackupSettings = useCallback<Actions['updateWorkspaceBackupSettings']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateWorkspaceBackupSettings(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateWorkspaceSearchSettings = useCallback<Actions['updateWorkspaceSearchSettings']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateWorkspaceSearchSettings(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const getDatastoreSecurityCheckStatus = useCallback<
    Actions['getDatastoreSecurityCheckStatus']
  >(
    async () => {
      try {
        return await desktopClient.getDatastoreSecurityCheckStatus()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const updateDatastoreSecurityCheckSettings = useCallback<
    Actions['updateDatastoreSecurityCheckSettings']
  >(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreSecurityCheckSettings(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const refreshDatastoreSecurityChecks = useCallback<
    Actions['refreshDatastoreSecurityChecks']
  >(
    async (request = { manual: true }) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.refreshDatastoreSecurityChecks(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const getDatastoreApiServerStatus = useCallback<Actions['getDatastoreApiServerStatus']>(
    async () => {
      try {
        return await desktopClient.getDatastoreApiServerStatus()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const getDatastoreApiServerMetrics = useCallback<Actions['getDatastoreApiServerMetrics']>(
    async () => {
      try {
        return await desktopClient.getDatastoreApiServerMetrics()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const getDatastoreApiServerLogs = useCallback<Actions['getDatastoreApiServerLogs']>(
    async (request) => {
      try {
        return await desktopClient.getDatastoreApiServerLogs(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const createDatastoreApiServer = useCallback<Actions['createDatastoreApiServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.createDatastoreApiServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateDatastoreApiServer = useCallback<Actions['updateDatastoreApiServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreApiServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const discoverDatastoreApiServerResources = useCallback<Actions['discoverDatastoreApiServerResources']>(
    async (request) => {
      try {
        return await desktopClient.discoverDatastoreApiServerResources(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const discoverDatastoreApiServerQuerySources = useCallback<Actions['discoverDatastoreApiServerQuerySources']>(
    async (request) => {
      try {
        return await desktopClient.discoverDatastoreApiServerQuerySources(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const addDatastoreApiServerResources = useCallback<Actions['addDatastoreApiServerResources']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.addDatastoreApiServerResources(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const removeDatastoreApiServerResource = useCallback<Actions['removeDatastoreApiServerResource']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.removeDatastoreApiServerResource(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const addDatastoreApiServerCustomEndpoint = useCallback<Actions['addDatastoreApiServerCustomEndpoint']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.addDatastoreApiServerCustomEndpoint(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateDatastoreApiServerCustomEndpoint = useCallback<Actions['updateDatastoreApiServerCustomEndpoint']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreApiServerCustomEndpoint(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const removeDatastoreApiServerCustomEndpoint = useCallback<Actions['removeDatastoreApiServerCustomEndpoint']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.removeDatastoreApiServerCustomEndpoint(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const exportDatastoreApiServerProjectFile = useCallback<Actions['exportDatastoreApiServerProjectFile']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.exportDatastoreApiServerProjectFile(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const updateDatastoreApiServerSettings = useCallback<Actions['updateDatastoreApiServerSettings']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreApiServerSettings(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const startDatastoreApiServer = useCallback<Actions['startDatastoreApiServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.startDatastoreApiServer(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const stopDatastoreApiServer = useCallback<Actions['stopDatastoreApiServer']>(
    async (request) => {
      try {
        return await desktopClient.stopDatastoreApiServer(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const deleteDatastoreApiServer = useCallback<Actions['deleteDatastoreApiServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteDatastoreApiServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const getDatastoreMcpServerStatus = useCallback<Actions['getDatastoreMcpServerStatus']>(
    async () => {
      try {
        return await desktopClient.getDatastoreMcpServerStatus()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const getDatastoreMcpServerMetrics = useCallback<Actions['getDatastoreMcpServerMetrics']>(
    async () => {
      try {
        return await desktopClient.getDatastoreMcpServerMetrics()
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const getDatastoreMcpServerLogs = useCallback<Actions['getDatastoreMcpServerLogs']>(
    async (request) => {
      try {
        return await desktopClient.getDatastoreMcpServerLogs(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const createDatastoreMcpServer = useCallback<Actions['createDatastoreMcpServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.createDatastoreMcpServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateDatastoreMcpServer = useCallback<Actions['updateDatastoreMcpServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreMcpServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const updateDatastoreMcpServerSettings = useCallback<Actions['updateDatastoreMcpServerSettings']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.updateDatastoreMcpServerSettings(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const startDatastoreMcpServer = useCallback<Actions['startDatastoreMcpServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.startDatastoreMcpServer(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const stopDatastoreMcpServer = useCallback<Actions['stopDatastoreMcpServer']>(
    async (request) => {
      try {
        return await desktopClient.stopDatastoreMcpServer(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const deleteDatastoreMcpServer = useCallback<Actions['deleteDatastoreMcpServer']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteDatastoreMcpServer(request))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createDatastoreMcpServerToken = useCallback<Actions['createDatastoreMcpServerToken']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.createDatastoreMcpServerToken(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const deleteDatastoreMcpServerToken = useCallback<Actions['deleteDatastoreMcpServerToken']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.deleteDatastoreMcpServerToken(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const previewDatastoreMcpClientSetup = useCallback<Actions['previewDatastoreMcpClientSetup']>(
    async (request) => {
      try {
        return await desktopClient.previewDatastoreMcpClientSetup(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError],
  )

  const applyDatastoreMcpClientSetup = useCallback<Actions['applyDatastoreMcpClientSetup']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.applyDatastoreMcpClientSetup(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
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
      setKeyboardShortcut,
      setFirstInstallGuideStatus,
      setExplorerFolderOrder,
      updateUiState,
      refreshDiagnostics,
      listAppLogFiles,
      readAppLogFile,
      clearAppLogFile,
      deleteAppLogFile,
      exportResultFile,
      exportWorkspace,
      importWorkspace,
      exportWorkspaceFile,
      importWorkspaceFile,
      getWorkspaceSwitcherStatus,
      setWorkspaceSwitcherEnabled,
      createWorkspace,
      renameWorkspace,
      switchWorkspace,
      updateWorkspaceBackupSettings,
      updateWorkspaceSearchSettings,
      getDatastoreSecurityCheckStatus,
      updateDatastoreSecurityCheckSettings,
      refreshDatastoreSecurityChecks,
      getDatastoreApiServerStatus,
      getDatastoreApiServerMetrics,
      getDatastoreApiServerLogs,
      createDatastoreApiServer,
      updateDatastoreApiServer,
      discoverDatastoreApiServerResources,
      discoverDatastoreApiServerQuerySources,
      addDatastoreApiServerResources,
      removeDatastoreApiServerResource,
      addDatastoreApiServerCustomEndpoint,
      updateDatastoreApiServerCustomEndpoint,
      removeDatastoreApiServerCustomEndpoint,
      exportDatastoreApiServerProjectFile,
      updateDatastoreApiServerSettings,
      startDatastoreApiServer,
      stopDatastoreApiServer,
      deleteDatastoreApiServer,
      getDatastoreMcpServerStatus,
      getDatastoreMcpServerMetrics,
      getDatastoreMcpServerLogs,
      createDatastoreMcpServer,
      updateDatastoreMcpServer,
      updateDatastoreMcpServerSettings,
      startDatastoreMcpServer,
      stopDatastoreMcpServer,
      deleteDatastoreMcpServer,
      createDatastoreMcpServerToken,
      deleteDatastoreMcpServerToken,
      previewDatastoreMcpClientSetup,
      applyDatastoreMcpClientSetup,
      listWorkspaceBackups,
      createWorkspaceBackupNow,
      restoreWorkspaceBackup,
      deleteWorkspaceBackup,
    }),
    [
      clearWorkbenchMessages,
      dismissWorkbenchMessage,
      createWorkspace,
      exportWorkspace,
      exportResultFile,
      exportWorkspaceFile,
      getWorkspaceSwitcherStatus,
      importWorkspace,
      importWorkspaceFile,
      updateWorkspaceBackupSettings,
      updateWorkspaceSearchSettings,
      getDatastoreSecurityCheckStatus,
      updateDatastoreSecurityCheckSettings,
      refreshDatastoreSecurityChecks,
      getDatastoreApiServerStatus,
      getDatastoreApiServerMetrics,
      getDatastoreApiServerLogs,
      createDatastoreApiServer,
      updateDatastoreApiServer,
      discoverDatastoreApiServerResources,
      discoverDatastoreApiServerQuerySources,
      addDatastoreApiServerResources,
      removeDatastoreApiServerResource,
      addDatastoreApiServerCustomEndpoint,
      updateDatastoreApiServerCustomEndpoint,
      removeDatastoreApiServerCustomEndpoint,
      exportDatastoreApiServerProjectFile,
      updateDatastoreApiServerSettings,
      startDatastoreApiServer,
      stopDatastoreApiServer,
      deleteDatastoreApiServer,
      getDatastoreMcpServerStatus,
      getDatastoreMcpServerMetrics,
      getDatastoreMcpServerLogs,
      createDatastoreMcpServer,
      updateDatastoreMcpServer,
      updateDatastoreMcpServerSettings,
      startDatastoreMcpServer,
      stopDatastoreMcpServer,
      deleteDatastoreMcpServer,
      createDatastoreMcpServerToken,
      deleteDatastoreMcpServerToken,
      previewDatastoreMcpClientSetup,
      applyDatastoreMcpClientSetup,
      listWorkspaceBackups,
      createWorkspaceBackupNow,
      restoreWorkspaceBackup,
      renameWorkspace,
      deleteWorkspaceBackup,
      openWorkbenchMessages,
      refreshDiagnostics,
      listAppLogFiles,
      readAppLogFile,
      clearAppLogFile,
      deleteAppLogFile,
      setSafeModeEnabled,
      setKeyboardShortcut,
      setFirstInstallGuideStatus,
      setExplorerFolderOrder,
      setWorkspaceSwitcherEnabled,
      setTheme,
      switchWorkspace,
      updateUiState,
    ],
  )
}

function isMissingDesktopCommandError(error: unknown) {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : ''
  return /Command\s+["']?[\w-]+["']?\s+not found/i.test(message)
}
