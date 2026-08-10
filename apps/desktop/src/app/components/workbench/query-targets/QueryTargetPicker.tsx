import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ConnectionProfile,
  ExplorerNode,
  QueryBuilderState,
  ScopedQueryTarget,
  SqlQueryScope,
} from '@datapadplusplus/shared-types'
import { ChevronDownIcon, RefreshIcon, SearchIcon } from '../icons'
import {
  queryTargetOptions,
  queryTargetRegistryForEngine,
  nativeSqlScopeLevelIds,
  sqlQueryScopeFromValues,
  targetRelatedExplorerScopes,
  type QueryTargetOption,
} from './query-target-registry'

export function QueryTargetPicker({
  builderState,
  connection,
  disabled,
  error,
  floatingMenu,
  isScopeLoaded,
  isScopeLoading,
  nodes,
  onChange,
  onLoadScope,
  onRefresh,
  onSqlScopeChange,
  selectableLevelIds,
  scopedTarget,
  sqlScope,
}: {
  builderState: QueryBuilderState | undefined
  connection: ConnectionProfile
  disabled?: boolean
  error?: string
  floatingMenu?: boolean
  isScopeLoaded(scope?: string): boolean
  isScopeLoading(scope?: string): boolean
  nodes: ExplorerNode[]
  onChange(target: ScopedQueryTarget): void
  onLoadScope(scope?: string): void
  onRefresh(): void
  onSqlScopeChange?(scope: SqlQueryScope | undefined): void
  selectableLevelIds?: ReadonlySet<string>
  scopedTarget?: ScopedQueryTarget
  sqlScope?: SqlQueryScope
}) {
  const registry = queryTargetRegistryForEngine(connection.engine)
  const nativeScopeLevels = useMemo(
    () => nativeSqlScopeLevelIds(connection),
    [connection],
  )
  const effectiveSelectableLevelIds = useMemo(
    () => new Set([...(selectableLevelIds ?? []), ...nativeScopeLevels]),
    [nativeScopeLevels, selectableLevelIds],
  )
  const targetData = useMemo(
    () => queryTargetOptions(
      connection,
      nodes,
      scopedTarget,
      builderState,
      sqlScope,
      effectiveSelectableLevelIds,
    ),
    [builderState, connection, effectiveSelectableLevelIds, nodes, scopedTarget, sqlScope],
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
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [floatingMenuStyle, setFloatingMenuStyle] = useState<CSSProperties>()
  const closeMenu = useCallback(() => {
    setOpenLevel(undefined)
    setFloatingMenuStyle(undefined)
  }, [])

  const positionFloatingMenu = useCallback(() => {
    if (!floatingMenu || openLevel === undefined) {
      return
    }
    const trigger = triggerRefs.current[openLevel]
    if (trigger) {
      setFloatingMenuStyle(floatingMenuPosition(trigger))
    }
  }, [floatingMenu, openLevel])

  useEffect(() => {
    if (openLevel === undefined) {
      return
    }
    const close = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        closeMenu()
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeMenu, openLevel])

  useEffect(() => {
    if (!floatingMenu || openLevel === undefined) {
      return
    }

    const update = () => positionFloatingMenu()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const trigger = triggerRefs.current[openLevel]
    const observer =
      trigger && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(update)
        : undefined
    if (trigger) {
      observer?.observe(trigger)
    }
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [floatingMenu, openLevel, positionFloatingMenu])

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
        const menu = isOpen ? (
          <div
            ref={menuRef}
            className={`query-target-menu${floatingMenu ? ' query-target-menu--floating' : ''}`}
            style={floatingMenu ? floatingMenuStyle : undefined}
          >
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
                      closeMenu()
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
                    if (onSqlScopeChange && nativeScopeLevels.has(level.id)) {
                      onSqlScopeChange(sqlQueryScopeFromValues(connection, nextSelected))
                      if (levelIndex < targetData.levels.length - 1) {
                        setOpenLevel(levelIndex + 1)
                      } else {
                        closeMenu()
                      }
                      return
                    }
                    if (option.target) {
                      closeMenu()
                      onChange(option.target)
                    } else if (levelIndex < targetData.levels.length - 1) {
                      const nextLevel = levelIndex + 1
                      const nextTrigger = triggerRefs.current[nextLevel]
                      if (floatingMenu && nextTrigger) {
                        setFloatingMenuStyle(floatingMenuPosition(nextTrigger))
                      }
                      setOpenLevel(nextLevel)
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ) : null

        return (
          <div className="query-target-level" key={level.id}>
            <button
              ref={(node) => {
                triggerRefs.current[levelIndex] = node
              }}
              type="button"
              className={`query-target-trigger${selectedValue ? '' : ' is-empty'}`}
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-label={`Change ${level.label}`}
              disabled={disabled}
              title={disabled ? 'Wait for the current query to finish.' : `Change ${level.label.toLowerCase()}`}
              onClick={(event) => {
                setSearch('')
                if (isOpen) {
                  closeMenu()
                  return
                }
                if (floatingMenu) {
                  setFloatingMenuStyle(
                    floatingMenuPosition(event.currentTarget),
                  )
                }
                setOpenLevel(levelIndex)
              }}
            >
              <span className="query-target-trigger-label">{level.label}</span>
              <strong>{selectedValue || 'Select'}</strong>
              <ChevronDownIcon />
            </button>

            {menu && floatingMenu && floatingMenuStyle && typeof document !== 'undefined'
              ? createPortal(menu, document.body)
              : menu}
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

function floatingMenuPosition(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth
  const viewportHeight =
    document.documentElement.clientHeight || window.innerHeight
  const margin = 8
  const gap = 4
  const width = Math.min(
    Math.max(rect.width, 320),
    Math.max(0, viewportWidth - margin * 2),
  )
  const left = Math.max(
    margin,
    Math.min(rect.right - width, viewportWidth - width - margin),
  )
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin - gap)
  const spaceAbove = Math.max(0, rect.top - margin - gap)
  const openAbove = spaceBelow < Math.min(320, spaceAbove) && spaceAbove > spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow

  return {
    position: 'fixed',
    top: openAbove ? 'auto' : rect.bottom + gap,
    right: 'auto',
    bottom: openAbove ? viewportHeight - rect.top + gap : 'auto',
    left,
    width,
    maxHeight: Math.max(96, Math.min(320, availableHeight)),
  }
}
