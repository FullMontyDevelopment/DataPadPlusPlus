import {
  DATA_GRID_HEADER_HEIGHT,
  DEFAULT_COLUMN_WIDTH,
  type GridSelection,
  isSelected,
  type VisibleGridRow,
} from './data-grid-model'
import type { EditingCell } from './data-grid-editing'
import type { Key } from 'react'

export interface RenderedGridRow {
  index: number
  key: Key
  start: number
}

interface DataGridRowsProps {
  columns: string[]
  editingCell?: EditingCell
  focusedCell?: { row: number; column: number }
  renderedColumnWidths: number[]
  renderedRows: RenderedGridRow[]
  selection?: GridSelection
  visibleRows: VisibleGridRow[]
  canEditCell(sourceIndex: number, column: number, value: string): boolean
  onBeginEdit(sourceIndex: number, column: number, value: string): boolean
  onBeginSelection(row: number, column: number): void
  onCancelEdit(): void
  onCommitEdit(): void
  onOpenRowMenu(
    sourceIndex: number,
    visibleIndex: number,
    x: number,
    y: number,
    originElement: HTMLElement,
  ): void
  onSelectRow(row: number): void
  onUpdateEditingValue(value: string): void
  onUpdateSelection(row: number, column: number): void
}

export function DataGridRows({
  columns,
  editingCell,
  focusedCell,
  renderedColumnWidths,
  renderedRows,
  selection,
  visibleRows,
  canEditCell,
  onBeginEdit,
  onBeginSelection,
  onCancelEdit,
  onCommitEdit,
  onOpenRowMenu,
  onSelectRow,
  onUpdateEditingValue,
  onUpdateSelection,
}: DataGridRowsProps) {
  return (
    <>
      {renderedRows.map((virtualRow) => {
        const rowItem = visibleRows[virtualRow.index]
        const row = rowItem?.row ?? []
        const rowSelected =
          columns.length > 0 &&
          isSelected(virtualRow.index, 0, selection) &&
          isSelected(virtualRow.index, columns.length - 1, selection)

        return (
          <div
            key={virtualRow.key}
            className="data-grid-row"
            tabIndex={-1}
            style={{ transform: `translateY(${virtualRow.start + DATA_GRID_HEADER_HEIGHT}px)` }}
            onContextMenu={(event) => {
              if (!rowItem) {
                return
              }

              event.preventDefault()
              onOpenRowMenu(
                rowItem.sourceIndex,
                virtualRow.index,
                event.clientX,
                event.clientY,
                event.currentTarget,
              )
            }}
          >
            <button
              type="button"
              className={`data-grid-cell data-grid-cell--row-number${rowSelected ? ' is-selected' : ''}`}
              aria-label={
                rowItem ? `Select row ${rowItem.sourceIndex + 1}` : 'Select empty row'
              }
              onPointerDown={(event) => {
                event.preventDefault()

                if (rowItem) {
                  onSelectRow(virtualRow.index)
                }
              }}
            >
              {rowItem ? rowItem.sourceIndex + 1 : ''}
            </button>
            {columns.map((column, columnIndex) => {
              const cell = row[columnIndex] ?? ''
              const selected = isSelected(virtualRow.index, columnIndex, selection)
              const focused =
                focusedCell?.row === virtualRow.index && focusedCell.column === columnIndex
              const sourceIndex = rowItem?.sourceIndex ?? -1
              const editable = rowItem ? canEditCell(sourceIndex, columnIndex, cell) : false
              const editing =
                sourceIndex >= 0 &&
                editingCell?.sourceIndex === sourceIndex &&
                editingCell.column === columnIndex

              return editing ? (
                <div
                  key={`${virtualRow.key}-${column}`}
                  className="data-grid-cell data-grid-cell--value is-editing"
                  style={{ width: renderedColumnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH }}
                >
                  <input
                    className="data-grid-cell-input"
                    aria-label={`Edit ${column} row ${sourceIndex + 1}`}
                    value={editingCell?.value ?? cell}
                    autoFocus
                    onBlur={onCommitEdit}
                    onChange={(event) => onUpdateEditingValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        onCommitEdit()
                      }

                      if (event.key === 'Escape') {
                        event.preventDefault()
                        onCancelEdit()
                      }
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  key={`${virtualRow.key}-${column}`}
                  type="button"
                  className={`data-grid-cell data-grid-cell--value${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${cell === '' ? ' is-empty' : ''}${editable ? ' is-editable' : ''}`}
                  style={{ width: renderedColumnWidths[columnIndex] ?? DEFAULT_COLUMN_WIDTH }}
                  title={editable ? `Double-click to edit ${column}` : cell || 'NULL / empty'}
                  onDoubleClick={() => {
                    if (rowItem) {
                      onBeginEdit(rowItem.sourceIndex, columnIndex, cell)
                    }
                  }}
                  onPointerDown={() => onBeginSelection(virtualRow.index, columnIndex)}
                  onPointerEnter={() => onUpdateSelection(virtualRow.index, columnIndex)}
                >
                  {cell || <span className="data-grid-null">NULL</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
