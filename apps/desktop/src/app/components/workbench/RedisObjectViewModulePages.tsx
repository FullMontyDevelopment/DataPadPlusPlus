import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import {
  JsonIcon,
  ObjectMetricIcon,
  ObjectSearchIcon,
  ObjectSeriesIcon,
  ObjectGraphIcon,
  ObjectKeyIcon,
  PlayIcon,
} from './icons'
import {
  redisModuleCards,
  redisModuleCommandRows,
  redisModuleCommands,
  redisModuleDisabledRows,
  redisModuleFacts,
  redisModuleIndexRows,
  redisModuleIndexes,
  redisModuleKeyRows,
  redisModuleKeys,
} from './RedisObjectViewModuleNormalizers'
import {
  EmptyPanel,
  KeyValueGrid,
  MetricCards,
  ObjectViewTable,
  SectionHeading,
} from './RedisObjectViewPrimitives'
import type { RedisObjectViewDescriptor } from './RedisObjectViewDescriptors'
import type { JsonRecord } from './RedisObjectViewTypes'

export function RedisModuleView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  kind: string
  descriptor: RedisObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const keys = redisModuleKeys(payload)
  const indexes = redisModuleIndexes(payload)
  const commands = redisModuleCommands(payload)
  const disabledRows = redisModuleDisabledRows(payload)
  const hasContent = keys.length || indexes.length || commands.length || disabledRows.length

  return (
    <div className="object-view-section">
      <SectionHeading Icon={moduleIcon(kind)} title={descriptor.title} unit={moduleUnit(kind, keys.length, indexes.length)} />
      <MetricCards rows={redisModuleCards(kind, payload)} />
      <KeyValueGrid rows={redisModuleFacts(kind, payload)} emptyText="No module facts were returned." />
      {queryTarget && kind !== 'search-index' ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Browse Module Keys'}
        </button>
      ) : null}
      <ObjectViewTable
        columns={['Key', 'Type', 'TTL', 'Memory', 'Module Detail']}
        rows={redisModuleKeyRows(keys)}
        emptyText={indexes.length ? '' : `${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {indexes.length ? (
        <ObjectViewTable
          columns={['Index', 'Documents', 'Fields', 'Prefixes', 'Detail']}
          rows={redisModuleIndexRows(indexes)}
          emptyText=""
        />
      ) : null}
      <ObjectViewTable
        columns={['Command', 'Purpose', 'Evidence']}
        rows={redisModuleCommandRows(commands)}
        emptyText=""
      />
      <ObjectViewTable
        columns={['Action', 'Disabled Reason']}
        rows={disabledRows}
        emptyText=""
      />
      {!hasContent ? <EmptyPanel title={descriptor.emptyTitle} description={descriptor.emptyDescription} /> : null}
    </div>
  )
}

function moduleUnit(kind: string, keyCount: number, indexCount: number) {
  if (kind === 'search-index') {
    return `${indexCount} index(es)`
  }

  return `${keyCount} key(s)`
}

function moduleIcon(kind: string) {
  if (kind === 'json') {
    return JsonIcon
  }

  if (kind === 'timeseries') {
    return ObjectSeriesIcon
  }

  if (kind === 'search-index') {
    return ObjectSearchIcon
  }

  if (kind === 'vectorset') {
    return ObjectGraphIcon
  }

  if (kind === 'bloom') {
    return ObjectMetricIcon
  }

  return ObjectKeyIcon
}
