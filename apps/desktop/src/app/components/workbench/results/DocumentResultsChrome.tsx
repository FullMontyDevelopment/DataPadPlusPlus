import type { ReactNode } from 'react'
import { ClockIcon } from '../icons'
import { formatDurationClock } from './result-runtime'

interface DocumentResultsToolbarProps {
  efficiencyModeEnabled: boolean
  expandAllPending: boolean
  hasExpandedRows: boolean
  hasSearch: boolean
  matchCount: number
  searchInput: string
  searchPending: boolean
  onCollapseAll(): void
  onExpandAll(): void
  onSearchInputChange(value: string): void
}

interface DocumentResultsFooterProps {
  copyMessage: string
  documentCountLabel: string
  footerControls?: ReactNode
  resultDurationMs?: number
  resultRuntimeTitle?: string
}

export function DocumentResultsToolbar({
  efficiencyModeEnabled,
  expandAllPending,
  hasExpandedRows,
  hasSearch,
  matchCount,
  searchInput,
  searchPending,
  onCollapseAll,
  onExpandAll,
  onSearchInputChange,
}: DocumentResultsToolbarProps) {
  return (
    <div className="document-data-grid-toolbar">
      <label className="document-results-search">
        <input
          aria-label="Search loaded documents"
          placeholder="Search loaded documents"
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
        />
      </label>
      {searchPending ? (
        <span className="document-results-search-count">Searching...</span>
      ) : hasSearch ? (
        <span className="document-results-search-count">
          {matchCount} match(es)
        </span>
      ) : null}
      {!efficiencyModeEnabled ? (
        <button
          type="button"
          className="drawer-button"
          disabled={expandAllPending}
          onClick={onExpandAll}
        >
          {expandAllPending ? 'Expanding...' : 'Expand All'}
        </button>
      ) : null}
      <button
        type="button"
        className="drawer-button"
        disabled={!expandAllPending && !hasExpandedRows}
        onClick={onCollapseAll}
      >
        Collapse All
      </button>
    </div>
  )
}

export function DocumentResultsFooter({
  copyMessage,
  documentCountLabel,
  footerControls,
  resultDurationMs,
  resultRuntimeTitle = 'Query runtime',
}: DocumentResultsFooterProps) {
  return (
    <div className="document-data-grid-footer">
      <div className="document-data-grid-footer-left">
        {footerControls}
        {copyMessage ? <span role="status">{copyMessage}</span> : null}
      </div>
      <div className="document-data-grid-footer-right">
        <strong>{documentCountLabel}</strong>
        {resultDurationMs !== undefined ? (
          <span className="result-runtime-label" title={resultRuntimeTitle}>
            <ClockIcon className="panel-inline-icon" />
            {formatDurationClock(resultDurationMs)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
