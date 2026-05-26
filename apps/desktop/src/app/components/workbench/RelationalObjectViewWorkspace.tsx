import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
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

interface RelationalObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
}

export function RelationalObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
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
  const cards = metricCardsForPayload(kind, payload, connection)

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

      <div className="object-view-body">
        <RelationalWorkflowStrip
          connection={connection}
          kind={kind}
          queryTarget={queryTarget}
          descriptor={descriptor}
          onOpenQuery={onOpenQuery}
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
        />

        {sections.length ? (
          sections.map((section) => (
            <section className="object-view-section" key={section.title}>
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
  onOpenQuery,
}: {
  connection: ConnectionProfile
  kind: string
  queryTarget?: ScopedQueryTarget
  descriptor: RelationalObjectViewDescriptor
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const workflows = relationalWorkflows(connection, kind, descriptor, Boolean(queryTarget))
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
