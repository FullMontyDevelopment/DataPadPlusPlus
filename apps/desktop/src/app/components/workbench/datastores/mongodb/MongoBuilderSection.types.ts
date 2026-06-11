import type { MongoFindBuilderState, MongoFindFilterGroup } from '@datapadplusplus/shared-types'

export type BuilderUpdater = (patch: Partial<MongoFindBuilderState>) => void

export interface MongoFindSectionProps {
  dragActive?: boolean
  draft: MongoFindBuilderState
  filterGroups: MongoFindFilterGroup[]
  updateDraft: BuilderUpdater
}

export function rowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
