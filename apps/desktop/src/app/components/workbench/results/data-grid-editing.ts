import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import {
  buildDataGridCellEditRequest,
  buildDataGridRowInsertRequest,
  buildDataGridRowDeleteRequest,
} from './data-grid-edit-requests'
import {
  dataEditStatusMessage,
  executeDataEditWithConfirmation,
} from './data-edit-confirmation'

export interface EditingCell {
  sourceIndex: number
  column: number
  value: string
}

interface UseDataGridEditingOptions {
  columns: string[]
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  rows: string[][]
  setRows: Dispatch<SetStateAction<string[][]>>
  setStatusMessage(message: string): void
  onExecuteDataEdit?(
    request: DataEditExecutionRequest,
  ): Promise<DataEditExecutionResponse | undefined>
}

export function useDataGridEditing({
  columns,
  connection,
  editContext,
  rows,
  setRows,
  setStatusMessage,
  onExecuteDataEdit,
}: UseDataGridEditingOptions) {
  const [editingCell, setEditingCell] = useState<EditingCell>()
  const committingEditRef = useRef(false)

  const canEditCell = useCallback(
    (sourceIndex: number, column: number, value: string) => {
      if (!onExecuteDataEdit) {
        return false
      }

      return Boolean(
        buildDataGridCellEditRequest({
          columnIndex: column,
          columns,
          connection,
          editContext,
          row: rows[sourceIndex] ?? [],
          value,
        }),
      )
    },
    [columns, connection, editContext, onExecuteDataEdit, rows],
  )

  const beginEdit = useCallback(
    (sourceIndex: number, column: number, value: string) => {
      if (!canEditCell(sourceIndex, column, value)) {
        return false
      }

      setEditingCell({ sourceIndex, column, value })
      return true
    },
    [canEditCell],
  )

  const updateEditingValue = useCallback((value: string) => {
    setEditingCell((current) => (current ? { ...current, value } : current))
  }, [])

  const commitEdit = useCallback(async () => {
    const edit = editingCell

    if (!edit || committingEditRef.current) {
      return
    }

    committingEditRef.current = true
    const request = buildDataGridCellEditRequest({
      columnIndex: edit.column,
      columns,
      connection,
      editContext,
      row: rows[edit.sourceIndex] ?? [],
      value: edit.value,
    })

    setEditingCell(undefined)

    if (!request || !onExecuteDataEdit) {
      committingEditRef.current = false
      return
    }

    try {
      const response = await executeDataEditWithConfirmation(
        onExecuteDataEdit,
        request,
        {
          actionLabel: 'Update this cell.',
          confirmationTitle: 'Apply this row edit?',
        },
      )
      const failureMessage = dataEditStatusMessage(
        response,
        'Datastore did not confirm the edit.',
      )

      if (!response?.executed) {
        setStatusMessage(failureMessage)
        return
      }

      setRows((current) =>
        current.map((sourceRow, sourceIndex) =>
          sourceIndex === edit.sourceIndex
            ? sourceRow.map((cell, columnIndex) =>
                columnIndex === edit.column ? edit.value : cell,
              )
            : sourceRow,
        ),
      )
      setStatusMessage(response.messages.at(-1) ?? 'Updated cell.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to update cell.')
    } finally {
      committingEditRef.current = false
    }
  }, [
    columns,
    connection,
    editContext,
    editingCell,
    onExecuteDataEdit,
    rows,
    setRows,
    setStatusMessage,
  ])

  const cancelEdit = useCallback(() => {
    committingEditRef.current = false
    setEditingCell(undefined)
  }, [])

  const canInsertRow = useCallback(
    () =>
      Boolean(
        onExecuteDataEdit &&
          buildDataGridRowInsertRequest({
            columns,
            connection,
            editContext,
            row: Array(columns.length).fill('1') as string[],
          }),
      ),
    [columns, connection, editContext, onExecuteDataEdit],
  )

  const insertRow = useCallback(
    async (row: string[]) => {
      const request = buildDataGridRowInsertRequest({
        columns,
        connection,
        editContext,
        row,
      })

      if (!request || !onExecuteDataEdit) {
        setStatusMessage('Insert unavailable; DataPad++ needs a table target and at least one value.')
        return false
      }

      try {
        const response = await executeDataEditWithConfirmation(
          onExecuteDataEdit,
          request,
          {
            actionLabel: 'Insert this row.',
            confirmationTitle: 'Insert this row?',
          },
        )
        const failureMessage = dataEditStatusMessage(
          response,
          'Datastore did not confirm the insert.',
        )

        if (!response?.executed) {
          setStatusMessage(failureMessage)
          return false
        }

        setRows((current) => [...current, row])
        setStatusMessage(response.messages.at(-1) ?? 'Inserted row.')
        return true
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Unable to insert row.')
        return false
      }
    },
    [columns, connection, editContext, onExecuteDataEdit, setRows, setStatusMessage],
  )

  const canDeleteRow = useCallback(
    (sourceIndex: number) =>
      Boolean(
        onExecuteDataEdit &&
          buildDataGridRowDeleteRequest({
            columns,
            connection,
            editContext,
            row: rows[sourceIndex] ?? [],
          }),
      ),
    [columns, connection, editContext, onExecuteDataEdit, rows],
  )

  const deleteRow = useCallback(
    async (sourceIndex: number) => {
      const request = buildDataGridRowDeleteRequest({
        columns,
        connection,
        editContext,
        row: rows[sourceIndex] ?? [],
      })

      if (!request || !onExecuteDataEdit) {
        setStatusMessage('Delete unavailable; DataPad++ could not identify a complete primary key.')
        return false
      }

      try {
        const response = await executeDataEditWithConfirmation(
          onExecuteDataEdit,
          request,
          {
            actionLabel: 'Delete this row.',
            confirmationTitle: 'Delete this row?',
          },
        )
        const failureMessage = dataEditStatusMessage(
          response,
          'Datastore did not confirm the delete.',
        )

        if (!response?.executed) {
          setStatusMessage(failureMessage)
          return false
        }

        setRows((current) => current.filter((_row, index) => index !== sourceIndex))
        setStatusMessage(response.messages.at(-1) ?? 'Deleted row.')
        return true
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Unable to delete row.')
        return false
      }
    },
    [columns, connection, editContext, onExecuteDataEdit, rows, setRows, setStatusMessage],
  )

  return {
    beginEdit,
    canEditCell,
    canInsertRow,
    canDeleteRow,
    cancelEdit,
    commitEdit,
    deleteRow,
    editingCell,
    insertRow,
    updateEditingValue,
  }
}
