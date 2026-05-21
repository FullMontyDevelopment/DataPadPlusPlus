import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
} from '@datapadplusplus/shared-types'
import { computeRenderedColumnWidths } from './data-grid-layout'
import { DataGridContextMenu } from './DataGridContextMenu'
import { DataGridDeleteConfirmation } from './DataGridDeleteConfirmation'
import { DataGridInsertRow } from './DataGridInsertRow'
import { DataGridRows } from './DataGridRows'
import {
  autoFitColumnWidth,
  buildVisibleGridRows,
  DATA_GRID_HEADER_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  gridTextForMode,
  type GridSelection,
  type GridSort,
  ROW_NUMBER_WIDTH,
} from './data-grid-model'
import { DataGridToolbar } from './DataGridToolbar'
import { useDataGridEditing } from './data-grid-editing'
import type { DocumentEditContext } from './document-edit-context'
import { clearFieldDragData, writeFieldDragData } from './field-drag'
import { copyText } from './payload-export'
import { buildDataGridRowDeleteRequest } from './data-grid-edit-requests'

interface DataGridViewProps {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  columns: string[]
  rows: string[][]
  onExecuteDataEdit?(request: DataEditExecutionRequest): Promise<DataEditExecutionResponse | undefined>
}

interface ContextMenuState { sourceIndex: number; x: number; y: number }
interface PendingDeleteState { expectedText: string; rowNumber: number; sourceIndex: number }

