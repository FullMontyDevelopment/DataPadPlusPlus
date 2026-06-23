import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TrashIcon } from '../../../icons'
import { redisKeyTypeLabel } from '../../../query-builder/redis-key-browser'
import type { RedisTreeRow } from '../../../query-builder/redis-key-browser-tree'

const REDIS_ROW_HEIGHT = 34
const REDIS_ROW_OVERSCAN = 18

interface RedisKeyBrowserRowsProps {
  rows: RedisTreeRow[]
  selectedKey?: string
  expandedPrefixes: Set<string>
  onTogglePrefix(prefix: string): void
  onSelectKey(key: string): void
  onDeleteKey(key: string): void
}

export function RedisKeyBrowserRows({
  rows,
  selectedKey,
  expandedPrefixes,
  onTogglePrefix,
  onSelectKey,
  onDeleteKey,
}: RedisKeyBrowserRowsProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  // Keeps large Redis keyspaces responsive while preserving the native key browser shape.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => REDIS_ROW_HEIGHT,
    overscan: REDIS_ROW_OVERSCAN,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const renderedRows =
    virtualItems.length > 0
      ? virtualItems.map((item) => ({
          key: item.key,
          index: item.index,
          start: item.start,
        }))
      : rows.map((_row, index) => ({
          key: index,
          index,
          start: index * REDIS_ROW_HEIGHT,
        }))

  return (
    <div className="redis-browser-table" role="treegrid" aria-rowcount={rows.length}>
      <div className="redis-browser-row redis-browser-row--header" role="row">
        <span>Key</span>
        <span>Type</span>
        <span>TTL</span>
        <span>Memory</span>
        <span>Length</span>
        <span />
      </div>
      <div ref={parentRef} className="redis-browser-rows">
        <div
          className="redis-browser-virtual-space"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {renderedRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) {
              return null
            }

            return (
              <div
                key={virtualRow.key}
                className="redis-browser-virtual-row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {row.kind === 'prefix' ? (
                  <RedisPrefixRow
                    row={row}
                    expanded={expandedPrefixes.has(row.id)}
                    onTogglePrefix={onTogglePrefix}
                  />
                ) : (
                  <RedisKeyRow
                    row={row}
                    selected={selectedKey === row.key.key}
                    onDeleteKey={onDeleteKey}
                    onSelectKey={onSelectKey}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RedisPrefixRow({
  expanded,
  row,
  onTogglePrefix,
}: {
  expanded: boolean
  row: Extract<RedisTreeRow, { kind: 'prefix' }>
  onTogglePrefix(prefix: string): void
}) {
  return (
    <button
      type="button"
      className="redis-browser-row redis-browser-row--prefix"
      style={{ '--redis-row-depth': row.depth } as CSSProperties}
      onClick={() => onTogglePrefix(row.id)}
    >
      <span>
        {expanded ? 'v' : '>'} {row.label}
      </span>
      <span />
      <span />
      <span />
      <span>{row.count}</span>
      <span />
    </button>
  )
}

function RedisKeyRow({
  row,
  selected,
  onDeleteKey,
  onSelectKey,
}: {
  row: Extract<RedisTreeRow, { kind: 'key' }>
  selected: boolean
  onDeleteKey(key: string): void
  onSelectKey(key: string): void
}) {
  return (
    <div
      className={`redis-browser-row redis-browser-row--key${selected ? ' is-selected' : ''}`}
      style={{ '--redis-row-depth': row.depth } as CSSProperties}
      role="row"
      onClick={() => onSelectKey(row.key.key)}
      onContextMenu={(event) => {
        event.preventDefault()
        onSelectKey(row.key.key)
      }}
      onDoubleClick={() => onSelectKey(row.key.key)}
    >
      <button
        type="button"
        className="redis-browser-key"
        onClick={(event) => {
          event.stopPropagation()
          onSelectKey(row.key.key)
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {row.key.key}
      </button>
      <span className={`redis-type-badge is-${row.key.type}`}>{redisKeyTypeLabel(row.key.type)}</span>
      <span>{row.key.ttlLabel ?? 'No limit'}</span>
      <span>{row.key.memoryUsageLabel ?? ''}</span>
      <span>{row.key.length ?? ''}</span>
      <button
        type="button"
        className="toolbar-icon-action"
        aria-label={`Delete ${row.key.key}`}
        title="Delete key"
        onClick={(event) => {
          event.stopPropagation()
          onDeleteKey(row.key.key)
        }}
      >
        <TrashIcon className="toolbar-icon" />
      </button>
    </div>
  )
}
