import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DocumentGridRow } from './document-grid-model'

const DOCUMENT_GRID_ROW_HEIGHT = 30
const DOCUMENT_GRID_OVERSCAN = 24

interface DocumentVirtualGridRowsProps {
  rows: DocumentGridRow[]
  renderRow(row: DocumentGridRow): ReactNode
}

export function DocumentVirtualGridRows({
  rows,
  renderRow,
}: DocumentVirtualGridRowsProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  // TanStack Virtual is intentionally imperative here; it keeps MB-sized document
  // trees from mounting thousands of rows while preserving the current treegrid UI.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => DOCUMENT_GRID_ROW_HEIGHT,
    overscan: DOCUMENT_GRID_OVERSCAN,
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
          start: index * DOCUMENT_GRID_ROW_HEIGHT,
        }))

  return (
    <div ref={parentRef} className="document-data-grid" role="treegrid" aria-label="Document result table">
      <div className="document-data-grid-row document-data-grid-row--header" role="row">
        <div className="document-data-grid-cell document-data-grid-cell--id" role="columnheader">
          key / _id
        </div>
        <div className="document-data-grid-cell document-data-grid-cell--type" role="columnheader">
          type
        </div>
        <div className="document-data-grid-cell document-data-grid-cell--value" role="columnheader">
          value
        </div>
      </div>
      <div
        className="document-data-grid-virtual-space"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {renderedRows.map((virtualRow) => {
          const row = rows[virtualRow.index]

          return row ? (
            <div
              key={virtualRow.key}
              className="document-data-grid-virtual-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(row)}
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}
