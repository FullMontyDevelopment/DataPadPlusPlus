import { useCallback, useMemo } from 'react'
import { desktopClient } from '../../services/runtime/client'
import {
  createConnectionProfile,
  createEnvironmentProfile,
  ensureWorkspaceUnlocked,
  secretRefForConnection,
} from './app-state-factories'
import type { Actions, AppActionContext } from './app-state-types'

type ConnectionActions = Pick<
  Actions,
  | 'selectConnection'
  | 'selectEnvironment'
  | 'createConnection'
  | 'duplicateConnection'
  | 'deleteConnection'
  | 'saveConnection'
  | 'createEnvironment'
  | 'saveEnvironment'
  | 'deleteEnvironment'
>

export function useConnectionActions({
  state,
  applyPayload,
  handleError,
}: AppActionContext): ConnectionActions {
  const selectConnection = useCallback<Actions['selectConnection']>(
    async (connectionId) => {
      try {
        applyPayload(await desktopClient.setActiveConnection(connectionId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const selectEnvironment = useCallback<Actions['selectEnvironment']>(
    async (tabId, environmentId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.setTabEnvironment(tabId, environmentId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createConnection = useCallback<Actions['createConnection']>(
    async () => {
      try {
        if (!state.payload) {
          throw new Error('Workspace is not ready for connection creation.')
        }
        ensureWorkspaceUnlocked(state.payload)
        let environmentId =
          state.payload.snapshot.ui.activeEnvironmentId ||
          state.payload.snapshot.environments[0]?.id

        if (!environmentId) {
          const environment = createEnvironmentProfile()
          environmentId = environment.id
          await desktopClient.upsertEnvironment(environment)
        }

        const profile = createConnectionProfile(environmentId)

        await desktopClient.upsertConnection(profile)
        await desktopClient.createQueryTab(profile.id)
        applyPayload(
          await desktopClient.updateUiState({
            activeActivity: 'library',
            activeSidebarPane: 'library',
            rightDrawer: 'connection',
          }),
        )
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const duplicateConnection = useCallback<Actions['duplicateConnection']>(
    async (connectionId) => {
      try {
        if (!state.payload) {
          throw new Error('Workspace is not ready for connection duplication.')
        }
        ensureWorkspaceUnlocked(state.payload)
        const source = state.payload.snapshot.connections.find(
          (connection) => connection.id === connectionId,
        )

        if (!source) {
          throw new Error('Connection was not found.')
        }

        const profile = createConnectionProfile(
          state.payload.snapshot.ui.activeEnvironmentId,
          source,
        )

        await desktopClient.upsertConnection(profile)
        await desktopClient.createQueryTab(profile.id)
        applyPayload(
          await desktopClient.updateUiState({
            activeActivity: 'library',
            activeSidebarPane: 'library',
            rightDrawer: 'connection',
          }),
        )
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const deleteConnection = useCallback<Actions['deleteConnection']>(
    async (connectionId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteConnection(connectionId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveConnection = useCallback<Actions['saveConnection']>(
    async (profile, secret) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        let nextProfile = profile

        if (secret?.trim()) {
          const secretRef = profile.auth.secretRef ?? secretRefForConnection(profile)
          await desktopClient.storeSecret(secretRef, secret)
          nextProfile = {
            ...profile,
            auth: {
              ...profile.auth,
              secretRef,
            },
            updatedAt: new Date().toISOString(),
          }
        }

        await desktopClient.upsertConnection(nextProfile)
        applyPayload(await desktopClient.updateUiState({ rightDrawer: 'none' }))
        return true
      } catch (error) {
        handleError(error)
        return false
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createEnvironment = useCallback<Actions['createEnvironment']>(
    async () => {
      try {
        if (!state.payload) {
          throw new Error('Workspace is not ready for environment creation.')
        }
        ensureWorkspaceUnlocked(state.payload)

        const environmentCount = state.payload.snapshot.environments.length
        const environment = createEnvironmentProfile({
          label: environmentCount === 0 ? 'Local' : `Environment ${environmentCount + 1}`,
        })
        await desktopClient.upsertEnvironment(environment)
        applyPayload(await desktopClient.createEnvironmentTab(environment.id))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveEnvironment = useCallback<Actions['saveEnvironment']>(
    async (profile) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.upsertEnvironment(profile))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const deleteEnvironment = useCallback<Actions['deleteEnvironment']>(
    async (environmentId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteEnvironment(environmentId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  return useMemo(
    () => ({
      selectConnection,
      selectEnvironment,
      createConnection,
      duplicateConnection,
      deleteConnection,
      saveConnection,
      createEnvironment,
      saveEnvironment,
      deleteEnvironment,
    }),
    [
      createConnection,
      createEnvironment,
      deleteEnvironment,
      deleteConnection,
      duplicateConnection,
      saveConnection,
      saveEnvironment,
      selectConnection,
      selectEnvironment,
    ],
  )
}
