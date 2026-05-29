import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  ObjectIndexIcon,
  ObjectJobIcon,
  ObjectSecurityIcon,
  ObjectTableIcon,
  PlayIcon,
} from './icons'
import {
  asRecord,
  descriptorForConnection,
  labelForColumn,
  metricCardsForPayload,
  normalizeKind,
  objectViewWarnings,
  relationalQueryTargetFromObjectView,
  relationalSections,
  relationalWorkflows,
  type RelationalObjectViewDescriptor,
} from './RelationalObjectViewWorkspace.helpers'
import { ObjectViewHeader } from './ObjectViewHeader'
import {
  PurposeEmptyState,
  WarningList,
} from './ObjectViewPrimitives'
import { RelationalSourcePreview } from './RelationalSourcePreview'
import { relationalSourceText } from './RelationalSourcePreview.helpers'
import { RelationalOperationStrip } from './RelationalObjectViewOperations'
import { CockroachObjectViewInsights } from './CockroachObjectViewInsights'
import { DuckDbObjectViewInsights } from './DuckDbObjectViewInsights'
import { MysqlObjectViewInsights } from './MysqlObjectViewInsights'
import { PostgresObjectViewInsights } from './PostgresObjectViewInsights'
import { SqlServerObjectViewInsights } from './SqlServerObjectViewInsights'
import { SqliteObjectViewInsights } from './SqliteObjectViewInsights'
import { TimescaleObjectViewInsights } from './TimescaleObjectViewInsights'

interface RelationalObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: (request: OperationPlanRequest) => Promise<OperationPlanResponse | undefined>
}

export function RelationalObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onPlanOperation,
}: RelationalObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const kind = normalizeKind(state?.kind ?? 'object')
  const descriptor = descriptorForConnection(connection, kind)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(() => relationalQueryTargetFromObjectView(tab), [tab])
  const sections = relationalSections(kind, payload, descriptor)
  const hasSourcePreview = Boolean(relationalSourceText(kind, payload))
  const availableSectionKeys = new Set([
    ...sections.map((section) => section.key),
    ...(hasSourcePreview ? ['source'] : []),
  ])
  const cards = metricCardsForPayload(kind, payload, connection)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const focusSection = useCallback((sectionKey: string) => {
    const section = bodyRef.current?.querySelector<HTMLElement>(`[data-relational-section-key="${sectionKey}"]`)
    section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    section?.focus({ preventScroll: true })
  }, [])

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
          <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel}
          </button>
        ) : null}
      </ObjectViewHeader>

      <WarningList warnings={objectViewWarnings(tab, payload)} />

      <div className="object-view-body" ref={bodyRef}>
        <RelationalWorkflowStrip
          connection={connection}
          kind={kind}
          queryTarget={queryTarget}
          descriptor={descriptor}
          availableSectionKeys={availableSectionKeys}
          onOpenQuery={onOpenQuery}
          onFocusSection={focusSection}
        />
        <RelationalOperationStrip
          connection={connection}
          environment={environment}
          tab={tab}
          kind={kind}
          payload={payload}
          onPlanOperation={onPlanOperation}
        />

        {cards.length ? (
          <section className="object-view-section">
            <ObjectViewSectionHeading
              icon={kind.includes('index') ? 'index' : kind.includes('security') ? 'security' : 'table'}
              title="At a Glance"
            />
            <div className="object-view-card-grid">
              {cards.map((card) => (
                <div className="object-view-card" key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <RelationalSourcePreview
          connection={connection}
          kind={kind}
          payload={payload}
          sectionKey="source"
        />

        {connection.engine === 'cockroachdb' ? (
          <CockroachObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'duckdb' ? (
          <DuckDbObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'mysql' || connection.engine === 'mariadb' ? (
          <MysqlObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'postgresql' ? (
          <PostgresObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'sqlserver' ? (
          <SqlServerObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'sqlite' ? (
          <SqliteObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {connection.engine === 'timescaledb' ? (
          <TimescaleObjectViewInsights kind={kind} payload={payload} />
        ) : null}

        {sections.length ? (
          sections.map((section) => (
            <section
              className="object-view-section"
              key={section.key}
              data-relational-section-key={section.key}
              tabIndex={-1}
            >
              <ObjectViewSectionHeading
                icon={section.icon}
                title={section.title}
                unit={section.unit}
              />
              <ObjectViewTable
                columns={section.columns}
                rows={section.rows}
                emptyText={section.emptyText}
              />
            </section>
          ))
        ) : (
          <PurposeEmptyState descriptor={descriptor} />
        )}
      </div>
    </section>
  )
}

function ObjectViewSectionHeading({
  icon,
  title,
  unit,
}: {
  icon: 'table' | 'index' | 'security' | 'job'
  title: string
  unit?: string
}) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectTableIcon

  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
}

function RelationalWorkflowStrip({
  connection,
  kind,
  queryTarget,
  descriptor,
  availableSectionKeys,
  onOpenQuery,
  onFocusSection,
}: {
  connection: ConnectionProfile
  kind: string
  queryTarget?: ScopedQueryTarget
  descriptor: RelationalObjectViewDescriptor
  availableSectionKeys: ReadonlySet<string>
  onOpenQuery(target: ScopedQueryTarget): void
  onFocusSection(sectionKey: string): void
}) {
  const workflows = relationalWorkflows(connection, kind, descriptor, Boolean(queryTarget), availableSectionKeys)
  if (!workflows.length) {
    return null
  }

  return (
    <section className="object-view-section object-view-workflow-section" aria-label={`${descriptor.title} workflows`}>
      <div className="object-view-action-chips">
        {workflows.map((workflow) => {
          const chip = (
            <>
              <ObjectViewSectionHeadingIcon icon={workflow.icon} />
              <span>{workflow.label}</span>
            </>
          )

          return workflow.action === 'query' && queryTarget ? (
            <button
              key={workflow.label}
              type="button"
              className="object-view-action-chip object-view-action-chip--button"
              title={workflow.title}
              onClick={() => onOpenQuery(queryTarget)}
            >
              {chip}
            </button>
          ) : workflow.targetSection ? (
            <button
              key={workflow.label}
              type="button"
              className="object-view-action-chip object-view-action-chip--button"
              title={workflow.title}
              onClick={() => onFocusSection(workflow.targetSection!)}
            >
              {chip}
            </button>
          ) : (
            <span
              key={workflow.label}
              className="object-view-action-chip"
              title={workflow.title}
            >
              {chip}
            </span>
          )
        })}
      </div>
    </section>
  )
}

function ObjectViewSectionHeadingIcon({ icon }: { icon: 'table' | 'index' | 'security' | 'job' }) {
  const Icon =
    icon === 'index'
      ? ObjectIndexIcon
      : icon === 'security'
        ? ObjectSecurityIcon
        : icon === 'job'
          ? ObjectJobIcon
          : ObjectTableIcon

  return <Icon className="panel-inline-icon" />
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
  if (!rows.length) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{labelForColumn(column)}</th>)}
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
