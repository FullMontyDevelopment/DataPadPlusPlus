import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export interface DocumentResultBehavior {
  canEditDocuments: boolean
  canRenameFields: boolean
  canChangeTypes: boolean
  contextActions: {
    copyPath: boolean
    copyValue: boolean
    copyDocument: boolean
    renameField: boolean
    editValue: boolean
    changeType: boolean
    deleteField: boolean
    deleteDocument: boolean
  }
  editModeLabel: string
}

const READ_ONLY_BEHAVIOR: DocumentResultBehavior = {
  canEditDocuments: false,
  canRenameFields: false,
  canChangeTypes: false,
  contextActions: {
    copyPath: true,
    copyValue: true,
    copyDocument: true,
    renameField: false,
    editValue: false,
    changeType: false,
    deleteField: false,
    deleteDocument: false,
  },
  editModeLabel: 'Read-only result',
}

const MONGO_DOCUMENT_BEHAVIOR: DocumentResultBehavior = {
  canEditDocuments: true,
  canRenameFields: true,
  canChangeTypes: true,
  contextActions: {
    copyPath: true,
    copyValue: true,
    copyDocument: true,
    renameField: true,
    editValue: true,
    changeType: true,
    deleteField: true,
    deleteDocument: true,
  },
  editModeLabel: 'MongoDB editable document result',
}

export function documentResultBehaviorForConnection(
  connection?: ConnectionProfile,
): DocumentResultBehavior {
  if (!connection || connection.readOnly) {
    return READ_ONLY_BEHAVIOR
  }

  if (connection.engine === 'mongodb' || connection.engine === 'cosmosdb') {
    return MONGO_DOCUMENT_BEHAVIOR
  }

  return READ_ONLY_BEHAVIOR
}
