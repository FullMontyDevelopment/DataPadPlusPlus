import type { DocumentNodeChildrenRequest } from '@datapadplusplus/shared-types'
import {
  assertJsonSize,
  MAX_OBJECT_NAME_LENGTH,
  validateEnvironmentContextId,
  validateOptionalText,
  validateQueryText,
  validateRequiredId,
  validateRequiredText,
} from '../request-validation-core'

export function validateDocumentNodeChildrenRequest(
  request: DocumentNodeChildrenRequest,
): DocumentNodeChildrenRequest {
  validateRequiredId(request.tabId, 'Tab id')
  validateRequiredId(request.connectionId, 'Connection id')
  validateEnvironmentContextId(request.environmentId)
  validateRequiredText(request.collection, 'Collection name', MAX_OBJECT_NAME_LENGTH)
  validateOptionalText(request.database, 'Database name', MAX_OBJECT_NAME_LENGTH)
  validateDocumentPath(request.path, request.mode)
  validateQueryText(request.queryText ?? '{}', 'Query text')
  assertJsonSize(request.documentId, 'Document id')
  return request
}

function validateDocumentPath(
  path: Array<string | number>,
  mode: DocumentNodeChildrenRequest['mode'],
) {
  if (!Array.isArray(path) || (path.length === 0 && mode !== 'full-value')) {
    throw new Error('Document field path must be non-empty unless full-value hydration targets the root.')
  }
  if (mode !== undefined && mode !== 'children' && mode !== 'full-value') {
    throw new Error('Document hydration mode must be children or full-value.')
  }
  if (path.length > 100) {
    throw new Error('Document field path can contain at most 100 segments.')
  }
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Number.isInteger(segment) || segment < 0) {
        throw new Error('Document field path array indexes must be non-negative integers.')
      }
    } else {
      validateRequiredText(segment, 'Document field path segment', 256)
    }
  }
}
