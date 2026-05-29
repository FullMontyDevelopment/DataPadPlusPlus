import type { ConnectionProfile } from '@datapadplusplus/shared-types'

const SEARCH_ENGINES = new Set<ConnectionProfile['engine']>(['elasticsearch', 'opensearch'])

export function isSearchConnectionEngine(engine: ConnectionProfile['engine']) {
  return SEARCH_ENGINES.has(engine)
}
