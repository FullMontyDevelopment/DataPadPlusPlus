import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  ExplorerNode,
  QueryBuilderState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { ChevronDownIcon, RefreshIcon, SearchIcon } from '../icons'
import {
  queryTargetOptions,
  queryTargetRegistryForEngine,
  targetRelatedExplorerScopes,
  type QueryTargetOption,
} from './query-target-registry'

export function QueryTargetPicker({
  builderState,
  connection,
  disabled,
  error,
  isScopeLoaded,
  isScopeLoading,
  nodes,
  onChange,
  onLoadScope,
  onRefresh,
  scopedTarget,
}: {
  builderState: QueryBuilderState | undefined
  connection: ConnectionProfile
  disabled?: boolean
  error?: string
  isScopeLoaded(scope?: string): boolean
  isScopeLoading(scope?: string): boolean
  nodes: ExplorerNode[]
  onChange(target: ScopedQueryTarget): void
  onLoadScope(scope?: string): void
  onRefresh(): void
  scopedTarget?: ScopedQueryTarget
}) {
  const registry = queryTargetRegistryForEngine(connection.engine)
  const targetData = useMemo(
    () => queryTargetOptions(connection, nodes, scopedTarget, builderState),
    [builderState, connection, nodes, scopedTarget],
  )
  const [openLevel, setOpenLevel] = useState<number>()
  const [search, setSearch] = useState('')
  const selectedSourceKey = targetData.selectedValues.join('\u001f')
  const [selectionDraft, setSelectionDraft] = useState<{
    sourceKey: string
    values: string[]
  }>()
  const selected = selectionDraft?.sourceKey === selectedSourceKey
    ? selectionDraft.values
    : targetData.selectedValues
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openLevel === undefined) {
      return
    }
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenLevel(undefined)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenLevel(undefined)
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openLevel])

  useEffect(() => {
    if (openLevel === undefined) {
      return
    }
    if (!isScopeLoaded() && !isScopeLoading()) {
      onLoadScope()
    }
    for (const scope of targetRelatedExplorerScopes(connection, nodes, selected)) {
      if (!isScopeLoaded(scope) && !isScopeLoading(scope)) {
        onLoadScope(scope)
      }
    }
  }, [connection, isScopeLoaded, isScopeLoading, nodes, onLoadScope, openLevel, selected])

  if (registry.levels.length === 0) {
    return null
  }

  return (
    <div className="query-target-picker" ref={rootRef} aria-label="Query target">
      {targetData.levels.map((level, levelIndex) => {
        const options = optionsForSelection(targetData.options[levelIndex] ?? [], selected, levelIndex)
        const filtered = options.filter((option) =>
          option.label.toLowerCase().includes(search.trim().toLowerCase()),
        )
        const isOpen = openLevel === levelIndex
        const selectedValue = selected[levelIndex]
        const loading = isScopeLoading() || options.some((option) => option.scope && isScopeLoading(option.scope))

        return (
          <div className="query-target-level" key={level.id}>
            <button
              type="button"
              className={`query-target-trigger${selectedValue ? '' : ' is-empty'}`}
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-label={`Change ${level.label}`}
              disabled={disabled}
              title={disabled ? 'Wait for the current query to finish.' : `Change ${level.label.toLowerCase()}`}
              onClick={() => {
                setSearch('')
                setOpenLevel(isOpen ? undefined : levelIndex)
              }}
            >
              <span className="query-target-trigger-label">{level.label}</span>
              <strong>{selectedValue || 'Select'}</strong>
              <ChevronDownIcon />
            </button>

            {isOpen ? (
              <div className="query-target-menu">
                <div className="query-target-search">
                  <SearchIcon aria-hidden="true" />
                  <input
                    autoFocus
                    value={search}
                    aria-label={`Search ${level.label}`}
                    placeholder={`Search ${level.label.toLowerCase()}`}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-button query-target-refresh"
                    aria-label={`Refresh ${level.label}`}
                    title="Refresh live Explorer metadata"
                    onClick={onRefresh}
                  >
                    <RefreshIcon />
                  </button>
                </div>
                <div className="query-target-options" role="listbox" aria-label={level.label}>
                  {loading && filtered.length === 0 ? (
                    <div className="query-target-state">Loading live metadata...</div>
                  ) : null}
                  {!loading && error && filtered.length === 0 ? (
                    <div className="query-target-state is-error">Metadata is restricted or unavailable. Refresh to retry.</div>
                  ) : null}
                  {!loading && !error && filtered.length === 0 ? (
                    <div className="query-target-state">No discovered targets.</div>
                  ) : null}
                  {filtered.map((option) => (
                    <TargetOptionButton
                      key={`${(option.values ?? []).join(':')}:${option.value}`}
                      option={option}
                      selected={selectedValue === option.value}
                      onSelect={() => {
                        if (selectedValue === option.value) {
                          setSearch('')
                          setOpenLevel(undefined)
                          return
                        }
                        const nextSelected = selected.map((value, index) =>
                          index < levelIndex
                            ? value
                            : index === levelIndex
                              ? option.value
                              : '',
                        )
                        setSelectionDraft({ sourceKey: selectedSourceKey, values: nextSelected })
                        setSearch('')
                        if (option.scope && !isScopeLoaded(option.scope)) {
                          onLoadScope(option.scope)
                        }
                        if (option.target) {
                          setOpenLevel(undefined)
                          onChange(option.target)
                        } else if (levelIndex < targetData.levels.length - 1) {
                          setOpenLevel(levelIndex + 1)
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function TargetOptionButton({
  onSelect,
  option,
  selected,
}: {
  onSelect(): void
  option: QueryTargetOption
  selected: boolean
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`query-target-option${selected ? ' is-selected' : ''}`}
      disabled={option.unavailable}
      title={option.unavailable ? 'This saved target is no longer present in live Explorer metadata.' : option.label}
      onClick={onSelect}
    >
      <span>{option.label}</span>
      {option.unavailable ? <small>Unavailable</small> : null}
    </button>
  )
}

function optionsForSelection(
  options: QueryTargetOption[],
  selected: string[],
  levelIndex: number,
) {
  return options.filter((option) => {
    const values = option.values ?? []
    for (let index = 0; index < levelIndex; index += 1) {
      if (selected[index] && values[index] && selected[index] !== values[index]) {
        return false
      }
    }
    return true
  })
}
