import type {
  ConnectionProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { ExplorerNodeIcon } from '../../../SideBar.node-icons'
import {
  ExplorerIcon,
  ObjectSecurityIcon,
  WarningIcon,
} from '../../../icons'
import type { DatastoreExplorerDetailProvider } from './DatastoreExplorerProvider.types'
import {
  humanize,
  isSensitiveMetadataKey,
} from './DatastoreExplorerProvider.model'
import { DatastoreExplorerStructuredValue } from './DatastoreExplorerStructuredValue'

const MAX_TABLE_ROWS = 100
const MAX_COLUMNS = 8

export function DatastoreExplorerDetails({
  connection,
  node,
  provider,
  inspection,
  scopeResponse,
  loading,
  error,
  onLoadMore,
  onSelectNode,
  onOpenQuery,
  onOpenObjectView,
}: {
  connection: ConnectionProfile
  node: ExplorerNode
  provider: DatastoreExplorerDetailProvider
  inspection?: ExplorerInspectResponse
  scopeResponse?: ExplorerResponse
  loading: boolean
  error?: string
  onLoadMore(cursor: string): void
  onSelectNode(node: ExplorerNode): void
  onOpenQuery(): void
  onOpenObjectView(): void
}) {
  const inspected = inspection?.nodeId === node.id ? inspection : undefined
  const payload = asRecord(inspected?.payload)
  const warnings = metadataWarnings(payload)
  const scalarEntries = metadataScalars(payload)
  const sections = metadataSections(payload)
  const supportsQuery = Boolean(node.queryTemplate) || isQueryableKind(node.kind)
  const showInspection =
    provider.mode === 'inspection'
    || provider.mode === 'scope-inspection'
  const showScope =
    provider.mode === 'scope'
    || provider.mode === 'scope-inspection'

  if (error && !scopeResponse && !inspected) {
    return <PurposeState title="Metadata unavailable" detail={error} tone="error" />
  }

  return (
    <div className="datastore-explorer-detail-content">
      <div className="datastore-explorer-detail-actions">
        {supportsQuery ? (
          <button type="button" className="drawer-button drawer-button--primary" onClick={onOpenQuery}>
            Open query
          </button>
        ) : null}
        {provider.mode !== 'state' ? (
          <button type="button" className="drawer-button" onClick={onOpenObjectView}>
            Open full view
          </button>
        ) : null}
      </div>

      {warnings.length ? (
        <section className="datastore-explorer-section is-warning">
          <header>
            <WarningIcon />
            <div>
              <h3>Attention</h3>
              <p>Availability and safety information returned by the datastore.</p>
            </div>
          </header>
          <ul className="datastore-explorer-message-list">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="datastore-explorer-section">
        <header>
          <ExplorerNodeIcon connection={connection} kind={node.kind} />
          <div>
            <h3>Overview</h3>
            <p>{provider.description || node.detail || `Selected ${provider.label.toLowerCase()}.`}</p>
          </div>
        </header>
        <dl className="datastore-explorer-metrics">
          <div><dt>Type</dt><dd>{humanize(node.kind)}</dd></div>
          <div><dt>Scope</dt><dd>{node.scope || 'Current connection'}</dd></div>
          {scopeResponse ? <div><dt>Loaded</dt><dd>{scopeResponse.nodes.length}</dd></div> : null}
          {scopeResponse?.pageInfo?.knownTotal !== undefined ? (
            <div><dt>Available</dt><dd>{scopeResponse.pageInfo.knownTotal}</dd></div>
          ) : null}
        </dl>
        {scalarEntries.length ? (
          <dl className="datastore-explorer-facts">
            {scalarEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{humanize(key)}</dt>
                <dd><DatastoreExplorerStructuredValue value={value} /></dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {showScope ? (
        <ScopeInventory
          connection={connection}
          response={scopeResponse}
          loading={loading}
          onLoadMore={onLoadMore}
          onSelectNode={onSelectNode}
        />
      ) : null}

      {showInspection && loading && !inspected ? (
        <PurposeState title="Loading details…" detail={`Reading bounded ${provider.label.toLowerCase()} metadata.`} />
      ) : null}
      {showInspection && !loading && inspected ? (
        sections.map((section) => (
          <MetadataSection key={section.key} section={section} />
        ))
      ) : null}
      {showInspection && !loading && inspected && !sections.length && !scalarEntries.length ? (
        <PurposeState
          title="No additional metadata returned"
          detail={inspected.summary || 'This object is available, but the connected account returned no further details.'}
        />
      ) : null}
      {provider.mode === 'launch' ? (
        <PurposeState
          title={`Open ${provider.label}`}
          detail={node.detail || 'Use the primary action to open the datastore-native working surface.'}
          actionLabel={supportsQuery ? 'Open query' : 'Open full view'}
          onAction={supportsQuery ? onOpenQuery : onOpenObjectView}
        />
      ) : null}
      {provider.mode === 'state' ? (
        <PurposeState
          title={provider.label}
          detail={node.detail || 'This metadata surface is not available for the current connection.'}
          tone={node.kind === 'permission' || node.kind === 'unavailable' ? 'warning' : 'neutral'}
        />
      ) : null}
    </div>
  )
}

function ScopeInventory({
  connection,
  response,
  loading,
  onLoadMore,
  onSelectNode,
}: {
  connection: ConnectionProfile
  response?: ExplorerResponse
  loading: boolean
  onLoadMore(cursor: string): void
  onSelectNode(node: ExplorerNode): void
}) {
  return (
    <section className="datastore-explorer-section">
      <header>
        <ExplorerIcon />
        <div>
          <h3>Inventory</h3>
          <p>Objects loaded for this scope.</p>
        </div>
      </header>
      {loading && !response ? <p className="datastore-explorer-empty">Loading objects…</p> : null}
      {!loading && response && response.nodes.length === 0 ? (
        <p className="datastore-explorer-empty">No objects were returned for this scope.</p>
      ) : null}
      {response?.nodes.length ? (
        <ul className="datastore-explorer-inventory">
          {response.nodes.map((child) => (
            <li key={child.id}>
              <button type="button" onClick={() => onSelectNode(child)}>
                <ExplorerNodeIcon connection={connection} kind={child.kind} />
                <span>
                  <strong>{child.label}</strong>
                  <small>{child.detail || humanize(child.kind)}</small>
                </span>
                <span>{humanize(child.kind)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {response?.pageInfo?.hasMore && response.pageInfo.nextCursor ? (
        <button
          type="button"
          className="datastore-explorer-section-action"
          onClick={() => onLoadMore(response.pageInfo!.nextCursor!)}
        >
          Load more
        </button>
      ) : null}
    </section>
  )
}

interface NormalizedSection {
  key: string
  label: string
  value: unknown
}

function MetadataSection({ section }: { section: NormalizedSection }) {
  const records = arrayOfRecords(section.value)
  const primitiveItems = Array.isArray(section.value)
    ? section.value.filter((value) => isPrimitive(value))
    : []
  return (
    <section className="datastore-explorer-section">
      <header>
        <ExplorerIcon />
        <div>
          <h3>{section.label}</h3>
          <p>{sectionPurpose(section.key)}</p>
        </div>
      </header>
      {records.length ? <MetadataTable records={records} /> : null}
      {primitiveItems.length ? (
        <ul className="datastore-explorer-message-list">
          {primitiveItems.slice(0, MAX_TABLE_ROWS).map((value, index) => (
            <li key={`${index}:${String(value)}`}>
              <DatastoreExplorerStructuredValue value={value} />
            </li>
          ))}
        </ul>
      ) : null}
      {!records.length && !primitiveItems.length ? (
        <DatastoreExplorerStructuredValue value={section.value} />
      ) : null}
    </section>
  )
}

function MetadataTable({ records }: { records: Record<string, unknown>[] }) {
  const columns = Array.from(
    new Set(records.flatMap((record) => Object.keys(record).filter((key) => !isSensitiveMetadataKey(key)))),
  ).slice(0, MAX_COLUMNS)
  const visible = records.slice(0, MAX_TABLE_ROWS)
  return (
    <div className="datastore-explorer-table-wrap">
      <table className="datastore-explorer-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr>
        </thead>
        <tbody>
          {visible.map((record, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>
                  <DatastoreExplorerStructuredValue value={record[column]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {records.length > visible.length ? <p className="datastore-explorer-empty">Showing the first {visible.length} rows.</p> : null}
    </div>
  )
}

function PurposeState({
  title,
  detail,
  tone = 'neutral',
  actionLabel,
  onAction,
}: {
  title: string
  detail: string
  tone?: 'neutral' | 'warning' | 'error'
  actionLabel?: string
  onAction?: () => void
}) {
  const Icon = tone === 'neutral' ? ExplorerIcon : tone === 'warning' ? ObjectSecurityIcon : WarningIcon
  return (
    <div className={`datastore-explorer-purpose-state is-${tone}`}>
      <Icon />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
        {actionLabel && onAction ? <button type="button" className="drawer-button" onClick={onAction}>{actionLabel}</button> : null}
      </div>
    </div>
  )
}

function metadataWarnings(payload: Record<string, unknown>) {
  const values = [
    ...(Array.isArray(payload.warnings) ? payload.warnings : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...(typeof payload.message === 'string' && /warning|unavailable|permission|restricted|unsupported/i.test(payload.message)
      ? [payload.message]
      : []),
  ]
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))))
}

function metadataScalars(payload: Record<string, unknown>) {
  return Object.entries(payload).filter(([key, value]) =>
    !isSensitiveMetadataKey(key)
    && !['objectView', 'warnings', 'warning', 'message', 'queryTemplate', 'sourceText', 'ddl', 'script'].includes(key)
    && isPrimitive(value),
  )
}

function metadataSections(payload: Record<string, unknown>): NormalizedSection[] {
  return Object.entries(payload)
    .filter(([key, value]) =>
      !isSensitiveMetadataKey(key)
      && !['objectView', 'warnings', 'warning', 'message', 'queryTemplate', 'sourceText', 'ddl', 'script'].includes(key)
      && !isPrimitive(value)
      && value !== null
      && (!Array.isArray(value) || value.length > 0),
    )
    .map(([key, value]) => ({ key, label: humanize(key), value }))
}

function sectionPurpose(key: string) {
  const normalized = key.toLowerCase()
  if (/(permission|role|user|grant|policy)/.test(normalized)) return 'Principals, resources, actions, and effective access.'
  if (/(index|key|constraint|schema|field|column|mapping)/.test(normalized)) return 'Structure and access-path metadata for the selected object.'
  if (/(stat|metric|capacity|health|diagnostic|wait|lock)/.test(normalized)) return 'Operational signals returned for the selected scope.'
  if (/(document|item|row|sample|record)/.test(normalized)) return 'Bounded sample data rendered with type-aware values.'
  return 'Structured metadata returned by the datastore provider.'
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isPrimitive(value: unknown) {
  return value === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof value)
}

function isQueryableKind(kind: string) {
  return /(table|view|collection|document|item|key|metric|index|graph|query|search|measurement|bucket)/i.test(kind)
}
