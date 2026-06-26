import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  buildWorkspaceSearchIndex,
  searchWorkspaceIndex,
  type WorkspaceSearchGroup,
  type WorkspaceSearchMatch,
  type WorkspaceSearchResultType,
} from './workspace-search-index'
import {
  CaseSensitiveIcon,
  ConsoleIcon,
  DatabaseIcon,
  HistoryIcon,
  ObjectFolderIcon,
  QueryIcon,
  SavedWorkIcon,
  SearchIcon,
  TestsIcon,
  TrashIcon,
  WholeWordIcon,
} from './icons'

const ROW_HEIGHT = 58
const GROUP_HEIGHT = 52
const ROW_OVERSCAN = 14
const MAX_DISPLAYED_MATCHES = 500
const RECENT_SEARCH_STORAGE_KEY = 'datapadplusplus.workspaceSearch.recentSearches.v1'
const RECENT_SEARCH_LIMIT = 8
const MIN_RECENT_SEARCH_LENGTH = 2
const RECENT_SEARCH_DEBOUNCE_MS = 900
const RESULT_TYPE_FILTERS: Array<{
  type: WorkspaceSearchResultType
  label: string
  Icon: typeof SearchIcon
}> = [
  { type: 'connection', label: 'Connections', Icon: DatabaseIcon },
  { type: 'folder', label: 'Folders', Icon: ObjectFolderIcon },
  { type: 'query', label: 'Queries', Icon: QueryIcon },
  { type: 'script', label: 'Scripts', Icon: ConsoleIcon },
  { type: 'test-suite', label: 'Tests', Icon: TestsIcon },
  { type: 'library-item', label: 'Library', Icon: SavedWorkIcon },
  { type: 'open-tab', label: 'Open tabs', Icon: ConsoleIcon },
  { type: 'closed-tab', label: 'Closed', Icon: HistoryIcon },
]
const DEFAULT_RESULT_TYPE_FILTERS = Object.fromEntries(
  RESULT_TYPE_FILTERS.map((filter) => [filter.type, true]),
) as Record<WorkspaceSearchResultType, boolean>

type WorkspaceSearchRow =
  | { kind: 'group'; id: string; group: WorkspaceSearchGroup }
  | { kind: 'match'; id: string; match: WorkspaceSearchMatch }

