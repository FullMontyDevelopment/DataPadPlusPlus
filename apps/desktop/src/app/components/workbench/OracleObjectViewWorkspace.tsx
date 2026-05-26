import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  DatabaseIcon,
  ObjectColumnIcon,
  ObjectConstraintIcon,
  ObjectFunctionIcon,
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectPackageIcon,
  ObjectRoleIcon,
  ObjectSecurityIcon,
  ObjectStageIcon,
  ObjectTableIcon,
  ObjectViewIcon,
  PlayIcon,
} from './icons'
import { ObjectViewHeader } from './ObjectViewHeader'
import {
  arrayOfRecords,
  asRecord,
  cardRowsFromPayload,
  normalizeOracleObjectKind,
  objectUnit,
  objectViewWarnings,
  oracleObjectRows,
  oraclePerformanceRows,
  oracleQueryTargetFromObjectView,
  oracleSecurityRows,
  oracleSourceOutline,
  oracleStorageRows,
  sourceLinesFromPayload,
  stringValue,
  type JsonRecord,
} from './OracleObjectViewWorkspace.helpers'
import {
  getOracleObjectViewDescriptor,
  type OracleObjectViewDescriptor,
} from './OracleObjectViewDescriptors'
import {
  KeyValueGrid,
  ObjectViewTable,
  SectionHeading,
  WarningList,
} from './ObjectViewPrimitives'
import { redactSensitiveText } from '../../state/security-redaction'

export function OracleObjectViewWorkspace({
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
  const kind = normalizeOracleObjectKind(state?.kind ?? 'object')
  const descriptor = getOracleObjectViewDescriptor(kind)
  const queryTarget = useMemo(() => oracleQueryTargetFromObjectView(tab), [tab])
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
        {queryTarget && descriptor.primaryQueryLabel ? (
          <button
            type="button"
            className="drawer-button"
            onClick={() => onOpenQuery(queryTarget)}
          >
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel}
          </button>
        ) : null}
      </ObjectViewHeader>

      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body">
        {renderOracleObjectView(kind, descriptor, payload, queryTarget, onOpenQuery)}
      </div>
    </section>
  )
}

