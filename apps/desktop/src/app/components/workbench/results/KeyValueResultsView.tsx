import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  KeyValuePayload,
  KeyValueValueReadRequest,
  KeyValueValueReadResult,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import { dataEditStatusMessage } from './data-edit-confirmation'
import { useDataEditConfirmation } from './use-data-edit-confirmation'
import {
  KeyValueAddPanel,
  KeyValueRenamePanel,
  KeyValueTtlPanel,
} from './KeyValueEditPanels'
import { KeyValueEntryRows } from './KeyValueEntryRows'
import { KeyValueContextMenu } from './KeyValueContextMenu'
import { KeyValueValueInspector } from './KeyValueValueInspector'
import { copyText } from './payload-export'
import { RedisKeyDetailHeader } from '../datastores/common/keyvalue/RedisKeyDetailHeader'
import {
  buildRedisJsonPathEditRequest,
  buildKeyValueEditRequest,
  buildRedisMemberDeleteRequest,
  buildRedisMemberEditRequest,
  keyValueCanEdit,
  parseKeyValueInput,
} from './keyvalue-edit-requests'
import {
  applyKeyValueEntryPatches,
  canDeleteRedisContextTarget,
  diffKeyValueEntries,
  keyValuePrimaryColumnLabel,
  keyValueEntriesVersion,
  type KeyValueEntryPatches,
  keyValueRowsFromEntries,
  redisContextTargetKind,
  redisEditKindForValue,
  redisMemberLabel,
  serializedKeyValue,
} from './keyvalue-results-helpers'
import { useRedisKeyFileOperations } from './use-redis-key-file-operations'
import { useRedisJsonPathEditing } from './use-redis-json-path-editing'
import {
  createKeyValueDataEditRunner,
  type ContextMenuState,
  type DeleteTarget,
  type EntryPatchState,
  type PendingAddState,
  type PendingRenameState,
  type PendingTtlState,
} from './keyvalue-data-edit-actions'

interface KeyValueResultsViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  entries: Record<string, string>
  payload?: KeyValuePayload
  executionLocked?: boolean
  theme?: string
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onPlanOperation?(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
  onReadKeyValue?(
    request: KeyValueValueReadRequest,
  ): Promise<KeyValueValueReadResult | undefined>
}

