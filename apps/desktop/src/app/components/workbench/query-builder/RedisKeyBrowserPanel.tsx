import type {
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  RedisKeyBrowserState,
  RedisKeyInspectRequest,
  RedisKeyScanRequest,
  RedisKeyScanResponse,
  RedisKeySummary,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ColumnIcon,
  KeyValueIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TableIcon,
} from '../icons'
import {
  buildRedisKeyBrowserQueryText,
  REDIS_KEY_TYPE_FILTERS,
} from './redis-key-browser'
import {
  mergeRedisKeys,
  parseRedisInitialValue,
  redisTreeRows,
} from './redis-key-browser-tree'
import {
  RedisKeyBrowserRows,
} from './RedisKeyBrowserRows'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from '../results/data-edit-confirmation'
import { useDataEditConfirmation } from '../results/use-data-edit-confirmation'

interface RedisKeyBrowserPanelProps {
  tab: QueryTabState
  builderState: RedisKeyBrowserState
  onBuilderStateChange?(tabId: string, builderState: QueryBuilderState): void
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
  onInspectRedisKey?(request: RedisKeyInspectRequest): Promise<void>
  onScanRedisKeys?(request: RedisKeyScanRequest): Promise<RedisKeyScanResponse | undefined>
}

export function RedisKeyBrowserPanel({
  tab,
  builderState,
  onBuilderStateChange,
  onExecuteDataEdit,
  onInspectRedisKey,
  onScanRedisKeys,
}: RedisKeyBrowserPanelProps) {
  const [keys, setKeys] = useState<RedisKeySummary[]>([])
  const [cursor, setCursor] = useState(builderState.cursor ?? '0')
  const [scannedCount, setScannedCount] = useState(builderState.scannedCount ?? 0)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [showAddKey, setShowAddKey] = useState(false)
  const [addKeyName, setAddKeyName] = useState('')
  const [addKeyType, setAddKeyType] = useState('string')
  const [addKeyValue, setAddKeyValue] = useState('')
  const scanRequestIdRef = useRef(0)
  const { confirmDataEdit, confirmationDialog } = useDataEditConfirmation()
  const [expandedPrefixes, setExpandedPrefixes] = useState<Set<string>>(
    () => new Set(builderState.expandedPrefixes ?? []),
  )
  const viewMode = builderState.viewMode ?? 'tree'
  const databaseIndex = builderState.databaseIndex ?? 0
  const delimiter = builderState.delimiter ?? ':'
  const ttlFilter = builderState.filters?.ttl ?? 'all'
  const rows = useMemo(
    () =>
      viewMode === 'tree'
        ? redisTreeRows(keys, expandedPrefixes, delimiter)
        : keys.map((key) => ({ kind: 'key' as const, id: key.key, depth: 0, key })),
    [delimiter, expandedPrefixes, keys, viewMode],
  )

  const updateBuilder = useCallback(
    (patch: Partial<RedisKeyBrowserState>) => {
      const next: RedisKeyBrowserState = {
        ...builderState,
        ...patch,
      }
      next.lastAppliedQueryText = buildRedisKeyBrowserQueryText(next)
      onBuilderStateChange?.(tab.id, next)
    },
    [builderState, onBuilderStateChange, tab.id],
  )

  const scan = useCallback(
    async ({ reset }: { reset: boolean }) => {
      if (!onScanRedisKeys) {
        return
      }

      const requestId = scanRequestIdRef.current + 1
      scanRequestIdRef.current = requestId
      setLoading(true)
      const response = await onScanRedisKeys({
        tabId: tab.id,
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        pattern: builderState.pattern || '*',
        typeFilter: builderState.typeFilter,
        databaseIndex,
        delimiter,
        cursor: reset ? '0' : cursor,
        count: builderState.scanCount ?? builderState.pageSize ?? 100,
        pageSize: builderState.pageSize ?? 100,
        filters: builderState.filters,
      })

      if (requestId !== scanRequestIdRef.current) {
        return
      }

      setLoading(false)

      if (!response) {
        return
      }

      setKeys((current) => mergeRedisKeys(reset ? [] : current, response.keys))
      setCursor(response.nextCursor ?? '0')
      setScannedCount((current) =>
        reset ? response.scannedCount : current + response.scannedCount,
      )
      setStatus(response.warnings[0] ?? '')
    },
    [
      builderState.filters,
      builderState.pageSize,
      builderState.pattern,
      builderState.scanCount,
      builderState.typeFilter,
      cursor,
      databaseIndex,
      delimiter,
      onScanRedisKeys,
      tab.connectionId,
      tab.environmentId,
      tab.id,
    ],
  )

  useEffect(() => {
    const scanTimer = window.setTimeout(() => {
      void scan({ reset: true })
    }, 250)
    return () => window.clearTimeout(scanTimer)
    // Scan is intentionally tied to the stable query controls, not every status/cursor update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    builderState.pattern,
    builderState.typeFilter,
    builderState.pageSize,
    databaseIndex,
    delimiter,
    ttlFilter,
    tab.id,
  ])

  const selectKey = (key: string) => {
    updateBuilder({ selectedKey: key })
    void onInspectRedisKey?.({
      tabId: tab.id,
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      key,
      sampleSize: builderState.pageSize ?? 100,
    })
  }

  const addKey = async () => {
    if (!onExecuteDataEdit || !addKeyName.trim()) {
      return
    }

    const value = addKeyType === 'string' ? addKeyValue : parseRedisInitialValue(addKeyValue)
    const keyName = addKeyName.trim()
    const response = await executeDataEditWithConfirmation(
      onExecuteDataEdit,
      {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        editKind: 'set-key-value',
        target: {
          objectKind: 'key',
          path: [],
          key: keyName,
        },
        changes: [{ value, valueType: addKeyType }],
      },
      {
        actionLabel: `Add Redis key ${keyName}.`,
        confirm: confirmDataEdit,
        confirmationTitle: 'Create this Redis key?',
      },
    )

    if (response?.executed) {
      setShowAddKey(false)
      setAddKeyName('')
      setAddKeyValue('')
      void scan({ reset: true })
    } else {
      setStatus(dataEditStatusMessage(response, 'Unable to add Redis key.'))
    }
  }

  const deleteKey = async (key: string) => {
    if (!onExecuteDataEdit) {
      setStatus('Redis key deletion is not available for this connection.')
      return
    }

    setStatus(`Deleting ${key}...`)
    const response = await onExecuteDataEdit({
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      editKind: 'delete-key',
      target: {
        objectKind: 'key',
        path: [],
        key,
      },
      changes: [],
    })

    if (response?.executed) {
      setKeys((current) => current.filter((item) => item.key !== key))
      setStatus(`Deleted ${key}.`)
    } else {
      setStatus(dataEditStatusMessage(response, `Unable to delete ${key}.`))
    }
  }

  const requestDeleteKey = (key: string) => {
    setStatus('')
    void deleteKey(key)
  }

  const togglePrefix = (prefix: string) => {
    const next = new Set(expandedPrefixes)
    if (next.has(prefix)) {
      next.delete(prefix)
    } else {
      next.add(prefix)
    }
    setExpandedPrefixes(next)
    updateBuilder({ expandedPrefixes: Array.from(next) })
  }

  return (
    <section className="redis-browser-panel" aria-label="Redis key browser">
      <div className="redis-browser-toolbar">
        <div className="redis-browser-view-toggle" aria-label="Redis browser view">
          <button
            type="button"
            className={viewMode === 'tree' ? 'is-active' : ''}
            aria-label="Tree view"
            title="Tree view"
            onClick={() => updateBuilder({ viewMode: 'tree' })}
          >
            <KeyValueIcon className="toolbar-icon" />
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'is-active' : ''}
            aria-label="List view"
            title="List view"
            onClick={() => updateBuilder({ viewMode: 'list' })}
          >
            <TableIcon className="toolbar-icon" />
          </button>
        </div>
        <label className="redis-browser-compact-field">
          <span>DB</span>
          <input
            aria-label="Redis database index"
            type="number"
            min={0}
            value={databaseIndex}
            onChange={(event) =>
              updateBuilder({
                databaseIndex: Math.max(0, Number(event.target.value) || 0),
                selectedKey: undefined,
              })
            }
          />
        </label>
        <select
          aria-label="Redis key type"
          value={builderState.typeFilter}
          onChange={(event) =>
            updateBuilder({
              typeFilter: event.target.value as RedisKeyBrowserState['typeFilter'],
              selectedKey: undefined,
            })
          }
        >
          {REDIS_KEY_TYPE_FILTERS.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Redis TTL filter"
          value={ttlFilter}
          onChange={(event) =>
            updateBuilder({
              filters: {
                ...(builderState.filters ?? {}),
                ttl: event.target.value as NonNullable<RedisKeyBrowserState['filters']>['ttl'],
              },
              selectedKey: undefined,
            })
          }
        >
          <option value="all">All TTLs</option>
          <option value="expiring">Expiring</option>
          <option value="persistent">Persistent</option>
        </select>
        <label className="redis-browser-compact-field">
          <span>Delimiter</span>
          <input
            aria-label="Redis namespace delimiter"
            value={delimiter}
            maxLength={3}
            onChange={(event) =>
              updateBuilder({
                delimiter: event.target.value || ':',
                expandedPrefixes: [],
              })
            }
          />
        </label>
        <label className="redis-browser-pattern">
          <SearchIcon className="toolbar-icon" />
          <input
            aria-label="Filter by key name or pattern"
            value={builderState.pattern}
            placeholder="Filter by Key Name or Pattern"
            onChange={(event) =>
              updateBuilder({
                pattern: event.target.value || '*',
                selectedKey: undefined,
              })
            }
          />
        </label>
        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Refresh keys"
          title="Refresh keys"
          disabled={loading}
          onClick={() => void scan({ reset: true })}
        >
          <RefreshIcon className="toolbar-icon" />
        </button>
        <button
          type="button"
          className="drawer-button"
          onClick={() => setShowAddKey((current) => !current)}
        >
          <PlusIcon className="toolbar-icon" />
          Add Key
        </button>
      </div>

      <div className="redis-browser-status">
        <span>
          Results: {keys.length.toLocaleString()}. Scanned {scannedCount.toLocaleString()}
        </span>
        {cursor !== '0' ? (
          <button type="button" onClick={() => void scan({ reset: false })}>
            Scan more
          </button>
        ) : null}
        {loading ? <span>Loading</span> : null}
        <span className="redis-browser-status-spacer" />
        <button
          type="button"
          className="toolbar-icon-action"
          aria-label="Columns"
          title="Columns"
          onClick={() => updateBuilder({ visibleColumns: ['ttl', 'memory', 'length'] })}
        >
          <ColumnIcon className="toolbar-icon" />
        </button>
      </div>
      {status ? <div className="redis-browser-message">{status}</div> : null}

      {showAddKey ? (
        <div className="redis-browser-add-key">
          <input
            aria-label="New Redis key"
            placeholder="key:name"
            value={addKeyName}
            onChange={(event) => setAddKeyName(event.target.value)}
          />
          <select
            aria-label="New Redis key type"
            value={addKeyType}
            onChange={(event) => setAddKeyType(event.target.value)}
          >
            <option value="string">String</option>
            <option value="json">JSON string</option>
          </select>
          <input
            aria-label="New Redis key initial value"
            placeholder="Initial value"
            value={addKeyValue}
            onChange={(event) => setAddKeyValue(event.target.value)}
          />
          <button type="button" className="drawer-button" onClick={() => setShowAddKey(false)}>
            Cancel
          </button>
          <button type="button" className="drawer-button drawer-button--primary" onClick={() => void addKey()}>
            Add
          </button>
        </div>
      ) : null}

      <RedisKeyBrowserRows
        rows={rows}
        selectedKey={builderState.selectedKey}
        expandedPrefixes={expandedPrefixes}
        onDeleteKey={requestDeleteKey}
        onSelectKey={selectKey}
        onTogglePrefix={togglePrefix}
      />
      {confirmationDialog}
    </section>
  )
}
