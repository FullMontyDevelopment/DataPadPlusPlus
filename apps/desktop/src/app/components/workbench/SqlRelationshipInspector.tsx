import { useMemo, useState } from 'react'
import type { ConnectionProfile, ExplorerNode, StructureNode } from '@datapadplusplus/shared-types'
import type { SqlExplorerNode, SqlRelationshipModel } from './SqlRelationshipExplorer.model'
import {
  buildForeignKeyPreviewSql,
  buildJoinSql,
  buildSelectSql,
  edgeLabel,
} from './SqlRelationshipExplorer.model'
import {
  CopyIcon,
  PanelIcon,
  ObjectIndexIcon,
  ObjectRelationshipIcon,
  ObjectTableIcon,
  QueryIcon,
} from './icons'

interface SqlRelationshipInspectorProps {
  connection: ConnectionProfile
  model: SqlRelationshipModel
  selectedNode: SqlExplorerNode
  onCollapse(): void
  onInspectNode(node: StructureNode): void
  onOpenQuery(node: SqlExplorerNode, queryText: string): void
  onOpenObjectView(node: ExplorerNode): void
}

export function SqlRelationshipInspector({
  connection,
  model,
  selectedNode,
  onCollapse,
  onInspectNode,
  onOpenQuery,
  onOpenObjectView,
}: SqlRelationshipInspectorProps) {
  const [previewSql, setPreviewSql] = useState<string | undefined>()
  const primaryEdge = selectedNode.outgoing[0] ?? selectedNode.incoming[0]
  const relationshipRows = useMemo(
    () => [...selectedNode.outgoing, ...selectedNode.incoming],
    [selectedNode.incoming, selectedNode.outgoing],
  )

  const querySql = buildSelectSql(selectedNode, connection.engine)
  const joinSql = buildJoinSql(selectedNode, primaryEdge, model, connection.engine)
  const fkPreview = buildForeignKeyPreviewSql(primaryEdge, model, connection.engine)

  return (
    <aside className="sql-rel-inspector" aria-label="Relationship details">
      <header className="sql-rel-inspector-header">
        <ObjectTableIcon className="structure-icon" />
        <div>
          <strong>{selectedNode.objectName}</strong>
          <span>{selectedNode.schema}</span>
        </div>
        <button
          type="button"
          className="icon-button sql-rel-inspector-collapse"
          aria-label="Collapse relationship details panel"
          title="Hide details"
          onClick={onCollapse}
        >
          <PanelIcon className="toolbar-icon" />
        </button>
      </header>

      <div className="sql-rel-action-row">
        <button type="button" className="toolbar-action" title="Open query" onClick={() => onOpenQuery(selectedNode, querySql)}>
          <QueryIcon className="toolbar-icon" />
          Query
        </button>
        <button type="button" className="toolbar-action" title="Inspect" aria-label={`Inspect ${selectedNode.objectName}`} onClick={() => onInspectNode(selectedNode.node)}>
          <ObjectTableIcon className="toolbar-icon" />
          Inspect
        </button>
        <button type="button" className="toolbar-action" title="Open object view" aria-label={`Open object view for ${selectedNode.objectName}`} onClick={() => onOpenObjectView(nodeToExplorerNode(selectedNode, connection))}>
          <ObjectTableIcon className="toolbar-icon" />
          Object
        </button>
        <button type="button" className="toolbar-action" title="Copy name" onClick={() => void navigator.clipboard?.writeText(selectedNode.qualifiedName)}>
          <CopyIcon className="toolbar-icon" />
        </button>
      </div>

      <div className="sql-rel-stat-grid">
        <Metric label="Columns" value={String(selectedNode.fieldCount)} />
        <Metric label="Relations" value={String(selectedNode.relationshipCount)} />
        <Metric label="Indexes" value={selectedNode.node.indexCount == null ? '—' : String(selectedNode.node.indexCount)} />
        <Metric label="Rows" value={selectedNode.node.rowCountEstimate == null ? '—' : formatCount(selectedNode.node.rowCountEstimate)} />
      </div>

      <section className="details-section">
        <div className="sql-rel-section-title">
          <ObjectIndexIcon className="toolbar-icon" />
          <strong>Columns</strong>
        </div>
        <div className="sql-rel-column-list">
          {(selectedNode.node.fields ?? []).map((field) => (
            <div key={`${selectedNode.node.id}-${field.name}`} className="sql-rel-column-row">
              <span>{field.primary ? '◆ ' : ''}{field.name}</span>
              <code>{field.dataType}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="details-section">
        <div className="sql-rel-section-title">
          <ObjectRelationshipIcon className="toolbar-icon" />
          <strong>Relationships</strong>
        </div>
        {relationshipRows.length === 0 ? (
          <p className="panel-footnote">No relationships loaded.</p>
        ) : (
          <div className="sql-rel-edge-list">
            {relationshipRows.map((edge) => (
              <button
                key={edge.id}
                type="button"
                className="sql-rel-edge-row"
                title={edge.inferred ? 'Inferred relationship' : 'Declared foreign key'}
                onClick={() => {
                  setPreviewSql(buildForeignKeyPreviewSql(edge, model, connection.engine))
                }}
              >
                <span>{edgeLabel(edge)}</span>
                <code>{edge.inferred ? 'inferred' : edge.kind}</code>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="details-section">
        <div className="sql-rel-action-row">
          <button type="button" className="toolbar-action" onClick={() => onOpenQuery(selectedNode, joinSql)}>
            <ObjectRelationshipIcon className="toolbar-icon" />
            Join
          </button>
          <button type="button" className="toolbar-action" disabled={!fkPreview} onClick={() => setPreviewSql(fkPreview)}>
            <ObjectRelationshipIcon className="toolbar-icon" />
            FK
          </button>
        </div>
        {previewSql ? (
          <pre className="sql-rel-preview-sql" aria-label="Preview SQL">{previewSql}</pre>
        ) : null}
      </section>
    </aside>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function nodeToExplorerNode(node: SqlExplorerNode, connection: ConnectionProfile): ExplorerNode {
  return {
    id: node.node.id,
    family: connection.family,
    label: node.objectName,
    kind: node.isView ? 'view' : 'table',
    detail: node.qualifiedName,
    path: [node.schema, node.objectName],
    expandable: false,
  }
}

function formatCount(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}
