import { useEffect, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  KeyValuePayload,
  OperationPlanRequest,
  OperationPlanResponse,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from './data-edit-confirmation'
import { useDataEditConfirmation } from './use-data-edit-confirmation'
import {
  KeyValueAddPanel,
  KeyValueDeletePanel,
  KeyValueRenamePanel,
  KeyValueTtlPanel,
} from './KeyValueEditPanels'
import { KeyValueEntryRows } from './KeyValueEntryRows'
import { KeyValueContextMenu } from './KeyValueContextMenu'
import {
  buildKeyValueEditRequest,
  buildRedisMemberDeleteRequest,
  buildRedisMemberEditRequest,
  keyValueCanEdit,
  parseKeyValueInput,
} from './keyvalue-edit-requests'
import { ClockIcon, DownloadIcon, RenameIcon, TrashIcon, UnlockIcon, UploadIcon } from '../icons'

interface KeyValueResultsViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  entries: Record<string, string>
  payload?: KeyValuePayload
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onPlanOperation?(
    request: OperationPlanRequest,
  ): Promise<OperationPlanResponse | undefined>
}

interface ContextMenuState {
  keyName: string
  x: number
  y: number
}

interface PendingDeleteState {
  keyName: string
  rawValue?: string
  target: 'key' | 'member'
}

interface PendingTtlState {
  keyName: string
  seconds: string
}

interface PendingAddState {
  keyName: string
  value: string
}

interface PendingRenameState {
  keyName: string
  nextKeyName: string
}

