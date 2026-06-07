import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { PlayIcon } from './icons'
import { ObjectViewHeader } from './ObjectViewHeader'
import { asRecord } from './RedisObjectViewFormatters'
import { WarningList } from './RedisObjectViewPrimitives'
import {
  getRedisObjectViewDescriptor,
  type RedisObjectViewDescriptor,
} from './RedisObjectViewDescriptors'
import {
  RedisClusterView,
  RedisDiagnosticsView,
  RedisFunctionsView,
  RedisLuaScriptsView,
  RedisMetadataView,
  RedisPubSubView,
  RedisSecurityView,
  RedisSentinelView,
} from './RedisObjectViewAdminPages'
import {
  RedisDatabaseView,
  RedisKeyView,
  RedisTypeFolderView,
} from './RedisObjectViewKeyPages'
import { RedisModuleView } from './RedisObjectViewModulePages'
import { RedisStreamView } from './RedisObjectViewStreamPages'
import {
  isRedisClusterKind,
  isRedisDiagnosticsKind,
  isRedisFunctionKind,
  isRedisKeyPayload,
  isRedisModuleKind,
  isRedisScriptKind,
  isRedisSecurityKind,
  isRedisSentinelKind,
  isRedisStreamKind,
  isRedisTypeFolderKind,
  objectViewWarnings,
  redisQueryTargetFromObjectView,
} from './RedisObjectViewWorkspace.helpers'
import type { JsonRecord } from './RedisObjectViewTypes'

export function RedisObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
}: {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const kind = state?.kind ?? 'object'
  const descriptor = getRedisObjectViewDescriptor(
    kind,
    connection.engine === 'valkey' ? 'valkey' : 'redis',
  )
  const queryTarget = useMemo(
    () => redisQueryTargetFromObjectView(tab, payload),
    [payload, tab],
  )
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])

  return (
    <section className="object-view-workspace" aria-label={`${descriptor.title} object view`}>
      <ObjectViewHeader
        connection={connection}
        environment={environment}
        kind={kind}
        path={state?.path}
        title={descriptor.title}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {queryTarget ? (
          <button
            type="button"
            className="drawer-button"
            onClick={() => onOpenQuery(queryTarget)}
          >
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel ?? 'Open Key Browser'}
          </button>
        ) : null}
      </ObjectViewHeader>

      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body">
        {renderRedisObjectView(kind, descriptor, payload, queryTarget, onOpenQuery)}
      </div>
    </section>
  )
}

function renderRedisObjectView(
  kind: string,
  descriptor: RedisObjectViewDescriptor,
  payload: JsonRecord,
  queryTarget: ScopedQueryTarget | undefined,
  onOpenQuery: (target: ScopedQueryTarget) => void,
) {
  if (isRedisStreamKind(kind)) {
    return <RedisStreamView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisModuleKind(kind)) {
    return (
      <RedisModuleView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (isRedisKeyPayload(payload)) {
    return <RedisKeyView descriptor={descriptor} payload={payload} />
  }

  if (kind === 'databases' || kind === 'database') {
    return (
      <RedisDatabaseView
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (isRedisTypeFolderKind(kind)) {
    return (
      <RedisTypeFolderView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (kind === 'diagnostics' || isRedisDiagnosticsKind(kind)) {
    return <RedisDiagnosticsView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (kind === 'pubsub' || kind.startsWith('pubsub-')) {
    return <RedisPubSubView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisClusterKind(kind)) {
    return <RedisClusterView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisSentinelKind(kind)) {
    return <RedisSentinelView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (isRedisScriptKind(kind)) {
    return <RedisLuaScriptsView descriptor={descriptor} payload={payload} />
  }

  if (isRedisFunctionKind(kind)) {
    return <RedisFunctionsView descriptor={descriptor} payload={payload} />
  }

  if (isRedisSecurityKind(kind)) {
    return <RedisSecurityView kind={kind} descriptor={descriptor} payload={payload} />
  }

  return <RedisMetadataView descriptor={descriptor} payload={payload} />
}
