import type { QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import {
  createDefaultRedisKeyBrowserState,
  isRedisKeyBrowserState,
  parseRedisKeyBrowserQueryText,
} from './redis-key-browser'

export function isRedisConsoleTab(tab: QueryTabState | undefined) {
  return tab?.language === 'redis'
}

export function redisConsoleCommandFromQueryText(
  queryText: string | undefined,
  builderState?: QueryBuilderState,
) {
  const trimmed = queryText?.trim() ?? ''
  const browserState =
    parseRedisKeyBrowserQueryText(trimmed) ??
    (isRedisKeyBrowserState(builderState) ? builderState : undefined)

  if (browserState && (!trimmed || trimmed.startsWith('{'))) {
    return redisScanCommandFromBrowserState(browserState)
  }

  if (trimmed) {
    return trimmed
  }

  return redisScanCommandFromBrowserState(
    isRedisKeyBrowserState(builderState)
      ? builderState
      : createDefaultRedisKeyBrowserState('*', 100),
  )
}

function redisScanCommandFromBrowserState(state: QueryBuilderState) {
  if (!isRedisKeyBrowserState(state)) {
    return 'PING'
  }

  const pattern = state.pattern?.trim() || '*'
  const count = Math.max(1, Math.floor(state.scanCount ?? state.pageSize ?? 100))
  const typeFilter = state.typeFilter && state.typeFilter !== 'all'
    ? ` TYPE ${state.typeFilter}`
    : ''

  return `SCAN 0 MATCH ${pattern} COUNT ${count}${typeFilter}`
}