export function KeyValueResultsView({
  connection,
  editContext,
  entries,
  payload,
  onExecuteDataEdit,
  onPlanOperation,
}: KeyValueResultsViewProps) {
  const [draftEntries, setDraftEntries] = useState(entries)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string>()
  const [editingValue, setEditingValue] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState>()
  const [pendingTtl, setPendingTtl] = useState<PendingTtlState>()
  const [pendingAdd, setPendingAdd] = useState<PendingAddState>()
  const [pendingRename, setPendingRename] = useState<PendingRenameState>()
  const [statusMessage, setStatusMessage] = useState('')
  const { confirmDataEdit, confirmationDialog } = useDataEditConfirmation()
  const canEdit = keyValueCanEdit(connection, editContext) && Boolean(onExecuteDataEdit)
  const rows = useMemo(
    () =>
      Object.entries(draftEntries).map(([keyName, rawValue]) => ({
        keyName,
        rawValue,
        parsedValue: parseKeyValueInput(rawValue),
      })),
    [draftEntries],
  )

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const close = () => setContextMenu(undefined)
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  const beginValueEdit = (keyName: string, rawValue: string) => {
    if (!canEdit) {
      return
    }

    setEditingKey(keyName)
    setEditingValue(rawValue)
  }

  const commitValueEdit = async () => {
    if (!editingKey) {
      return
    }

    const nextValue = parseKeyValueInput(editingValue)
    const request =
      selectedKey && redisType && redisType !== 'string'
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

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Update ${keyName}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Apply this key edit?',
    })
    if (response?.executed) {
      setDraftEntries((current) => ({
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

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Add ${keyName}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Create this key?',
    })
    if (response?.executed) {
      setDraftEntries((current) => ({
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

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Set TTL for ${keyName}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Apply this TTL change?',
    })
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

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Remove TTL for ${keyName}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Remove this TTL?',
    })
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

    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Rename ${keyName} to ${nextKeyName}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Rename this key?',
    })
    if (response?.executed) {
      setDraftEntries((current) => {
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

  const deleteKey = async () => {
    if (!pendingDelete || !onExecuteDataEdit) {
      return
    }

    const request = pendingDelete.target === 'member' && selectedKey
      ? buildRedisMemberDeleteRequest({
          connection,
          editContext,
          key: selectedKey,
          member: pendingDelete.keyName,
          rawValue: pendingDelete.rawValue,
          redisType,
        })
      : buildKeyValueEditRequest({
          connection,
          editContext,
          editKind: 'delete-key',
          key: pendingDelete.keyName,
        })
    const keyName = pendingDelete.keyName
    const deleteTarget = pendingDelete.target
    setPendingDelete(undefined)

    if (!request) {
      setStatusMessage(`Delete is not available for this ${redisType ?? 'Redis'} item.`)
      return
    }

    const response = await executeDataEditWithConfirmation(
      onExecuteDataEdit,
      request,
      {
        actionLabel: deleteTarget === 'member' && selectedKey
          ? `Delete ${keyName} from ${selectedKey}.`
          : `Delete ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: deleteTarget === 'member' ? 'Delete this Redis item?' : 'Delete this key?',
      },
    )
    if (response?.executed) {
      setDraftEntries((current) => {
        const next = { ...current }
        if (deleteTarget === 'key' && selectedKey === keyName) {
          return {}
        }
        delete next[keyName]
        return next
      })
      setStatusMessage(deleteTarget === 'member' && selectedKey
        ? `Deleted ${keyName} from ${selectedKey}.`
        : `Deleted ${keyName}.`)
    } else {
      setStatusMessage(dataEditStatusMessage(response, `Unable to delete ${keyName}.`))
    }
  }

  const redisType = payload?.redisType
  const selectedKey = payload?.key
  const canPlanKeyOperation = Boolean(onPlanOperation && selectedKey && connection && editContext)

  const planKeyExport = async () => {
    if (!onPlanOperation || !selectedKey || !connection || !editContext) {
      return
    }

    const response = await onPlanOperation({
      connectionId: connection.id,
      environmentId: editContext.environmentId,
      operationId: `${connection.engine}.key.export`,
      objectName: selectedKey,
      parameters: {
        key: selectedKey,
        redisType: redisType ?? 'unknown',
        format: 'json',
        includeTtl: true,
        includeType: true,
        includeMetadata: true,
      },
    })

    setStatusMessage(
      response?.plan
        ? `Export plan ready for ${selectedKey}.`
        : `Unable to prepare export for ${selectedKey}.`,
    )
  }

  const planKeyImport = async () => {
    if (!onPlanOperation || !selectedKey || !connection || !editContext) {
      return
    }

    const response = await onPlanOperation({
      connectionId: connection.id,
      environmentId: editContext.environmentId,
      operationId: `${connection.engine}.key.import`,
      objectName: selectedKey,
      parameters: {
        key: selectedKey,
        redisType: redisType ?? 'string',
        format: 'json',
        mode: 'create-or-replace',
        ttl: 'preserve',
        validation: 'validate-before-write',
      },
    })

    setStatusMessage(
      response?.plan
        ? `Import plan ready for ${selectedKey}.`
        : `Unable to prepare import for ${selectedKey}.`,
    )
  }

  return (
    <div className="keyvalue-results" aria-label="Key-value results">
      {selectedKey ? (
        <div className="redis-key-detail-header">
          <div className="redis-key-detail-identity">
            <strong>{selectedKey}</strong>
            <span className={`redis-type-badge is-${redisType ?? 'unknown'}`}>
              {redisType ?? 'unknown'}
            </span>
          </div>
          <span>{payload?.ttl ?? 'TTL unavailable'}</span>
          <span>{payload?.memoryUsage ?? 'Memory unavailable'}</span>
          {payload?.encoding ? <span>{payload.encoding}</span> : null}
          {payload?.length !== undefined ? <span>{payload.length} item(s)</span> : null}
          {canEdit || canPlanKeyOperation ? (
            <div className="redis-key-detail-actions">
              {canPlanKeyOperation ? (
                <>
                  <button
                    type="button"
                    className="object-view-icon-action"
                    aria-label={`Export key ${selectedKey}`}
                    title="Export key"
                    onClick={() => void planKeyExport()}
                  >
                    <DownloadIcon className="toolbar-icon" />
                  </button>
                  <button
                    type="button"
                    className="object-view-icon-action"
                    aria-label={`Import key ${selectedKey}`}
                    title="Import key"
                    onClick={() => void planKeyImport()}
                  >
                    <UploadIcon className="toolbar-icon" />
                  </button>
                </>
              ) : null}
              {canEdit ? (
                <>
                  <button
                    type="button"
                    className="object-view-icon-action"
                    aria-label={`Rename key ${selectedKey}`}
                    title="Rename key"
                    onClick={() => setPendingRename({ keyName: selectedKey, nextKeyName: selectedKey })}
                  >
                    <RenameIcon className="toolbar-icon" />
                  </button>
                  <button
                    type="button"
                    className="object-view-icon-action"
                    aria-label={`Set TTL for ${selectedKey}`}
                    title="Set TTL"
                    onClick={() => setPendingTtl({ keyName: selectedKey, seconds: '3600' })}
                  >
                    <ClockIcon className="toolbar-icon" />
                  </button>
                  <button
                    type="button"
                    className="object-view-icon-action"
                    aria-label={`Remove TTL for ${selectedKey}`}
                    title="Remove TTL"
                    onClick={() => void persistTtl(selectedKey)}
                  >
                    <UnlockIcon className="toolbar-icon" />
                  </button>
                  <button
                    type="button"
                    className="object-view-icon-action is-danger redis-key-detail-delete"
                    aria-label={`Delete key ${selectedKey}`}
                    title="Delete key"
                    onClick={() => setPendingDelete({ keyName: selectedKey, target: 'key' })}
                  >
                    <TrashIcon className="toolbar-icon" />
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="keyvalue-results-header" role="row">
        <span>{redisType === 'hash' ? 'Field' : redisType === 'list' ? 'Index' : redisType === 'zset' ? 'Member' : 'Key'}</span>
        <span>Type</span>
        <span>Value</span>
      </div>
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
          editingKey={editingKey}
          editingValue={editingValue}
          expandedKeys={expandedKeys}
          rows={rows}
          onBeginValueEdit={beginValueEdit}
          onCancelEdit={() => setEditingKey(undefined)}
          onCommitValueEdit={() => void commitValueEdit()}
          onOpenContextMenu={(keyName, x, y) => setContextMenu({ keyName, x, y })}
          onToggleExpanded={(keyName) =>
            setExpandedKeys((current) => {
              const next = new Set(current)
              if (next.has(keyName)) {
                next.delete(keyName)
              } else {
                next.add(keyName)
              }
              return next
            })
          }
          onUpdateEditingValue={setEditingValue}
        />
      </div>
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
      {pendingDelete ? (
        <KeyValueDeletePanel
          itemLabel={pendingDelete.target === 'member' ? redisMemberLabel(redisType).toLowerCase() : 'key'}
          keyName={pendingDelete.keyName}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => void deleteKey()}
        />
      ) : null}
      {confirmationDialog}
      {statusMessage ? <div className="data-grid-status">{statusMessage}</div> : null}
      {contextMenu ? (
        <KeyValueContextMenu
          canEdit={canEdit}
          canDelete={canEdit && canDeleteRedisContextTarget(selectedKey, redisType)}
          canPersistTtl={canEdit && (!selectedKey || redisType === 'string')}
          canRename={canEdit && (!selectedKey || redisType === 'string')}
          canSetTtl={canEdit && (!selectedKey || redisType === 'string')}
          copyKeyLabel={selectedKey && redisType !== 'string' ? `Copy ${redisMemberLabel(redisType)}` : 'Copy Key'}
          deleteLabel={selectedKey && redisType !== 'string' ? `Delete ${redisMemberLabel(redisType)}` : 'Delete Key'}
          keyName={contextMenu.keyName}
          rawValue={draftEntries[contextMenu.keyName] ?? ''}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(undefined)}
          onEdit={() => beginValueEdit(contextMenu.keyName, draftEntries[contextMenu.keyName] ?? '')}
          onPersistTtl={() => void persistTtl(contextMenu.keyName)}
          onRename={() => setPendingRename({ keyName: contextMenu.keyName, nextKeyName: contextMenu.keyName })}
          onSetTtl={() => setPendingTtl({ keyName: contextMenu.keyName, seconds: '3600' })}
          onDelete={() => {
            if (!connection) {
              return
            }
            setPendingDelete({
              keyName: contextMenu.keyName,
              rawValue: draftEntries[contextMenu.keyName],
              target: selectedKey && redisType !== 'string' ? 'member' : 'key',
            })
          }}
        />
      ) : null}
    </div>
  )
}

function canDeleteRedisContextTarget(selectedKey: string | undefined, redisType: string | undefined) {
  if (!selectedKey || redisType === 'string') {
    return true
  }

  return redisType === 'hash' || redisType === 'set' || redisType === 'zset'
}

function redisMemberLabel(redisType: string | undefined) {
  if (redisType === 'hash') {
    return 'Field'
  }
  if (redisType === 'zset' || redisType === 'set') {
    return 'Member'
  }
  return 'Item'
}

function serializedKeyValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function redisEditKindForValue(
  redisType: string,
): 'hash-set-field' | 'list-set-index' | 'set-add-member' | 'zset-add-member' {
  switch (redisType) {
    case 'hash':
      return 'hash-set-field'
    case 'list':
      return 'list-set-index'
    case 'set':
      return 'set-add-member'
    case 'zset':
      return 'zset-add-member'
    default:
      return 'hash-set-field'
  }
}
