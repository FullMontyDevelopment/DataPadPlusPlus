import type { ConnectionProfile, ScopedQueryTarget } from '@datapadplusplus/shared-types'

export function liteDbTargetValues(connection: ConnectionProfile, target?: ScopedQueryTarget): string[] {
  const path = (target?.path ?? []).filter(part => part !== connection.name)
  const fileName = connection.database?.split(/[\\/]/).pop()
  const database = target?.kind === 'database' ? target.label : path[0] ?? fileName ?? 'Connected file'
  const scopedCollection = /^litedb:(?:collection|documents|collection-indexes):(.+)$/.exec(target?.scope ?? '')?.[1]
  const container = path.indexOf('Collections')
  const collection = scopedCollection ?? (target?.kind === 'collection' ? target.label : container >= 0 ? path[container + 1] : '')
  return [database, collection ?? '']
}
