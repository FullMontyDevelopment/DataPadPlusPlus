import type { MongoFindFilterGroup } from '@datapadplusplus/shared-types'

export const DEFAULT_FILTER_GROUP_ID = 'filter-group-default'

export function defaultFilterGroup(): MongoFindFilterGroup {
  return {
    id: DEFAULT_FILTER_GROUP_ID,
    enabled: true,
    label: 'Group 1',
    logic: 'and',
  }
}

export function normalizeFilterGroups(
  groups: MongoFindFilterGroup[] | undefined,
): MongoFindFilterGroup[] {
  return groups && groups.length > 0 ? groups : [defaultFilterGroup()]
}

export function mongoBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