function renderOracleObjectView(
  kind: string,
  descriptor: OracleObjectViewDescriptor,
  payload: JsonRecord,
  queryTarget: ScopedQueryTarget | undefined,
  onOpenQuery: (target: ScopedQueryTarget) => void,
) {
  if (['database', 'containers', 'schemas', 'schema'].includes(kind)) {
    return <OracleOverviewView descriptor={descriptor} payload={payload} />
  }

  if (['tables', 'table', 'views', 'view', 'materialized-views', 'sequences', 'synonyms', 'indexes', 'constraints', 'triggers', 'partitions', 'statistics', 'dependencies', 'permissions', 'ddl'].includes(kind)) {
    return (
      <OracleObjectMetadataView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (['packages', 'package', 'procedures', 'procedure', 'functions', 'function', 'types', 'type'].includes(kind)) {
    return <OracleSourceView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (['security', 'users', 'roles', 'profiles', 'privileges'].includes(kind)) {
    return <OracleSecurityView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (['storage', 'tablespaces', 'data-files', 'segments', 'quotas'].includes(kind)) {
    return <OracleStorageView kind={kind} descriptor={descriptor} payload={payload} />
  }

  if (['performance', 'diagnostics', 'sessions', 'waits', 'locks', 'sql-monitor', 'execution-plan', 'invalid-objects'].includes(kind)) {
    return <OraclePerformanceView kind={kind} descriptor={descriptor} payload={payload} />
  }

  return <OracleGenericView descriptor={descriptor} payload={payload} />
}

function OracleOverviewView({
  descriptor,
  payload,
}: {
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const facts = [
    ['Service / PDB', stringValue(payload.service)],
    ['Schema', stringValue(payload.schema)],
    ['Container', stringValue(payload.container)],
    ['Open mode', stringValue(payload.openMode)],
  ].filter(([, value]) => value)
  const counts = arrayOfRecords(payload.objectCounts)
  const invalidObjects = arrayOfRecords(payload.invalidObjects)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={DatabaseIcon} title={descriptor.title} unit={stringValue(payload.schema ?? payload.service)} />
      <KeyValueGrid rows={facts} emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`} />
      <ObjectViewTable
        columns={['Object type', 'Count', 'Status']}
        rows={counts.map((row) => [
          stringValue(row.type ?? row.objectType),
          stringValue(row.count),
          stringValue(row.status ?? 'Visible'),
        ])}
        emptyText="No object counts were returned for this scope."
      />
      <ObjectViewTable
        columns={['Owner', 'Object', 'Type', 'Status']}
        rows={invalidObjects.map((row) => [
          stringValue(row.owner),
          stringValue(row.name ?? row.objectName),
          stringValue(row.type ?? row.objectType),
          stringValue(row.status),
        ])}
        emptyText="No invalid objects were reported."
      />
    </div>
  )
}

function OracleObjectMetadataView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  kind: string
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const objectRows = oracleObjectRows(kind, payload)
  const columns = arrayOfRecords(payload.columns)
  const indexes = arrayOfRecords(payload.indexes)
  const constraints = arrayOfRecords(payload.constraints)
  const triggers = arrayOfRecords(payload.triggers)
  const statistics = cardRowsFromPayload(payload, ['rowCount', 'blocks', 'avgRowLength', 'lastAnalyzed', 'sampleSize'])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={oracleIconForKind(kind)} title={descriptor.title} unit={objectUnit(kind, payload, objectRows.rows.length)} />
      {queryTarget && descriptor.primaryQueryLabel ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel}
        </button>
      ) : null}
      <MetricCards rows={statistics} />
      <ObjectViewTable
        columns={objectRows.columns}
        rows={objectRows.rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      <ObjectViewTable
        columns={['Column', 'Type', 'Nullable', 'Default']}
        rows={columns.map((column) => [
          stringValue(column.name ?? column.columnName),
          stringValue(column.type ?? column.dataType),
          stringValue(column.nullable),
          stringValue(column.default ?? column.dataDefault),
        ])}
        emptyText=""
      />
      <ObjectViewTable
        columns={['Index', 'Uniqueness', 'Status', 'Visibility']}
        rows={indexes.map((index) => [
          stringValue(index.name ?? index.indexName),
          stringValue(index.uniqueness),
          stringValue(index.status),
          stringValue(index.visibility),
        ])}
        emptyText=""
      />
      <ObjectViewTable
        columns={['Constraint', 'Type', 'Status', 'Columns']}
        rows={constraints.map((constraint) => [
          stringValue(constraint.name ?? constraint.constraintName),
          stringValue(constraint.type ?? constraint.constraintType),
          stringValue(constraint.status),
          stringValue(constraint.columns),
        ])}
        emptyText=""
      />
      <ObjectViewTable
        columns={['Trigger', 'Timing', 'Event', 'Status']}
        rows={triggers.map((trigger) => [
          stringValue(trigger.name ?? trigger.triggerName),
          stringValue(trigger.timing),
          stringValue(trigger.event),
          stringValue(trigger.status),
        ])}
        emptyText=""
      />
    </div>
  )
}

function OracleSourceView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const objects = oracleObjectRows(kind, payload)
  const sourceLines = sourceLinesFromPayload(payload)
  const errors = arrayOfRecords(payload.errors)
  const dependencies = arrayOfRecords(payload.dependencies)
  const [showSource, setShowSource] = useState(false)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={oracleIconForKind(kind)} title={descriptor.title} unit={stringValue(payload.objectName ?? payload.schema)} />
      <MetricCards rows={[
        ['Source lines', String(sourceLines.length)],
        ['Compile errors', String(errors.length)],
        ['Dependencies', String(dependencies.length)],
      ]} />
      <ObjectViewTable
        columns={objects.columns}
        rows={objects.rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {sourceLines.length ? (
        <div className="object-view-management">
          <strong>Source Outline</strong>
          <ObjectViewTable
            columns={['Line', 'Declaration']}
            rows={oracleSourceOutline(sourceLines)}
            emptyText="No declarations were detected in the loaded source."
          />
          <div className="object-view-disclosure">
            <button
              type="button"
              className="drawer-button"
              onClick={() => setShowSource((current) => !current)}
            >
              {showSource ? 'Hide source' : 'Show source'}
            </button>
            {showSource ? (
              <div className="object-view-table-wrap">
                <table className="object-view-table">
                  <thead>
                    <tr><th>Line</th><th>Source</th></tr>
                  </thead>
                  <tbody>
                    {sourceLines.map((line) => (
                      <tr key={`${line.line}:${line.text}`}>
                        <td>{line.line}</td>
                        <td><code>{line.text}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <ObjectViewTable
        columns={['Name', 'Type', 'Line', 'Message']}
        rows={errors.map((error) => [
          stringValue(error.name),
          stringValue(error.type),
          stringValue(error.line),
          redactSensitiveText(stringValue(error.text ?? error.message)),
        ])}
        emptyText=""
      />
      <ObjectViewTable
        columns={['Owner', 'Object', 'Type', 'Referenced']}
        rows={dependencies.map((dependency) => [
          stringValue(dependency.owner),
          stringValue(dependency.name ?? dependency.objectName),
          stringValue(dependency.type ?? dependency.objectType),
          stringValue(dependency.referencedName ?? dependency.referenced),
        ])}
        emptyText=""
      />
    </div>
  )
}

function OracleSecurityView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const rows = oracleSecurityRows(kind, payload)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={`${rows.rows.length} row(s)`} />
      <ObjectViewTable
        columns={rows.columns}
        rows={rows.rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function OracleStorageView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const rows = oracleStorageRows(kind, payload)
  const metrics = cardRowsFromPayload(payload, ['allocatedBytes', 'usedBytes', 'freeBytes', 'segmentCount', 'quotaBytes'])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectStageIcon} title={descriptor.title} unit={stringValue(payload.tablespace ?? payload.service)} />
      <MetricCards rows={metrics} />
      <ObjectViewTable
        columns={rows.columns}
        rows={rows.rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function OraclePerformanceView({
  kind,
  descriptor,
  payload,
}: {
  kind: string
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const rows = oraclePerformanceRows(kind, payload)
  const metrics = cardRowsFromPayload(payload, ['activeSessions', 'blockedSessions', 'invalidObjects', 'elapsedMs', 'bufferGets'])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectJobIcon} title={descriptor.title} unit={stringValue(payload.service)} />
      <MetricCards rows={metrics} />
      <ObjectViewTable
        columns={rows.columns}
        rows={rows.rows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function OracleGenericView({
  descriptor,
  payload,
}: {
  descriptor: OracleObjectViewDescriptor
  payload: JsonRecord
}) {
  const facts = [
    ['Service', stringValue(payload.service)],
    ['Schema', stringValue(payload.schema)],
    ['Object', stringValue(payload.objectName ?? payload.nodeId)],
    ['Status', stringValue(payload.status)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={DatabaseIcon} title={descriptor.title} unit="Oracle" />
      <KeyValueGrid rows={facts} emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`} />
    </div>
  )
}

function MetricCards({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="object-view-card-grid">
      {rows.map(([label, value]) => (
        <div key={`${label}:${value}`} className="object-view-card">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function oracleIconForKind(kind: string) {
  if (kind.includes('view')) {
    return ObjectViewIcon
  }
  if (kind.includes('index')) {
    return ObjectIndexIcon
  }
  if (kind.includes('constraint')) {
    return ObjectConstraintIcon
  }
  if (kind.includes('package')) {
    return ObjectPackageIcon
  }
  if (kind.includes('procedure')) {
    return ObjectFunctionIcon
  }
  if (kind.includes('function')) {
    return ObjectFunctionIcon
  }
  if (kind.includes('permission')) {
    return ObjectRoleIcon
  }
  if (kind.includes('column')) {
    return ObjectColumnIcon
  }
  return ObjectTableIcon
}
