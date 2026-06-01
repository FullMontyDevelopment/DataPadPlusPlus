import {
  searchHitId,
  type SearchHit,
} from './search-hit-edit-requests'

export interface SearchHitTarget {
  hitId?: string
  hitIndex: number
}

export function hitByTarget(
  hits: SearchHit[],
  target: SearchHitTarget | undefined,
) {
  if (!target) {
    return undefined
  }

  const hit = hits[target.hitIndex]
  if (!hit || (target.hitId && searchHitId(hit) !== target.hitId)) {
    return undefined
  }

  return hit
}

export function hitIdAt(hits: SearchHit[], hitIndex: number) {
  const hit = hits[hitIndex]
  return hit ? searchHitId(hit) : undefined
}
