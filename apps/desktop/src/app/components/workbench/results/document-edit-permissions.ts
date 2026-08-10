import { documentResultBehaviorForConnection } from './datastore-result-behaviors'
import { isProtectedDocumentPath } from './document-edit-validation'
import { isEditableDocumentValueType, type DocumentGridRow } from './document-grid-model'

type DocumentResultBehavior = ReturnType<typeof documentResultBehaviorForConnection>

export function editablePermissions(
  row: DocumentGridRow,
  behavior: DocumentResultBehavior,
  protectedPaths: string[][] = [['_id']],
) {
  const isProtectedField = isProtectedDocumentPath(row.path, protectedPaths)
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
  const canDeleteField = behavior.canEditDocuments && row.path.length > 0 && !isProtectedField && !isArrayIndex
  const addDestinationPath = row.type === 'object' ? row.path : row.parentPath
  const addFieldDestinationAvailable =
    (row.path.length === 0 || !isArrayIndex) && row.type !== 'array'
  const canAddField =
    behavior.canEditDocuments && addFieldDestinationAvailable
  const canEditRaw = behavior.canEditDocuments && !isProtectedField

  return {
    addDestinationPath,
    addFieldDestinationAvailable,
    canAddField,
    canChangeType,
    canDeleteField,
    canEditField,
    canEditLeaf,
    canEditRaw,
  }
}
