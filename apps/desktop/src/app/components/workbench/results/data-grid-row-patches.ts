import type { Dispatch, SetStateAction } from 'react'

export type DataGridRowPatches = Record<number, string[] | undefined>

const rowVersionIds = new WeakMap<string[][], number>()
let nextRowVersionId = 1

export function dataGridRowsVersion(rows: string[][], columns: string[]) {
  let id = rowVersionIds.get(rows)
  if (!id) {
    id = nextRowVersionId
    nextRowVersionId += 1
    rowVersionIds.set(rows, id)
  }

  return `${id}\u0000${columns.join('\u0000')}`
}

export function applyDataGridRowPatches(
  rows: string[][],
  patches: DataGridRowPatches,
): string[][] {
  const patchIndexes = Object.keys(patches).map(Number).filter(Number.isFinite)
  const maxLength = Math.max(rows.length, patchIndexes.length ? Math.max(...patchIndexes) + 1 : 0)
  const nextRows: string[][] = []

  for (let index = 0; index < maxLength; index += 1) {
    if (Object.prototype.hasOwnProperty.call(patches, index)) {
      const patchedRow = patches[index]
      if (patchedRow) {
        nextRows.push([...patchedRow])
      }
      continue
    }

    const row = rows[index]
    if (row) {
      nextRows.push([...row])
    }
  }

  return nextRows
}

export function diffDataGridRows(baseRows: string[][], nextRows: string[][]): DataGridRowPatches {
  const patches: DataGridRowPatches = {}
  const maxLength = Math.max(baseRows.length, nextRows.length)

  for (let index = 0; index < maxLength; index += 1) {
    const baseRow = baseRows[index]
    const nextRow = nextRows[index]

    if (!nextRow) {
      if (baseRow) {
        patches[index] = undefined
      }
      continue
    }

    if (!baseRow || !rowsEqual(baseRow, nextRow)) {
      patches[index] = [...nextRow]
    }
  }

  return patches
}

export function createDataGridRowPatchUpdater({
  baseRows,
  currentPatches,
  action,
}: {
  baseRows: string[][]
  currentPatches: DataGridRowPatches
  action: SetStateAction<string[][]>
}) {
  const currentRows = applyDataGridRowPatches(baseRows, currentPatches)
  const nextRows = typeof action === 'function'
    ? (action as (current: string[][]) => string[][])(currentRows)
    : action

  return diffDataGridRows(baseRows, nextRows)
}

export type DataGridRowsSetter = Dispatch<SetStateAction<string[][]>>

function rowsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((cell, index) => cell === right[index])
}
