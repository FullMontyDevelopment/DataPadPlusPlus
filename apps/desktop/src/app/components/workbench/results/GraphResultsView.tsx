import { useMemo, useState } from 'react'

import { JsonTreeView } from './JsonTreeView'
import { GraphCanvas } from './GraphResultsView.canvas'
import {
  buildGraphModel,
  formatGraphCount,
  graphItemValue,
  type GraphPayload,
  type SelectedGraphItem,
} from './GraphResultsView.model'
import { GraphObjectsView } from './GraphResultsView.objects'
import { ObjectRelationshipIcon, PanelRightIcon } from '../icons'

export function GraphResultsView({ payload }: { payload: GraphPayload }) {
  const [mode, setMode] = useState<'graph' | 'objects'>('graph')
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<SelectedGraphItem>()
  const [canvasError, setCanvasError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const model = useMemo(() => buildGraphModel(payload), [payload])
  const activeSelection = selected && graphItemValue(model, selected)
    ? selected
    : undefined
  const selectedValue = activeSelection ? graphItemValue(model, activeSelection) : undefined
  const hasVisualGraph = model.visualNodes.length > 0
  const nodeCount = payload.nodeCount ?? model.nodes.length
  const edgeCount = payload.edgeCount ?? model.edges.length
  const hasWarnings = model.warnings.length > 0

  return (
    <div className={`graph-result-view${hasWarnings ? ' has-warnings' : ''}`}>
      <header className="graph-result-toolbar">
        <div className="graph-result-mode-toggle" role="tablist" aria-label="Graph result view">
          <button
            type="button"
            role="tab"
            className={mode === 'graph' ? 'is-active' : undefined}
            aria-selected={mode === 'graph'}
            onClick={() => setMode('graph')}
          >
            Graph
          </button>
          <button
            type="button"
            role="tab"
            className={mode === 'objects' ? 'is-active' : undefined}
            aria-selected={mode === 'objects'}
            onClick={() => setMode('objects')}
          >
            Objects
          </button>
        </div>
        <div className="graph-result-toolbar-end">
          <div className="graph-result-stats" aria-label="Graph result counts">
            <span>{formatGraphCount(nodeCount)} {nodeCount === 1 ? 'node' : 'nodes'}</span>
            <span>{formatGraphCount(edgeCount)} {edgeCount === 1 ? 'edge' : 'edges'}</span>
            {model.capped || payload.truncated ? <strong>sample capped</strong> : null}
          </div>
          <button
            type="button"
            className={`bottom-panel-icon-button${detailsOpen ? ' is-active' : ''}`}
            aria-label={detailsOpen ? 'Hide graph details' : 'Show graph details'}
            title={detailsOpen ? 'Hide graph details' : 'Show graph details'}
            onClick={() => setDetailsOpen((current) => !current)}
          >
            <PanelRightIcon className="panel-inline-icon" />
          </button>
        </div>
      </header>

      {model.warnings.length > 0 ? (
        <div className="graph-result-warnings">
          {model.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}

      <div className={`graph-result-body${detailsOpen ? '' : ' is-detail-hidden'}`}>
        <main className="graph-result-main">
          {mode === 'graph' ? (
            hasVisualGraph ? (
              <GraphCanvas
                model={model}
                selected={activeSelection}
                onSelect={setSelected}
                onError={setCanvasError}
              />
            ) : (
              <GraphEmptyState />
            )
          ) : (
            <GraphObjectsView
              filter={filter}
              model={model}
              selected={activeSelection}
              onFilterChange={setFilter}
              onSelect={setSelected}
            />
          )}
          {mode === 'graph' && canvasError ? (
            <p className="graph-result-fallback">{canvasError}</p>
          ) : null}
          {mode === 'graph' && model.nodes.length > 1 && model.edges.length === 0 ? (
            <div className="graph-result-relationship-state" role="status">
              <ObjectRelationshipIcon className="panel-inline-icon" />
              <span>No relationships were returned by this query.</span>
            </div>
          ) : null}
        </main>
        {detailsOpen ? (
          <aside className="graph-result-detail" aria-label="Graph result detail">
            {selectedValue ? (
              <>
                <header>
                  <span>{activeSelection?.kind === 'edge' ? 'Edge' : 'Node'}</span>
                  <strong>{selectedValue.label}</strong>
                </header>
                <JsonTreeView value={selectedValue} label={activeSelection?.kind ?? 'item'} />
              </>
            ) : (
              <div className="graph-result-detail-empty">
                <ObjectRelationshipIcon className="panel-inline-icon" />
                <span>Select a node or relationship to inspect it.</span>
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function GraphEmptyState() {
  return (
    <div className="graph-result-empty">
      <strong>No visual graph objects</strong>
      <span>Open Objects or JSON for the returned payload.</span>
    </div>
  )
}
