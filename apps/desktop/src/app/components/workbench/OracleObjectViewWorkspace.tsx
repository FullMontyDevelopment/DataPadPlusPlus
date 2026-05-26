import { useCallback, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
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
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getOracleObjectViewDescriptor,
  type OracleObjectViewDescriptor,
} from './OracleObjectViewDescriptors'
import { ExplorerNodeIcon } from './SideBar.node-icons'
import { redactSensitiveText } from '../../state/security-redaction'

type JsonRecord = Record<string, unknown>

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
      <OracleObjectViewHeader
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
      </OracleObjectViewHeader>

      {oracleObjectViewSummary(state?.summary, descriptor) ? (
        <p className="object-view-summary">{oracleObjectViewSummary(state?.summary, descriptor)}</p>
      ) : null}
      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body">
        {renderOracleObjectView(kind, descriptor, payload, queryTarget, onOpenQuery)}
      </div>
    </section>
  )
}

function OracleObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ExplorerNodeIcon connection={connection} kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>{[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}</span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
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

function SectionHeading({
  Icon,
  title,
  unit,
}: {
  Icon: ComponentType<{ className?: string }>
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
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

function KeyValueGrid({ rows, emptyText }: { rows: string[][]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <dl className="object-view-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (rows.length === 0) {
    return emptyText ? <p className="object-view-empty">{emptyText}</p> : null
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}:${row.join('|')}`}>
              {columns.map((column, columnIndex) => (
                <td key={column}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div key={warning} className="object-view-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function oracleObjectRows(kind: string, payload: JsonRecord) {
  const rowSources: Record<string, [unknown, string[]]> = {
    tables: [payload.tables, ['Owner', 'Table', 'Status', 'Tablespace']],
    views: [payload.views, ['Owner', 'View', 'Text length', 'Status']],
    'materialized-views': [payload.materializedViews, ['Owner', 'Name', 'Refresh mode', 'Status']],
    sequences: [payload.sequences, ['Owner', 'Sequence', 'Increment', 'Cache']],
    synonyms: [payload.synonyms, ['Owner', 'Synonym', 'Target owner', 'Target object']],
    indexes: [payload.indexes, ['Owner', 'Index', 'Table', 'Status']],
    constraints: [payload.constraints, ['Owner', 'Constraint', 'Type', 'Status']],
    triggers: [payload.triggers, ['Owner', 'Trigger', 'Event', 'Status']],
    packages: [payload.packages, ['Owner', 'Package', 'Type', 'Status']],
    procedures: [payload.procedures, ['Owner', 'Procedure', 'Status', 'Last DDL']],
    functions: [payload.functions, ['Owner', 'Function', 'Status', 'Last DDL']],
    types: [payload.types, ['Owner', 'Type', 'Kind', 'Status']],
  }
  const [source, columns] = rowSources[kind] ?? [payload.objects, ['Owner', 'Object', 'Type', 'Status']]
  const records = arrayOfRecords(source)

  return {
    columns,
    rows: records.map((row) => [
      stringValue(row.owner ?? row.schema),
      stringValue(row.name ?? row.objectName ?? row.tableName ?? row.viewName ?? row.indexName ?? row.sequenceName),
      stringValue(row.status ?? row.type ?? row.objectType ?? row.refreshMode ?? row.increment),
      stringValue(row.tablespace ?? row.tablespaceName ?? row.target ?? row.detail ?? row.lastDdlTime),
    ]),
  }
}

function oracleSecurityRows(kind: string, payload: JsonRecord) {
  if (kind === 'roles') {
    return {
      columns: ['Role', 'Source', 'Default', 'Admin option'],
      rows: arrayOfRecords(payload.roles).map((role) => [
        stringValue(role.role),
        stringValue(role.source ?? role.owner),
        stringValue(role.defaultRole ?? role.default),
        stringValue(role.adminOption),
      ]),
    }
  }

  if (kind === 'profiles') {
    return {
      columns: ['Profile', 'Resource', 'Limit', 'Type'],
      rows: arrayOfRecords(payload.profiles).map((profile) => [
        stringValue(profile.profile),
        stringValue(profile.resourceName ?? profile.resource),
        stringValue(profile.limit),
        stringValue(profile.resourceType ?? profile.type),
      ]),
    }
  }

  if (kind === 'privileges' || kind === 'permissions') {
    return {
      columns: ['Grantee', 'Privilege', 'Object', 'Grantable'],
      rows: arrayOfRecords(payload.grants ?? payload.privileges).map((grant) => [
        stringValue(grant.grantee ?? grant.owner),
        stringValue(grant.privilege),
        stringValue(grant.objectName ?? grant.object ?? grant.tableName),
        stringValue(grant.grantable),
      ]),
    }
  }

  return {
    columns: ['User', 'Account status', 'Default tablespace', 'Profile'],
    rows: arrayOfRecords(payload.users).map((user) => [
      stringValue(user.username ?? user.user),
      stringValue(user.accountStatus ?? user.status),
      stringValue(user.defaultTablespace),
      stringValue(user.profile),
    ]),
  }
}

function oracleStorageRows(kind: string, payload: JsonRecord) {
  if (kind === 'segments') {
    return {
      columns: ['Owner', 'Segment', 'Type', 'Size'],
      rows: arrayOfRecords(payload.segments).map((segment) => [
        stringValue(segment.owner),
        stringValue(segment.name ?? segment.segmentName),
        stringValue(segment.type ?? segment.segmentType),
        bytesText(segment.bytes),
      ]),
    }
  }

  if (kind === 'data-files') {
    return {
      columns: ['Tablespace', 'File', 'Size', 'Status'],
      rows: arrayOfRecords(payload.dataFiles).map((file) => [
        stringValue(file.tablespaceName ?? file.tablespace),
        stringValue(file.fileName ?? file.name),
        bytesText(file.bytes),
        stringValue(file.status),
      ]),
    }
  }

  if (kind === 'quotas') {
    return {
      columns: ['Tablespace', 'Used', 'Limit', 'Blocks'],
      rows: arrayOfRecords(payload.quotas).map((quota) => [
        stringValue(quota.tablespaceName ?? quota.tablespace),
        bytesText(quota.bytes),
        bytesText(quota.maxBytes),
        stringValue(quota.blocks),
      ]),
    }
  }

  return {
    columns: ['Tablespace', 'Status', 'Contents', 'Extent management'],
    rows: arrayOfRecords(payload.tablespaces).map((tablespace) => [
      stringValue(tablespace.name ?? tablespace.tablespaceName),
      stringValue(tablespace.status),
      stringValue(tablespace.contents),
      stringValue(tablespace.extentManagement),
    ]),
  }
}

function oraclePerformanceRows(kind: string, payload: JsonRecord) {
  if (kind === 'execution-plan') {
    return {
      columns: ['Id', 'Operation', 'Object', 'Rows', 'Cost'],
      rows: arrayOfRecords(payload.planLines).map((line) => [
        stringValue(line.id),
        stringValue(line.operation),
        stringValue(line.objectName ?? line.object),
        stringValue(line.rows),
        stringValue(line.cost),
      ]),
    }
  }

  if (kind === 'locks') {
    return {
      columns: ['SID', 'Type', 'Mode held', 'Request', 'Blocking'],
      rows: arrayOfRecords(payload.locks).map((lock) => [
        stringValue(lock.sid),
        stringValue(lock.type),
        stringValue(lock.modeHeld ?? lock.lmode),
        stringValue(lock.request),
        stringValue(lock.blocking),
      ]),
    }
  }

  if (kind === 'invalid-objects') {
    return {
      columns: ['Owner', 'Object', 'Type', 'Status'],
      rows: arrayOfRecords(payload.invalidObjects).map((item) => [
        stringValue(item.owner),
        stringValue(item.name ?? item.objectName),
        stringValue(item.type ?? item.objectType),
        stringValue(item.status),
      ]),
    }
  }

  if (kind === 'sql-monitor') {
    return {
      columns: ['SQL ID', 'Status', 'Elapsed', 'SQL text'],
      rows: arrayOfRecords(payload.topSql ?? payload.sqlMonitor).map((sql) => [
        stringValue(sql.sqlId),
        stringValue(sql.status),
        stringValue(sql.elapsedMs),
        sqlTextSummary(sql.sqlText),
      ]),
    }
  }

  return {
    columns: ['SID', 'User', 'Status', 'Wait / Event'],
    rows: arrayOfRecords(payload.sessions).map((session) => [
      stringValue(session.sid),
      stringValue(session.username),
      stringValue(session.status),
      stringValue(session.waitClass ?? session.event),
    ]),
  }
}

function oracleQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: state.kind === 'table' ? 'sql-select' : undefined,
  }
}

function sourceLinesFromPayload(payload: JsonRecord) {
  const lines = payload.sourceLines
  if (!Array.isArray(lines)) {
    return []
  }

  return lines.map((line, index) => {
    if (typeof line === 'string') {
      return { line: String(index + 1), text: line }
    }

    const record = asRecord(line)
    return {
      line: stringValue(record.line ?? index + 1),
      text: stringValue(record.text ?? record.source),
    }
  }).filter((line) => line.text)
}

function oracleSourceOutline(sourceLines: Array<{ line: string; text: string }>) {
  const declarationPattern = /\b(package|procedure|function|type|trigger|cursor)\b/i
  const declarations = sourceLines
    .map((line) => ({
      line: line.line,
      text: line.text.trim().replace(/\s+/g, ' '),
    }))
    .filter((line) => declarationPattern.test(line.text))

  return declarations.slice(0, 12).map((line) => [
    line.line,
    oracleDeclarationSummary(line.text),
  ])
}

function oracleDeclarationSummary(text: string) {
  const normalized = text.replace(/^create\s+(or\s+replace\s+)?/i, '').trim()
  const match = /\b(package\s+body|package|procedure|function|type\s+body|type|trigger|cursor)\s+([A-Za-z0-9_$#"]+)/i.exec(normalized)
  if (!match) {
    return 'PL/SQL declaration'
  }

  const declarationKind = match[1]
  const declarationName = match[2]
  if (!declarationKind || !declarationName) {
    return 'PL/SQL declaration'
  }

  const kind = humanize(declarationKind.toLowerCase())
  const name = declarationName.replace(/"/g, '')
  return `${kind}: ${name}`
}

function objectUnit(kind: string, payload: JsonRecord, rowCount: number) {
  if (payload.objectName) {
    return stringValue(payload.objectName)
  }

  if (rowCount > 0) {
    return `${rowCount} row(s)`
  }

  return kind
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

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  const payloadWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === 'string')
    : []

  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...payloadWarnings,
  ].filter(Boolean)
}

function oracleObjectViewSummary(summary: string | undefined, descriptor: OracleObjectViewDescriptor) {
  if (!summary) {
    return ''
  }

  if (/metadata views|permission sensitive|raw|payload/i.test(summary)) {
    return descriptor.emptyDescription
  }

  return summary
}

function cardRowsFromPayload(payload: JsonRecord, keys: string[]) {
  return keys
    .map((key) => [humanize(key), stringValue(payload[key])])
    .filter(([, value]) => value)
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function bytesText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function sqlTextSummary(value: unknown) {
  const text = stringValue(value).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  const keyword = text.match(/\b(select|insert|update|delete|merge|create|alter|drop|exec|execute|with)\b/i)?.[1]
  const label = keyword ? `${keyword.toUpperCase()} statement` : 'SQL text'
  return text.length > 80 ? `${label} (${text.length.toLocaleString()} chars)` : `${label}: ${text}`
}

function humanize(value: string) {
  return value
    .replace(/[_.$-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeOracleObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
