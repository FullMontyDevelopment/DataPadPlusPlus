import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import {
  graphObjectRows,
  type GraphModel,
  type SelectedGraphItem,
} from './GraphResultsView.model'

const GRAPH_OBJECT_ROW_HEIGHT = 38

export function GraphObjectsView({
  filter,
  model,
  selected,
  onFilterChange,
  onSelect,
}: {
  filter: string
  model: GraphModel
  selected?: SelectedGraphItem
  onFilterChange(value: string): void
  onSelect(item: SelectedGraphItem): void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => graphObjectRows(model, filter), [filter, model])
  // TanStack Virtual keeps large graph object lists responsive without mounting every row.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => GRAPH_OBJECT_ROW_HEIGHT,
    overscan: 24,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const renderedRows = virtualItems.length > 0
    ? virtualItems.map((item) => ({ key: item.key, index: item.index, start: item.start }))
    : rows.map((_row, index) => ({ key: index, index, start: index * GRAPH_OBJECT_ROW_HEIGHT }))

  return (
    <section className="graph-result-objects">
      <div className="graph-result-object-filter">
        <input
          aria-label="Filter graph objects"
          placeholder="Filter"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>
      <div ref={parentRef} className="graph-result-object-list" role="listbox" aria-label="Graph objects">
        <div className="graph-result-object-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
          {renderedRows.map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) {
              return null
            }
            const active = selected?.kind === row.kind && selected.id === row.id
            return (
              <button
                key={virtualRow.key}
                type="button"
                className={`graph-result-object-row${active ? ' is-active' : ''}`}
                role="option"
                aria-selected={active}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                onClick={() => onSelect({ kind: row.kind, id: row.id })}
              >
                <span>{row.kind}</span>
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