export function DataGridView({
  connection,
  editContext,
  columns,
  rows,
  onExecuteDataEdit,
}: DataGridViewProps) {
  const [draftRows, setDraftRows] = useState(rows)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<GridSort>()
  const [focusedCell, setFocusedCell] = useState<{ row: number; column: number }>()
  const [selection, setSelection] = useState<GridSelection>()
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({})
  const [copyMessage, setCopyMessage] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState>()
  const [viewportWidth, setViewportWidth] = useState(0)
  const parentRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ row: number; column: number } | null>(null)
  const resizeStartRef = useRef<{ column: number; x: number; width: number } | null>(null)
  const {
    beginEdit,
    canDeleteRow,
    canEditCell,
    canInsertRow,
    cancelEdit,
    commitEdit,
    deleteRow,
    editingCell,
    insertRow,
    updateEditingValue,
  } = useDataGridEditing({
    columns,
    connection,
    editContext,
    rows: draftRows,
    setRows: setDraftRows,
    setStatusMessage: setCopyMessage,
    onExecuteDataEdit,
  })

  const visibleRows = useMemo(
    () => buildVisibleGridRows(draftRows, filter, sort),
    [draftRows, filter, sort],
  )

  // TanStack Virtual intentionally returns imperative helpers; keep this component un-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    initialRect: { width: 800, height: 360 },
    estimateSize: () => 30,
    overscan: 16,
  })
  const renderedColumnWidths = useMemo(
    () => computeRenderedColumnWidths(columns, columnWidths, viewportWidth),
    [columns, columnWidths, viewportWidth],
  )
  const renderedGridWidth =
    ROW_NUMBER_WIDTH + renderedColumnWidths.reduce((total, width) => total + width, 0)
  const virtualItems = virtualizer.getVirtualItems()
  const renderedRows =
    virtualItems.length > 0
      ? virtualItems.map((item) => ({
          key: item.key,
          index: item.index,
          start: item.start,
        }))
      : visibleRows.map((_row, index) => ({
          key: index,
          index,
          start: index * 30,
        }))

  useEffect(() => {
    setDraftRows(rows)
  }, [rows])

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

  const toggleSort = (column: number) => {
    setSort((current) => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' }
      }

      if (current.direction === 'asc') {
        return { column, direction: 'desc' }
      }

      return undefined
    })
  }

  const autoFitColumn = (column: number) => {
    setColumnWidths((current) => ({
      ...current,
      [column]: autoFitColumnWidth(column, columns, visibleRows),
    }))
  }

  const beginResize = (column: number, x: number) => {
    resizeStartRef.current = {
      column,
      x,
      width: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH,
    }
  }

  const updateResize = (x: number) => {
    const resize = resizeStartRef.current

    if (!resize) {
      return
    }

    setColumnWidths((current) => ({
      ...current,
      [resize.column]: Math.max(72, resize.width + x - resize.x),
    }))
  }

  const finishResize = () => {
    resizeStartRef.current = null
  }

  useEffect(() => {
    const parent = parentRef.current

    if (!parent) {
      return
    }

    const updateViewportWidth = () => setViewportWidth(parent.clientWidth)
    updateViewportWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportWidth)
      return () => window.removeEventListener('resize', updateViewportWidth)
    }

    const observer = new ResizeObserver(updateViewportWidth)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const beginSelection = (row: number, column: number) => {
    dragStartRef.current = { row, column }
    setFocusedCell({ row, column })
    setSelection({ startRow: row, startColumn: column, endRow: row, endColumn: column })
  }

  const updateSelection = (row: number, column: number) => {
    const start = dragStartRef.current

    if (!start) {
      return
    }

    setSelection({
      startRow: start.row,
      startColumn: start.column,
      endRow: row,
      endColumn: column,
    })
  }

  const finishSelection = () => {
    dragStartRef.current = null
  }

  const selectRow = (row: number) => {
    dragStartRef.current = null
    setFocusedCell({ row, column: 0 })
    setSelection({
      startRow: row,
      startColumn: 0,
      endRow: row,
      endColumn: Math.max(columns.length - 1, 0),
    })
  }

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isPlatformCopyShortcut(event) || isEditableKeyboardTarget(event.target)) {
      return
    }

    event.preventDefault()
    void copySelection('selection')
  }

  const copySelection = async (mode: 'selection' | 'row' | 'all') => {
    const text = gridTextForMode(mode, columns, visibleRows.map((item) => item.row), selection)

    if (!text) {
      return
    }

    await copyText(text)
    setCopyMessage(`Copied ${mode === 'all' ? 'all buffered rows' : mode}.`)
  }

  const promptDeleteRow = (sourceIndex: number) => {
    const request = buildDataGridRowDeleteRequest({
      columns,
      connection,
      editContext,
      row: draftRows[sourceIndex] ?? [],
    })

    if (!request?.confirmationText) {
      setCopyMessage('Delete unavailable; DataPad++ could not identify a complete primary key.')
      return
    }

    setPendingDelete({
      expectedText: request.confirmationText,
      rowNumber: sourceIndex + 1,
      sourceIndex,
    })
  }

  return (
    <div className="data-grid-shell">
      <DataGridToolbar
        filter={filter}
        onFilterChange={setFilter}
      />
      {copyMessage ? <div className="data-grid-status">{copyMessage}</div> : null}
      <DataGridInsertRow columns={columns} canInsert={canInsertRow()} onInsert={insertRow} />
      {pendingDelete ? (
        <DataGridDeleteConfirmation
          expectedText={pendingDelete.expectedText}
          rowNumber={pendingDelete.rowNumber}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            const sourceIndex = pendingDelete.sourceIndex
            setPendingDelete(undefined)
            void deleteRow(sourceIndex)
          }}
        />
      ) : null}
      <div
        className="data-grid"
        ref={parentRef}
        role="grid"
        tabIndex={0}
        aria-label="Table results grid"
        onKeyDown={handleGridKeyDown}
        onPointerMove={(event) => updateResize(event.clientX)}
        onPointerUp={() => {
          finishResize()
          finishSelection()
        }}
        onPointerLeave={finishSelection}
      >
        <div
          className="data-grid-inner"
          style={{
            height: virtualizer.getTotalSize() + DATA_GRID_HEADER_HEIGHT,
            width: renderedGridWidth,
          }}
        >
          <div className="data-grid-row data-grid-row--header">
            <div className="data-grid-cell data-grid-cell--row-number">#</div>
            {columns.map((column, columnIndex) => (
              <div
                key={column}
                className="data-grid-cell data-grid-cell--header"
                style={{ width: renderedColumnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH }}
              >
                <button
                  type="button"
                  className="data-grid-header-button"
                  title={`Sort by ${column}`}
                  draggable
                  onClick={() => toggleSort(columnIndex)}
                  onDragStart={(event) => writeFieldDragData(event, column)}
                  onDragEnd={clearFieldDragData}
                  onDoubleClick={() => autoFitColumn(columnIndex)}
                >
                  <span>{column}</span>
                  {sort?.column === columnIndex ? (
                    <span className="data-grid-sort">{sort.direction === 'asc' ? 'ASC' : 'DESC'}</span>
                  ) : null}
                </button>
                <span
                  className="data-grid-resizer"
                  role="separator"
                  aria-label={`Resize ${column}`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    beginResize(columnIndex, event.clientX)
                  }}
                  onDoubleClick={() => autoFitColumn(columnIndex)}
                />
              </div>
            ))}
          </div>
          <DataGridRows
            columns={columns}
            editingCell={editingCell}
            focusedCell={focusedCell}
            renderedColumnWidths={renderedColumnWidths}
            renderedRows={renderedRows}
            selection={selection}
            visibleRows={visibleRows}
            canEditCell={canEditCell}
            onBeginEdit={(sourceIndex, column, value) => {
              const started = beginEdit(sourceIndex, column, value)
              if (started) {
                dragStartRef.current = null
              }
              return started
            }}
            onBeginSelection={beginSelection}
            onCancelEdit={cancelEdit}
            onCommitEdit={() => void commitEdit()}
            onOpenRowMenu={(sourceIndex, visibleIndex, x, y) => {
              setFocusedCell({ row: visibleIndex, column: 0 })
              setSelection({
                startRow: visibleIndex,
                startColumn: 0,
                endRow: visibleIndex,
                endColumn: columns.length - 1,
              })
              setContextMenu({ sourceIndex, x, y })
            }}
            onSelectRow={selectRow}
            onUpdateEditingValue={updateEditingValue}
            onUpdateSelection={updateSelection}
          />
        </div>
      </div>
      {contextMenu && canDeleteRow(contextMenu.sourceIndex) ? (
        <DataGridContextMenu
          canDelete={canDeleteRow(contextMenu.sourceIndex)}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(undefined)}
          onDeleteRow={() => promptDeleteRow(contextMenu.sourceIndex)}
        />
      ) : null}
    </div>
  )
}

function isPlatformCopyShortcut(event: ReactKeyboardEvent) {
  if (event.key.toLowerCase() !== 'c' || event.altKey || event.shiftKey) {
    return false
  }

  const platform =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform
      : ''
  const isApplePlatform = /\b(mac|iphone|ipad|ipod)\b/i.test(platform)

  return isApplePlatform
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()

  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  )
}
