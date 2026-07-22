import type {
  LibraryCreateFolderRequest,
  LibraryDeleteNodeRequest,
  LibraryDuplicateNodeRequest,
  LibraryMoveNodeRequest,
  LibraryRenameNodeRequest,
  LibrarySetEnvironmentRequest,
  SaveQueryTabToLibraryRequest,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  validateOptionalId,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './datastores/common/request-validation-core'

const MAX_LIBRARY_TAGS = 32
const MAX_LIBRARY_TAG_LENGTH = 80

const LIBRARY_ITEM_KINDS = new Set<NonNullable<SaveQueryTabToLibraryRequest['kind']>>([
  'query',
  'script',
  'test-suite',
  'template',
  'snippet',
  'snapshot',
  'investigation-pack',
  'bookmark',
  'note',
])

export function validateCreateLibraryFolderRequest(
  request: LibraryCreateFolderRequest,
): LibraryCreateFolderRequest {
  validateRequiredText(request.name, 'Library folder name', MAX_OBJECT_NAME_LENGTH)
  return {
    ...request,
    name: request.name.trim(),
    parentId: normalizeOptionalId(request.parentId, 'Library parent id'),
    environmentId: normalizeOptionalId(request.environmentId, 'Environment id'),
  }
}

export function validateRenameLibraryNodeRequest(
  request: LibraryRenameNodeRequest,
): LibraryRenameNodeRequest {
  validateRequiredId(request.nodeId, 'Library node id')
  validateRequiredText(request.name, 'Library item name', MAX_OBJECT_NAME_LENGTH)
  return {
    ...request,
    name: request.name.trim(),
  }
}

export function validateMoveLibraryNodeRequest(
  request: LibraryMoveNodeRequest,
): LibraryMoveNodeRequest {
  validateRequiredId(request.nodeId, 'Library node id')
  return {
    ...request,
    parentId: normalizeOptionalId(request.parentId, 'Library parent id'),
  }
}

export function validateSetLibraryNodeEnvironmentRequest(
  request: LibrarySetEnvironmentRequest,
): LibrarySetEnvironmentRequest {
  validateRequiredId(request.nodeId, 'Library node id')
  return {
    ...request,
    environmentId: normalizeOptionalId(request.environmentId, 'Environment id'),
  }
}

export function validateDeleteLibraryNodeRequest(
  request: LibraryDeleteNodeRequest,
): LibraryDeleteNodeRequest {
  validateRequiredId(request.nodeId, 'Library node id')
  return request
}

export function validateDuplicateLibraryNodeRequest(
  request: LibraryDuplicateNodeRequest,
): LibraryDuplicateNodeRequest {
  validateRequiredId(request.nodeId, 'Library node id')
  return request
}

export function validateSaveQueryTabToLibraryRequest(
  request: SaveQueryTabToLibraryRequest,
): SaveQueryTabToLibraryRequest {
  validateRequiredId(request.tabId, 'Tab id')
  validateRequiredText(request.name, 'Library item name', MAX_OBJECT_NAME_LENGTH)
  const kind = normalizeLibraryItemKind(request.kind)
  return {
    ...request,
    itemId: normalizeOptionalId(request.itemId, 'Library item id'),
    folderId: normalizeOptionalId(request.folderId, 'Library folder id'),
    name: request.name.trim(),
    kind,
    environmentId: normalizeOptionalId(request.environmentId, 'Environment id'),
    tags: normalizeTags(request.tags ?? []),
  }
}

function normalizeLibraryItemKind(kind: SaveQueryTabToLibraryRequest['kind']) {
  if (kind !== undefined && kind !== null && typeof kind !== 'string') {
    throw new Error('Library item kind must be text.')
  }

  const normalized = kind?.trim()
  if (!normalized) {
    return undefined
  }
  if (!LIBRARY_ITEM_KINDS.has(normalized as NonNullable<SaveQueryTabToLibraryRequest['kind']>)) {
    throw new Error(`Unsupported Library item kind: ${normalized}.`)
  }
  return normalized as NonNullable<SaveQueryTabToLibraryRequest['kind']>
}

function normalizeTags(tags: string[]) {
  if (tags.length > MAX_LIBRARY_TAGS) {
    throw new Error(`Library items may include at most ${MAX_LIBRARY_TAGS} tags.`)
  }
  return tags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new Error('Library tag must be text.')
    }

    const normalized = tag.trim()
    validateOptionalText(normalized, 'Library tag', MAX_LIBRARY_TAG_LENGTH)
    return normalized
  }).filter(Boolean)
}

function normalizeOptionalId(value: string | null | undefined, label: string) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  validateOptionalId(trimmed, label)
  return trimmed
}
