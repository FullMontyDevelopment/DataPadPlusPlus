import type { DataEditExecutionRequest } from '@datapadplusplus/shared-types'
import {
  dataEditErrorMessage,
  executeDataEditWithConfirmation,
  type ExecuteDataEdit,
  type ExecuteDataEditOptions,
} from './data-edit-confirmation'
import type { KeyValueEntryPatches } from './keyvalue-results-helpers'

export interface ContextMenuState {
  keyName: string
  x: number
  y: number
}

export interface DeleteTarget {
  keyName: string
  rawValue?: string
  target: 'key' | 'member'
}

export interface PendingTtlState {
  keyName: string
  seconds: string
}

export interface PendingAddState {
  keyName: string
  value: string
}

export interface PendingRenameState {
  keyName: string
  nextKeyName: string
}

export interface EntryPatchState {
  patches: KeyValueEntryPatches
  version: string
}

export function createKeyValueDataEditRunner(
  executeDataEdit: ExecuteDataEdit | undefined,
  setStatusMessage: (message: string) => void,
) {
  return async (
    request: DataEditExecutionRequest,
    options: ExecuteDataEditOptions,
    fallback: string,
    direct = false,
  ) => {
    if (!executeDataEdit) {
      return undefined
    }

    try {
      return direct
        ? await executeDataEdit(request)
        : await executeDataEditWithConfirmation(executeDataEdit, request, options)
    } catch (error) {
      setStatusMessage(dataEditErrorMessage(error, fallback))
      return undefined
    }
  }
}
