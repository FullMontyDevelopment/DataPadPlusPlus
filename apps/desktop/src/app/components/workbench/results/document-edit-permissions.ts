import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import { isEditableDocumentValueType, type DocumentGridRow } from './document-grid-model'

type DocumentResultBehavior = ReturnType<typeof documentResultBehaviorForConnection>

export function editablePermissions(row: DocumentGridRow, behavior: DocumentResultBehavior) {
  const isProtectedField = row.fieldPath === '_id'
  const isArrayIndex = typeof row.path.at(-1) === 'number'
  const canEditField =
    behavior.canEditDocuments &&
    behavior.canRenameFields &&
    row.path.length > 0 &&
    !isProtectedField &&
    !isArrayIndex
  const canEditLeaf =
    behavior.canEditDocuments && row.path.length > 0 && !isProtectedField && !row.expandable
  const canChangeType = canEditLeaf && behavior.canChangeTypes && isEditableDocumentValueType(row.type)
  const canDeleteField =
    behavior.canEditDocuments && row.path.length > 0 && !isProtectedField

  return { canChangeType, canDeleteField, canEditField, canEditLeaf }
}
