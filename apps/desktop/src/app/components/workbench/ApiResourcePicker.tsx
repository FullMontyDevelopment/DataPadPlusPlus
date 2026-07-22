import { useId, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DatastoreApiServerResourceConfig } from '@datapadplusplus/shared-types'
import { SearchIcon } from './icons'
import { resourceGroup } from './ApiResourcePicker.helpers'

interface ApiResourcePickerProps {
  resources: DatastoreApiServerResourceConfig[]
  selectedIds: Set<string>
  busy?: boolean
  embedded?: boolean
  onCancel?(): void
  onConfirm?(): void
  onSelectionChange(next: Set<string>): void
}

type ResourceRow =
  | { id: string; kind: 'group'; label: string; count: number }
  | { id: string; kind: 'resource'; resource: DatastoreApiServerResourceConfig }

export function ApiResourcePicker({
  resources,
  selectedIds,
  busy,
  embedded,
  onCancel,
  onConfirm,
  onSelectionChange,
}: ApiResourcePickerProps) {
  const [search, setSearch] = useState('')
  const titleId = useId()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matching = resources.filter((resource) =>
      !query || resourceSearchText(resource).includes(query),
    )
    const groups = new Map<string, DatastoreApiServerResourceConfig[]>()
    for (const resource of matching) {
      const group = resourceGroup(resource)
      groups.set(group, [...(groups.get(group) ?? []), resource])
    }
    const next: ResourceRow[] = []
    for (const [label, groupResources] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      next.push({ id: `group:${label}`, kind: 'group', label, count: groupResources.length })
      next.push(...groupResources
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((resource) => ({ id: resource.id, kind: 'resource' as const, resource })))
    }
    return next
  }, [resources, search])
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === 'group' ? 32 : 48,
    overscan: 12,
  })

  const picker = (
      <section
        className={embedded ? 'api-resource-picker-embedded' : 'workbench-dialog api-resource-picker-dialog'}
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={titleId}
      >
        <div className="environment-section-header">
          <div className="api-server-section-title">
            <strong id={titleId}>{embedded ? 'Available Resources' : 'Choose Resources'}</strong>
            <span>Resources are grouped by their Explorer metadata path.</span>
          </div>
          <span>{selectedIds.size} selected</span>
        </div>
        <label className="mcp-access-search">
          <SearchIcon className="panel-inline-icon" />
          <input
            type="search"
            autoFocus={!embedded}
            value={search}
            placeholder="Search name, kind, detail, or metadata path"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div ref={scrollRef} className="api-resource-picker-list">
          <div className="mcp-access-tree-spacer" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  key={row.id}
                  className={`api-resource-picker-row api-resource-picker-row--${row.kind}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.kind === 'group' ? (
                    <>
                      <strong>{row.label}</strong>
                      <span>{row.count}</span>
                    </>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.resource.id)}
                        disabled={busy}
                        onChange={(event) => {
                          const next = new Set(selectedIds)
                          if (event.target.checked) next.add(row.resource.id)
                          else next.delete(row.resource.id)
                          onSelectionChange(next)
                        }}
                      />
                      <span>
                        <strong>{row.resource.label}</strong>
                        <small>
                          {row.resource.kind}
                          {row.resource.detail ? ` / ${row.resource.detail}` : ''}
                        </small>
                      </span>
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="settings-empty">No matching resources were discovered.</div>
        ) : null}
        {!embedded ? <div className="drawer-button-row">
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={busy || selectedIds.size === 0}
            onClick={onConfirm}
          >
            Add Selected
          </button>
          <button type="button" className="drawer-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div> : null}
      </section>
  )

  if (embedded) return picker

  return (
    <div className="workbench-modal-overlay" role="presentation">
      {picker}
    </div>
  )
}

function resourceSearchText(resource: DatastoreApiServerResourceConfig) {
  return [resource.label, resource.kind, resource.detail, resourceGroup(resource)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}
