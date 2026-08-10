import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export interface DocumentResultBehavior {
  canEditDocuments: boolean
  canRenameFields: boolean
  canChangeTypes: boolean
  contextActions: {
    copyPath: boolean
    copyValue: boolean
    copyDocument: boolean
    addField: boolean
    renameField: boolean
    editValue: boolean
    editRawJson: boolean
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
    addField: false,
    renameField: false,
    editValue: false,
    editRawJson: false,
    changeType: false,
    deleteField: false,
    deleteDocument: false,
  },
  editModeLabel: 'Read-only result',
}

const EDITABLE_DOCUMENT_BEHAVIOR: DocumentResultBehavior = {
  canEditDocuments: true,
  canRenameFields: true,
  canChangeTypes: true,
  contextActions: {
    copyPath: true,
    copyValue: true,
    copyDocument: true,
    addField: true,
    renameField: true,
    editValue: true,
    editRawJson: true,
    changeType: true,
    deleteField: true,
    deleteDocument: true,
  },
  editModeLabel: 'Guarded editable document result',
}

export function documentResultBehaviorForConnection(
  connection?: ConnectionProfile,
): DocumentResultBehavior {
  if (!connection) {
    return READ_ONLY_BEHAVIOR
  }

  if (['mongodb', 'cosmosdb', 'litedb', 'arango'].includes(connection.engine)) {
    return connection.readOnly
      ? {
          ...EDITABLE_DOCUMENT_BEHAVIOR,
          canEditDocuments: false,
          canRenameFields: false,
          canChangeTypes: false,
          editModeLabel: 'Read-only connection',
        }
      : EDITABLE_DOCUMENT_BEHAVIOR
  }

  return READ_ONLY_BEHAVIOR
}
