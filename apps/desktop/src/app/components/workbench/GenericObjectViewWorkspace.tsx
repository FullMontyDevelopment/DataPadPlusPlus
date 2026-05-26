import { useCallback, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { ObjectViewHeader } from './ObjectViewHeader'
import { WarningList } from './ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

export function GenericObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
}: {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
}) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])

  return (
    <section className="object-view-workspace" aria-label={`${state?.label ?? tab.title} object view`}>
      <ObjectViewHeader
        connection={connection}
        environment={environment}
        kind={state?.kind ?? 'object'}
        path={state?.path}
        title={state?.label ?? tab.title}
        refreshing={refreshing}
        onRefresh={refresh}
      />
      <WarningList warnings={objectViewWarnings(tab, payload)} />
    </section>
  )
}

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
  ].filter(Boolean)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}
