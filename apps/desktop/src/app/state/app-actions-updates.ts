import { useCallback, useMemo } from 'react'
import { desktopClient } from '../../services/runtime/client'
import { toUserMessage } from './app-state-selectors'
import type { Actions, AppActionContext } from './app-state-types'

type UpdateActions = Pick<
  Actions,
  | 'getAppUpdateSettings'
  | 'setAppUpdateSettings'
  | 'checkAppUpdate'
  | 'installAppUpdate'
>

export function useUpdateActions({
  dispatch,
  handleError,
}: AppActionContext): UpdateActions {
  const getAppUpdateSettings = useCallback<Actions['getAppUpdateSettings']>(
    async () => {
      try {
        const settings = await desktopClient.getAppUpdateSettings()
        dispatch({ type: 'APP_UPDATE_SETTINGS_READY', settings })
        return settings
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [dispatch, handleError],
  )

  const setAppUpdateSettings = useCallback<Actions['setAppUpdateSettings']>(
    async (includePrereleases) => {
      try {
        const settings = await desktopClient.setAppUpdateSettings(includePrereleases)
        dispatch({ type: 'APP_UPDATE_SETTINGS_READY', settings })
      } catch (error) {
        handleError(error)
      }
    },
    [dispatch, handleError],
  )

  const checkAppUpdate = useCallback<Actions['checkAppUpdate']>(
    async () => {
      dispatch({ type: 'APP_UPDATE_CHECKING' })
      try {
        const result = await desktopClient.checkAppUpdate()
        dispatch({ type: 'APP_UPDATE_CHECK_READY', result })
        return result
      } catch (error) {
        const message = toUserMessage(error, 'Unable to check for updates.')
        dispatch({ type: 'APP_UPDATE_CHECK_ERROR', message })
        return undefined
      }
    },
    [dispatch],
  )

  const installAppUpdate = useCallback<Actions['installAppUpdate']>(
    async () => {
      dispatch({ type: 'APP_UPDATE_INSTALLING' })
      try {
        await desktopClient.installAppUpdate((event) => {
          dispatch({ type: 'APP_UPDATE_DOWNLOAD_EVENT', event })
        })
        dispatch({ type: 'APP_UPDATE_INSTALLED' })
      } catch (error) {
        const message = toUserMessage(error, 'Unable to install the update.')
        dispatch({ type: 'APP_UPDATE_INSTALL_ERROR', message })
      }
    },
    [dispatch],
  )

  return useMemo(
    () => ({
      getAppUpdateSettings,
      setAppUpdateSettings,
      checkAppUpdate,
      installAppUpdate,
    }),
    [
      checkAppUpdate,
      getAppUpdateSettings,
      installAppUpdate,
      setAppUpdateSettings,
    ],
  )
}