export function KeyValueResultsView({
  connection,
  editContext,
  entries,
  payload,
  executionLocked = false,
  theme = 'dark',
  onExecuteDataEdit,
  onPlanOperation,
  onReadKeyValue,
}: KeyValueResultsViewProps) {
  const entriesVersion = useMemo(
    () => keyValueEntriesVersion(entries, {
      key: payload?.key,
      redisType: payload?.redisType,
    }),
    [entries, payload?.key, payload?.redisType],
  )
  const [entryPatchState, setEntryPatchState] = useState<EntryPatchState>({
    patches: {},
    version: entriesVersion,
  })
  const [editingKey, setEditingKey] = useState<string>()
  const [editingValue, setEditingValue] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [pendingTtl, setPendingTtl] = useState<PendingTtlState>()
  const [pendingAdd, setPendingAdd] = useState<PendingAddState>()
  const [pendingRename, setPendingRename] = useState<PendingRenameState>()
  const [statusMessage, setStatusMessage] = useState('')
  const [inspector, setInspector] = useState<{
    keyName: string
    loading: boolean
    content?: KeyValueValueReadResult
    error?: string
  }>()
  const valueRequestIdRef = useRef(0)
  const [deletedSelectedKey, setDeletedSelectedKey] = useState<{ deletedKey: string; payloadKey: string }>()
  const {
    cancelDataEditConfirmation,
    confirmDataEdit,
    confirmationDialog,
  } = useDataEditConfirmation()
  const canEdit = keyValueCanEdit(connection, editContext) && Boolean(onExecuteDataEdit)
  const redisType = payload?.redisType
  const runDataEdit = createKeyValueDataEditRunner(onExecuteDataEdit, setStatusMessage)
  const canEditValues = canEdit && !['stream', 'timeseries', 'vectorset'].includes(redisType ?? '')
  const selectedKey = payload?.key
  const activeEntryPatches = entryPatchState.version === entriesVersion
    ? entryPatchState.patches
    : EMPTY_KEYVALUE_ENTRY_PATCHES
  const draftEntries = useMemo(
    () => applyKeyValueEntryPatches(entries, activeEntryPatches),
    [activeEntryPatches, entries],
  )
  const rows = useMemo(() => keyValueRowsFromEntries(draftEntries), [draftEntries])

  const updateDraftEntries = (updater: (current: Record<string, string>) => Record<string, string>) => {
    const nextDraft = updater(draftEntries)
    setEntryPatchState({
      patches: diffKeyValueEntries(entries, nextDraft),
      version: entriesVersion,
    })
    if (redisType === 'json' && inspector?.content?.contentKind === 'text') {
      const nextValue = nextDraft[inspector.keyName]
      if (nextValue !== undefined && decodeFullValueText(inspector.content) !== nextValue) {
        const bytes = new TextEncoder().encode(nextValue)
        setInspector((current) => current ? {
          ...current,
          content: {
            contentKind: 'text',
            byteLength: bytes.length,
            dataBase64: bytesToBase64(bytes),
          },
        } : current)
      }
    }
  }

  const {
    beginJsonPathEdit,
    canEditJsonPaths,
    deleteJsonPath,
    jsonPathPanel,
  } = useRedisJsonPathEditing({
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
  })
  const {
    canPlanKeyOperation,
    planKeyExport,
    planKeyImport,
  } = useRedisKeyFileOperations({
    connection,
    editContext,
    onPlanOperation,
    payload,
    selectedKey,
    setStatusMessage,
  })

  useEffect(() => {
    if (!executionLocked) {
      return
    }

    queueMicrotask(() => {
      cancelDataEditConfirmation()
      setEditingKey(undefined)
      setContextMenu(undefined)
      setPendingTtl(undefined)
      setPendingAdd(undefined)
      setPendingRename(undefined)
    })
  }, [cancelDataEditConfirmation, executionLocked])

  const beginValueEdit = (keyName: string, rawValue: string) => {
    if (!canEdit) {
      return
    }

    setEditingKey(keyName)
    setEditingValue(rawValue)
  }

  const loadFullValue = async (keyName: string, reveal: boolean) => {
    if (!onReadKeyValue || !editContext) {
      const message = 'Full value inspection is not available for this result.'
      setStatusMessage(message)
      if (reveal) setInspector({ keyName, loading: false, error: message })
      return undefined
    }
    const requestId = valueRequestIdRef.current + 1
    valueRequestIdRef.current = requestId
    if (reveal) setInspector({ keyName, loading: true })
    const containerValue = Boolean(selectedKey && redisType && !['string', 'json'].includes(redisType))
    const response = await onReadKeyValue({
      connectionId: editContext.connectionId,
      environmentId: editContext.environmentId,
      databaseIndex: payload?.databaseIndex,
      key: selectedKey ?? keyName,
      entryKey: containerValue ? keyName : undefined,
      redisType,
    })
    if (requestId !== valueRequestIdRef.current) return undefined
    if (!response) {
      const message = 'The complete value could not be loaded. Refresh the result and try again.'
      setStatusMessage(message)
      if (reveal) setInspector({ keyName, loading: false, error: message })
      return undefined
    }
    if (reveal) setInspector({ keyName, loading: false, content: response })
    return response
  }

  const copyFullValue = async (keyName: string) => {
    const response = await loadFullValue(keyName, false)
    if (!response) return
    await copyText(
      response.contentKind === 'binary'
        ? response.dataBase64
        : decodeFullValueText(response),
    )
    setStatusMessage(
      response.contentKind === 'binary'
        ? `Copied the complete ${keyName} value as Base64.`
        : `Copied the complete ${keyName} value.`,
    )
  }

  const beginFullValueEdit = async (keyName: string, content?: KeyValueValueReadResult) => {
    const response = content ?? await loadFullValue(keyName, true)
    if (!response) return
    if (response.contentKind === 'binary') {
      setStatusMessage('Binary values can be inspected and copied losslessly, but not edited as text.')
      return
    }
    setInspector(undefined)
    beginValueEdit(keyName, decodeFullValueText(response))
  }

  const commitValueEdit = async () => {
    if (!editingKey) {
      return
    }

    const nextValue = parseKeyValueInput(editingValue)
    const request =
      selectedKey && redisType === 'json'
        ? buildRedisJsonPathEditRequest({
            connection,
            editContext,
            editKind: 'json-set-path',
            key: selectedKey,
            path: '$',
            value: nextValue,
          })
      : selectedKey && redisType && redisType !== 'string'
        ? buildRedisMemberEditRequest({
            connection,
            editContext,
            editKind: redisEditKindForValue(redisType),
            key: selectedKey,
            field: editingKey,
            value: nextValue,
          })
        : buildKeyValueEditRequest({
            connection,
            editContext,
            editKind: 'set-key-value',
            key: selectedKey ?? editingKey,
            value: nextValue,
          })
    const keyName = editingKey
    setEditingKey(undefined)

    if (!request || !onExecuteDataEdit) {
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: `Update ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Apply this key edit?',
      },
      `Unable to update ${keyName}.`,
    )
    if (response?.executed) {
      updateDraftEntries((current) => ({
        ...current,
        [keyName]: serializedKeyValue(nextValue),
      }))
      setStatusMessage(`Updated ${keyName}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to update ${keyName}.`))
    }
  }

  const addKey = async () => {
    if (!pendingAdd || !onExecuteDataEdit) {
      return
    }

    const keyName = pendingAdd.keyName.trim()
    if (!keyName || draftEntries[keyName] !== undefined) {
      return
    }

    const nextValue = parseKeyValueInput(pendingAdd.value)
    const request = buildKeyValueEditRequest({
      connection,
      editContext,
      editKind: 'set-key-value',
      key: keyName,
      value: nextValue,
    })
    setPendingAdd(undefined)

    if (!request) {
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: `Add ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Create this key?',
      },
      `Unable to add ${keyName}.`,
    )
    if (response?.executed) {
      updateDraftEntries((current) => ({
        ...current,
        [keyName]: serializedKeyValue(nextValue),
      }))
      setStatusMessage(`Added ${keyName}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to add ${keyName}.`))
    }
  }

  const setTtl = async () => {
    if (!pendingTtl || !onExecuteDataEdit) {
      return
    }

    const seconds = Number(pendingTtl.seconds)
    const request = buildKeyValueEditRequest({
      connection,
      editContext,
      editKind: 'set-ttl',
      key: pendingTtl.keyName,
      value: Number.isFinite(seconds) ? Math.floor(seconds) : pendingTtl.seconds,
    })
    const keyName = pendingTtl.keyName
    setPendingTtl(undefined)

    if (!request) {
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: `Set TTL for ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Apply this TTL change?',
      },
      `Unable to set TTL for ${keyName}.`,
    )
    setStatusMessage(
      response?.executed
        ? `Set TTL for ${keyName}.`
        : dataEditStatusMessage(response, `Unable to set TTL for ${keyName}.`),
    )
  }

  const persistTtl = async (keyName: string) => {
    if (!onExecuteDataEdit) {
      return
    }

    const request = buildKeyValueEditRequest({
      connection,
      editContext,
      editKind: 'persist-ttl',
      key: keyName,
    })

    if (!request) {
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: `Remove TTL for ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Remove this TTL?',
      },
      `Unable to remove TTL for ${keyName}.`,
    )
    setStatusMessage(
      response?.executed
        ? `Removed TTL for ${keyName}.`
        : dataEditStatusMessage(response, `Unable to remove TTL for ${keyName}.`),
    )
  }

  const renameKey = async () => {
    if (!pendingRename || !onExecuteDataEdit) {
      return
    }

    const keyName = pendingRename.keyName
    const nextKeyName = pendingRename.nextKeyName.trim()
    if (!nextKeyName || nextKeyName === keyName || draftEntries[nextKeyName] !== undefined) {
      return
    }

    const request = buildKeyValueEditRequest({
      connection,
      editContext,
      editKind: 'rename-key',
      key: keyName,
      newName: nextKeyName,
    })
    setPendingRename(undefined)

    if (!request) {
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: `Rename ${keyName} to ${nextKeyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Rename this key?',
      },
      `Unable to rename ${keyName}.`,
    )
    if (response?.executed) {
      updateDraftEntries((current) => {
        const next = { ...current }
        next[nextKeyName] = current[keyName] ?? ''
        delete next[keyName]
        return next
      })
      setStatusMessage(`Renamed ${keyName} to ${nextKeyName}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to rename ${keyName}.`))
    }
  }

  const deleteKey = async (deleteTargetState: DeleteTarget) => {
    if (!onExecuteDataEdit) {
      return
    }

    const request = deleteTargetState.target === 'member' && selectedKey
      ? buildRedisMemberDeleteRequest({
          connection,
          editContext,
          key: selectedKey,
          member: deleteTargetState.keyName,
          rawValue: deleteTargetState.rawValue,
          redisType,
        })
      : buildKeyValueEditRequest({
          connection,
          editContext,
          editKind: 'delete-key',
          key: deleteTargetState.keyName,
        })
    const keyName = deleteTargetState.keyName
    const targetKind = deleteTargetState.target

    if (!request) {
      setStatusMessage(`Delete is not available for this ${redisType ?? 'key-value'} item.`)
      return
    }

    const response = await runDataEdit(
      request,
      {
        actionLabel: targetKind === 'member' && selectedKey
          ? `Delete ${keyName} from ${selectedKey}.`
          : `Delete ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: targetKind === 'member' ? 'Delete this item?' : 'Delete this key?',
      },
      `Unable to delete ${keyName}.`,
      request.editKind === 'delete-key' && targetKind === 'key',
    )

    if (response?.executed) {
      updateDraftEntries((current) => {
        const next = { ...current }
        if (targetKind === 'key' && selectedKey === keyName) {
          return {}
        }
        delete next[keyName]
        return next
      })
      if (targetKind === 'key' && selectedKey === keyName) {
        setDeletedSelectedKey({ deletedKey: keyName, payloadKey: selectedKey })
      }
      setStatusMessage(targetKind === 'member' && selectedKey
        ? `Deleted ${keyName} from ${selectedKey}.`
        : `Deleted ${keyName}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to delete ${keyName}.`))
    }
  }

  const selectedKeyDeleted = Boolean(
    selectedKey &&
      deletedSelectedKey?.payloadKey === selectedKey &&
      deletedSelectedKey.deletedKey === selectedKey,
  )
  return (
    <div className="keyvalue-results" aria-label="Key-value results">
      {payload && selectedKey && !selectedKeyDeleted ? (
        <RedisKeyDetailHeader
          canEdit={canEdit}
          canPlanKeyOperation={canPlanKeyOperation}
          payload={{ ...payload, key: selectedKey }}
          onDelete={() => void deleteKey({ keyName: selectedKey, target: 'key' })}
          onExport={() => void planKeyExport()}
          onImport={() => void planKeyImport()}
          onPersistTtl={() => void persistTtl(selectedKey)}
          onRename={() => setPendingRename({ keyName: selectedKey, nextKeyName: selectedKey })}
          onSetTtl={() => setPendingTtl({ keyName: selectedKey, seconds: '3600' })}
        />
      ) : null}
      <div className="keyvalue-results-header" role="row">
        <span>{keyValuePrimaryColumnLabel(redisType)}</span>
        <span>Type</span>
        <span>Value</span>
      </div>
      {payload?.sampleTruncated ? (
        <div className="keyvalue-preview-notice" role="status">
          Values in this grid are previews. Open or copy a value to load its complete contents.
        </div>
      ) : null}
      {canEdit ? (
        <div className="keyvalue-actions">
          <button
            type="button"
            className="drawer-button"
            onClick={() => setPendingAdd({ keyName: '', value: '' })}
          >
            Add Key
          </button>
        </div>
      ) : null}
      {pendingAdd ? (
        <KeyValueAddPanel
          duplicate={draftEntries[pendingAdd.keyName.trim()] !== undefined}
          keyName={pendingAdd.keyName}
          value={pendingAdd.value}
          onCancel={() => setPendingAdd(undefined)}
          onInsert={() => void addKey()}
          onKeyNameChange={(keyName) =>
            setPendingAdd((current) => (current ? { ...current, keyName } : current))
          }
          onValueChange={(value) =>
            setPendingAdd((current) => (current ? { ...current, value } : current))
          }
        />
      ) : null}
      {pendingRename ? (
        <KeyValueRenamePanel
          duplicate={draftEntries[pendingRename.nextKeyName.trim()] !== undefined}
          keyName={pendingRename.keyName}
          nextKeyName={pendingRename.nextKeyName}
          onCancel={() => setPendingRename(undefined)}
          onNextKeyNameChange={(nextKeyName) =>
            setPendingRename((current) => (current ? { ...current, nextKeyName } : current))
          }
          onRename={() => void renameKey()}
        />
      ) : null}
      <div className="keyvalue-results-body">
        <KeyValueEntryRows
          canEdit={canEdit}
          canEditValues={canEditValues}
          editingKey={editingKey}
          editingValue={editingValue}
          rows={rows}
          onBeginValueEdit={(keyName) => void beginFullValueEdit(keyName)}
          onCancelEdit={() => setEditingKey(undefined)}
          onCommitValueEdit={() => void commitValueEdit()}
          onOpenContextMenu={(keyName, x, y, originElement) =>
            setContextMenu({ keyName, originElement, x, y })}
          onViewValue={(keyName) => void loadFullValue(keyName, true)}
          onUpdateEditingValue={setEditingValue}
        />
      </div>
      {inspector ? (
        <KeyValueValueInspector
          canEdit={canEditValues}
          content={inspector.content}
          entryLabel={inspector.keyName}
          error={inspector.error}
          loading={inspector.loading}
          theme={theme}
          onBeginJsonPathEdit={canEditJsonPaths ? beginJsonPathEdit : undefined}
          onClose={() => {
            valueRequestIdRef.current += 1
            setInspector(undefined)
          }}
          onDeleteJsonPath={canEditJsonPaths ? (path) => void deleteJsonPath(path) : undefined}
          onEdit={() => void beginFullValueEdit(inspector.keyName, inspector.content)}
        />
      ) : null}
      {jsonPathPanel}
      {pendingTtl ? (
        <KeyValueTtlPanel
          keyName={pendingTtl.keyName}
          seconds={pendingTtl.seconds}
          onCancel={() => setPendingTtl(undefined)}
          onSecondsChange={(seconds) =>
            setPendingTtl((current) => (current ? { ...current, seconds } : current))
          }
          onSetTtl={() => void setTtl()}
        />
      ) : null}
      {confirmationDialog}
      {statusMessage ? <div className="data-grid-status" role="status">{statusMessage}</div> : null}
      {contextMenu ? (
        <KeyValueContextMenu
          canEdit={canEditValues}
          canDelete={canEdit && canDeleteRedisContextTarget(selectedKey, redisType)}
          canPersistTtl={canEdit && (!selectedKey || redisType === 'string')}
          canRename={canEdit && (!selectedKey || redisType === 'string')}
          canSetTtl={canEdit && (!selectedKey || redisType === 'string')}
          copyKeyLabel={selectedKey && redisType !== 'string' ? `Copy ${redisMemberLabel(redisType)}` : 'Copy Key'}
          deleteLabel={selectedKey && redisType !== 'string' ? `Delete ${redisMemberLabel(redisType)}` : 'Delete Key'}
          keyName={contextMenu.keyName}
          x={contextMenu.x}
          y={contextMenu.y}
          originElement={contextMenu.originElement}
          onClose={() => setContextMenu(undefined)}
          onCopyValue={() => void copyFullValue(contextMenu.keyName)}
          onEdit={() => void beginFullValueEdit(contextMenu.keyName)}
          onPersistTtl={() => void persistTtl(contextMenu.keyName)}
          onRename={() => setPendingRename({ keyName: contextMenu.keyName, nextKeyName: contextMenu.keyName })}
          onSetTtl={() => setPendingTtl({ keyName: contextMenu.keyName, seconds: '3600' })}
          onViewValue={() => void loadFullValue(contextMenu.keyName, true)}
          onDelete={() => {
            if (!connection) {
              return
            }
            setContextMenu(undefined)
            void deleteKey({
              keyName: contextMenu.keyName,
              rawValue: draftEntries[contextMenu.keyName],
              target: redisContextTargetKind(selectedKey, redisType),
            })
          }}
        />
      ) : null}
    </div>
  )
}

const EMPTY_KEYVALUE_ENTRY_PATCHES: KeyValueEntryPatches = {}

function decodeFullValueText(content: KeyValueValueReadResult) {
  const binary = globalThis.atob(content.dataBase64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function bytesToBase64(value: Uint8Array) {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}