export function WorkspaceSearchWorkspace({
  snapshot,
  enabled,
  onOpenExperimentalSettings,
  onOpenConnection,
  onOpenLibraryItem,
  onSelectTab,
  onReopenClosedTab,
}: {
  snapshot: WorkspaceSnapshot
  enabled: boolean
  onOpenExperimentalSettings(): void
  onOpenConnection(connectionId: string): void
  onOpenLibraryItem(nodeId: string): void
  onSelectTab(tabId: string): void
  onReopenClosedTab(closedTabId: string): void
}) {
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [includedTypes, setIncludedTypes] = useState(DEFAULT_RESULT_TYPE_FILTERS)
  const [recentSearches, setRecentSearches] = useState(readRecentSearches)
  const deferredQuery = useDeferredValue(query)
  const parentRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => buildWorkspaceSearchIndex(snapshot), [snapshot])
  const activeTypes = useMemo(
    () =>
      RESULT_TYPE_FILTERS
        .filter((filter) => includedTypes[filter.type])
        .map((filter) => filter.type),
    [includedTypes],
  )
  const typeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      RESULT_TYPE_FILTERS.map((filter) => [filter.type, 0]),
    ) as Record<WorkspaceSearchResultType, number>
    for (const document of index.documents) {
      counts[document.resultType] += 1
    }
    return counts
  }, [index.documents])
  const result = useMemo(
    () =>
      searchWorkspaceIndex(index, deferredQuery, {
        matchCase,
        wholeWord,
        includedTypes: activeTypes,
        maxMatches: MAX_DISPLAYED_MATCHES,
      }),
    [activeTypes, deferredQuery, index, matchCase, wholeWord],
  )
  const rows = useMemo(() => flattenGroups(result.groups), [result.groups])
  const commitRecentSearch = useCallback((value: string) => {
    setRecentSearches((current) => addRecentSearch(current, value))
  }, [])

  useEffect(() => {
    writeRecentSearches(recentSearches)
  }, [recentSearches])

  useEffect(() => {
    const normalized = normalizeRecentSearch(query)
    if (normalized.length < MIN_RECENT_SEARCH_LENGTH) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      commitRecentSearch(normalized)
    }, RECENT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [commitRecentSearch, query])

  // Keeps large workspaces responsive while preserving grouped, VS Code-style rows.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? GROUP_HEIGHT : ROW_HEIGHT),
    overscan: ROW_OVERSCAN,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const renderedRows =
    virtualItems.length > 0
      ? virtualItems.map((item) => ({
          key: item.key,
          index: item.index,
          start: item.start,
        }))
      : rows.map((_row, index) => ({
          key: index,
          index,
          start: index * ROW_HEIGHT,
        }))

  const openMatch = (match: WorkspaceSearchMatch) => {
    commitRecentSearch(query)

    switch (match.sourceKind) {
      case 'connection':
        onOpenConnection(match.sourceId)
        break
      case 'library':
        onOpenLibraryItem(match.sourceId)
        break
      case 'tab':
        onSelectTab(match.sourceId)
        break
      case 'closed-tab':
        onReopenClosedTab(match.sourceId)
        break
    }
  }

  if (!enabled) {
    return (
      <section className="environment-workspace workspace-search-workspace" aria-label="Workspace Search">
        <div className="editor-empty-state workspace-search-disabled">
          <SearchIcon />
          <h2>Workspace Search is experimental</h2>
          <p>Enable it in Experimental settings to search saved connections, Library work, open tabs, and recently closed tabs.</p>
          <button type="button" className="drawer-button drawer-button--primary" onClick={onOpenExperimentalSettings}>
            Open Experimental Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="environment-workspace workspace-search-workspace" aria-label="Workspace Search">
      <header className="environment-header workspace-search-header">
        <div>
          <span className="sidebar-eyebrow">Experimental</span>
          <h2>Search</h2>
          <p>
            {index.documents.length} indexed items across connections, Library files, open tabs, and recently closed tabs.
          </p>
        </div>
      </header>

      <div className="workspace-search-toolbar" role="search">
        <div className="workspace-search-input-shell">
          <SearchIcon />
          <input
            aria-label="Search workspace"
            autoFocus
            className="workspace-search-input"
            placeholder="Search workspace"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitRecentSearch(query)
              }
            }}
          />
        </div>
        <div className="workspace-search-options" role="group" aria-label="Search options">
          <button
            type="button"
            className={`workspace-search-option${matchCase ? ' is-active' : ''}`}
            aria-label="Match case"
            aria-pressed={matchCase}
            title="Match case"
            onClick={() => setMatchCase((value) => !value)}
          >
            <CaseSensitiveIcon />
          </button>
          <button
            type="button"
            className={`workspace-search-option${wholeWord ? ' is-active' : ''}`}
            aria-label="Match whole word"
            aria-pressed={wholeWord}
            title="Match whole word"
            onClick={() => setWholeWord((value) => !value)}
          >
            <WholeWordIcon />
          </button>
        </div>
      </div>

      <div className="workspace-search-filters" role="group" aria-label="Result type filters">
        {RESULT_TYPE_FILTERS.map((filter) => (
          <button
            key={filter.type}
            type="button"
            className={`workspace-search-filter workspace-search-type--${filter.type}${
              includedTypes[filter.type] ? ' is-active' : ''
            }`}
            aria-label={`Include ${filter.label}`}
            aria-pressed={includedTypes[filter.type]}
            title={`${includedTypes[filter.type] ? 'Exclude' : 'Include'} ${filter.label}`}
            onClick={() =>
              setIncludedTypes((current) => ({
                ...current,
                [filter.type]: !current[filter.type],
              }))
            }
          >
            <filter.Icon />
            <span>{filter.label}</span>
            <small>{typeCounts[filter.type]}</small>
          </button>
        ))}
      </div>

      <div className="workspace-search-summary" aria-live="polite">
        {activeTypes.length === 0
          ? 'Select at least one result type to search.'
          : deferredQuery.trim()
          ? `${result.totalMatches} ${result.totalMatches === 1 ? 'match' : 'matches'} in ${result.groups.length} ${result.groups.length === 1 ? 'item' : 'items'}`
          : 'Type to search the current workspace snapshot.'}
        {result.truncated ? ` Showing first ${result.displayedMatches}.` : ''}
      </div>

      {!deferredQuery.trim() && recentSearches.length > 0 ? (
        <RecentSearches
          searches={recentSearches}
          onClear={() => setRecentSearches([])}
          onSelect={(search) => setQuery(search)}
        />
      ) : deferredQuery.trim() && rows.length === 0 ? (
        <div className="workspace-search-empty" role="status">
          No results
        </div>
      ) : (
        <div ref={parentRef} className="workspace-search-results" role="list" aria-label="Workspace search results">
          <div className="workspace-search-virtual-space" style={{ height: virtualizer.getTotalSize() }}>
            {renderedRows.map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) {
                return null
              }

              return (
                <div
                  key={virtualRow.key}
                  className={`workspace-search-virtual-row workspace-search-virtual-row--${row.kind}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.kind === 'group' ? (
                    <SearchGroupRow group={row.group} onOpenMatch={openMatch} />
                  ) : (
                    <SearchMatchRow match={row.match} onOpen={openMatch} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function RecentSearches({
  searches,
  onClear,
  onSelect,
}: {
  searches: string[]
  onClear(): void
  onSelect(search: string): void
}) {
  return (
    <section className="workspace-search-recents" aria-label="Recent workspace searches">
      <header className="workspace-search-recents-header">
        <span className="workspace-search-recents-title">
          <HistoryIcon />
          <span>Recent searches</span>
        </span>
        <button
          type="button"
          className="workspace-search-recents-clear"
          aria-label="Clear recent workspace searches"
          title="Clear recent workspace searches"
          onClick={onClear}
        >
          <TrashIcon />
        </button>
      </header>
      <div className="workspace-search-recents-list">
        {searches.map((search) => (
          <button
            key={search}
            type="button"
            className="workspace-search-recent"
            aria-label={`Search workspace for ${search}`}
            onClick={() => onSelect(search)}
          >
            <SearchIcon />
            <span>{search}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function SearchGroupRow({
  group,
  onOpenMatch,
}: {
  group: WorkspaceSearchGroup
  onOpenMatch(match: WorkspaceSearchMatch): void
}) {
  const firstMatch = group.matches[0]
  const { Icon, label } = resultTypeConfig(group.document.resultType)

  return (
    <button
      type="button"
      className={`workspace-search-group workspace-search-type--${group.document.resultType}`}
      aria-label={`Open ${group.document.title}`}
      onClick={() => firstMatch && onOpenMatch(firstMatch)}
    >
      <span className="workspace-search-type-icon">
        <Icon />
      </span>
      <span className="workspace-search-group-main">
        <span className="workspace-search-group-title">
          <strong>{group.document.title}</strong>
          <span>{label}</span>
        </span>
        <small>
          {group.document.subtitle}
          {group.document.detail ? ` - ${group.document.detail}` : ''}
        </small>
      </span>
      <span className="workspace-search-count">
        {group.matches.length}
      </span>
    </button>
  )
}

function SearchMatchRow({
  match,
  onOpen,
}: {
  match: WorkspaceSearchMatch
  onOpen(match: WorkspaceSearchMatch): void
}) {
  return (
    <button
      type="button"
      className={`workspace-search-match workspace-search-type--${match.resultType}`}
      aria-label={`Open match in ${match.title}, ${match.fieldLabel} line ${match.lineNumber}`}
      onClick={() => onOpen(match)}
    >
      <span className="workspace-search-match-meta">
        <span>{match.fieldLabel}</span>
        <small>Line {match.lineNumber}</small>
      </span>
      <span className="workspace-search-line">
        {match.lineText.slice(0, match.matchStart)}
        <mark>{match.lineText.slice(match.matchStart, match.matchEnd)}</mark>
        {match.lineText.slice(match.matchEnd)}
      </span>
    </button>
  )
}

function flattenGroups(groups: WorkspaceSearchGroup[]): WorkspaceSearchRow[] {
  return groups.flatMap((group) => [
    {
      kind: 'group' as const,
      id: group.document.id,
      group,
    },
    ...group.matches.map((match) => ({
      kind: 'match' as const,
      id: match.id,
      match,
    })),
  ])
}

function resultTypeConfig(type: WorkspaceSearchResultType) {
  return RESULT_TYPE_FILTERS.find((filter) => filter.type === type) ?? RESULT_TYPE_FILTERS[5]!
}

function normalizeRecentSearch(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

function addRecentSearch(current: string[], value: string) {
  const normalized = normalizeRecentSearch(value)
  if (normalized.length < MIN_RECENT_SEARCH_LENGTH) {
    return current
  }

  const next = [
    normalized,
    ...current.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase()),
  ]

  return next.slice(0, RECENT_SEARCH_LIMIT)
}

function readRecentSearches() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isRecentSearchStorage(parsed)) {
      return []
    }

    return parsed.searches
      .map(normalizeRecentSearch)
      .filter((search) => search.length >= MIN_RECENT_SEARCH_LENGTH)
      .slice(0, RECENT_SEARCH_LIMIT)
  } catch {
    return []
  }
}

function writeRecentSearches(searches: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (searches.length === 0) {
      window.localStorage.removeItem(RECENT_SEARCH_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      RECENT_SEARCH_STORAGE_KEY,
      JSON.stringify({ version: 1, searches }),
    )
  } catch {
    // Search should keep working when local storage is unavailable.
  }
}

function isRecentSearchStorage(value: unknown): value is { version: 1; searches: string[] } {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as { version?: unknown; searches?: unknown }
  return record.version === 1 && Array.isArray(record.searches) && record.searches.every((item) => typeof item === 'string')
}
