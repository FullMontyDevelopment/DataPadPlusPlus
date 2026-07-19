import { useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionResponse,
  KeyValuePayload,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import type { DataEditConfirmationHandler, ExecuteDataEdit } from './data-edit-confirmation'
import {
  dataEditErrorMessage,
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from './data-edit-confirmation'
import { KeyValueJsonPathPanel } from './KeyValueEditPanels'
import {
  buildRedisJsonPathEditRequest,
  parseKeyValueInput,
} from './keyvalue-edit-requests'
import {
  deleteRedisJsonPathValue,
  serializedKeyValue,
  setRedisJsonPathValue,
} from './keyvalue-results-helpers'

interface PendingJsonPathState {
  path: string
  value: string
}

interface UseRedisJsonPathEditingOptions {
  canEdit: boolean
  confirmDataEdit: DataEditConfirmationHandler
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  entries: Record<string, string>
  onExecuteDataEdit?: ExecuteDataEdit
  payload?: KeyValuePayload
  selectedKey?: string
  setStatusMessage(value: string): void
  updateDraftEntries(updater: (current: Record<string, string>) => Record<string, string>): void
}

export function useRedisJsonPathEditing({
  canEdit,
  confirmDataEdit,
  connection,
  editContext,
  entries,
  onExecuteDataEdit,
  payload,
  selectedKey,
  setStatusMessage,
  updateDraftEntries,
}: UseRedisJsonPathEditingOptions) {
  const [pendingJsonPath, setPendingJsonPath] = useState<PendingJsonPathState>()
  const canEditJsonPaths = Boolean(
    canEdit &&
      connection?.engine === 'redis' &&
      selectedKey &&
      payload?.redisType === 'json' &&
      (payload?.supports?.jsonPaths ?? true),
  )

  const beginJsonPathEdit = (path: string, value: unknown) => {
    if (!canEditJsonPaths) {
      return
    }

    setPendingJsonPath({
      path,
      value: editableJsonValue(value),
    })
  }

  const commitJsonPathEdit = async () => {
    if (!pendingJsonPath || !selectedKey || !onExecuteDataEdit) {
      return
    }

    const nextValue = parseKeyValueInput(pendingJsonPath.value)
    const request = buildRedisJsonPathEditRequest({
      connection,
      editContext,
      editKind: 'json-set-path',
      key: selectedKey,
      path: pendingJsonPath.path,
      value: nextValue,
    })
    const path = pendingJsonPath.path
    setPendingJsonPath(undefined)

    if (!request) {
      return
    }

    let response: DataEditExecutionResponse | undefined
    try {
      response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
        actionLabel: `Set ${path} on ${selectedKey}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Apply this JSON edit?',
      })
    } catch (error) {
      setStatusMessage(dataEditErrorMessage(error, `Unable to update ${path}.`))
      return
    }
    if (response?.executed) {
      patchSelectedJsonEntry(selectedKey, entries, updateDraftEntries, (root) =>
        setRedisJsonPathValue(root, path, nextValue),
      )
      setStatusMessage(`Updated ${path} on ${selectedKey}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to update ${path}.`))
    }
  }

  const deleteJsonPath = async (path: string) => {
    if (!selectedKey || !onExecuteDataEdit) {
      return
    }

    const request = buildRedisJsonPathEditRequest({
      connection,
      editContext,
      editKind: 'json-delete-path',
      key: selectedKey,
      path,
    })
    if (!request) {
      return
    }

    let response: DataEditExecutionResponse | undefined
    try {
      response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
        actionLabel: `Delete ${path} from ${selectedKey}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Delete this JSON path?',
      })
    } catch (error) {
      setStatusMessage(dataEditErrorMessage(error, `Unable to delete ${path}.`))
      return
    }
    handleJsonDeleteResponse(response, selectedKey, path, entries, updateDraftEntries, setStatusMessage)
  }

  const jsonPathPanel = pendingJsonPath && selectedKey ? (
    <KeyValueJsonPathPanel
      keyName={selectedKey}
      path={pendingJsonPath.path}
      value={pendingJsonPath.value}
      onCancel={() => setPendingJsonPath(undefined)}
      onSetPath={() => void commitJsonPathEdit()}
      onValueChange={(value) =>
        setPendingJsonPath((current) => (current ? { ...current, value } : current))
      }
    />
  ) : null

  return {
    beginJsonPathEdit,
    canEditJsonPaths,
    deleteJsonPath,
    jsonPathPanel,
  }
}

function handleJsonDeleteResponse(
  response: DataEditExecutionResponse | undefined,
  selectedKey: string,
  path: string,
  entries: Record<string, string>,
  updateDraftEntries: UseRedisJsonPathEditingOptions['updateDraftEntries'],
  setStatusMessage: UseRedisJsonPathEditingOptions['setStatusMessage'],
) {
  if (response?.executed) {
    patchSelectedJsonEntry(selectedKey, entries, updateDraftEntries, (root) =>
      deleteRedisJsonPathValue(root, path),
    )
    setStatusMessage(`Deleted ${path} from ${selectedKey}.`)
  } else {
    setStatusMessage(dataEditStatusMessage(response, `Unable to delete ${path}.`))
  }
}

function patchSelectedJsonEntry(
  selectedKey: string,
  entries: Record<string, string>,
  updateDraftEntries: UseRedisJsonPathEditingOptions['updateDraftEntries'],
  updater: (root: unknown) => unknown,
) {
  updateDraftEntries((current) => {
    const currentRoot = parseKeyValueInput(current[selectedKey] ?? entries[selectedKey] ?? 'null')
    const nextRoot = updater(currentRoot)
    if (nextRoot === undefined) {
      const next = { ...current }
      delete next[selectedKey]
      return next
    }

    return {
      ...current,
      [selectedKey]: serializedKeyValue(nextRoot),
    }
  })
}

function editableJsonValue(value: unknown) {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  return JSON.stringify(value, null, 2) ?? 'null'
}
