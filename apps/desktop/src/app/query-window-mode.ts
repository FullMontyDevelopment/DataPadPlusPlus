import type {
  ConnectionProfile,
  QueryBuilderState,
  QueryViewMode,
} from '@datapadplusplus/shared-types'

export function normalizeQueryWindowMode(
  queryViewMode: QueryViewMode | 'both' | undefined,
  builderKind: QueryBuilderState['kind'] | undefined,
  connection: ConnectionProfile | undefined,
): QueryViewMode {
  if (queryViewMode === 'script' && connection?.engine === 'mongodb') {
    return 'script'
  }

  if (queryViewMode === 'raw') {
    return 'raw'
  }

  if (queryViewMode === 'builder' || queryViewMode === 'both') {
    return builderKind ? 'builder' : 'raw'
  }

  return defaultQueryWindowModeForBuilderKind(builderKind, connection)
}

function defaultQueryWindowModeForBuilderKind(
  builderKind: QueryBuilderState['kind'] | undefined,
  connection: ConnectionProfile | undefined,
): QueryViewMode {
  if (!builderKind) {
    return 'raw'
  }

  return connection?.family === 'sql' ? 'raw' : 'builder'
}
