import type { QueryBuilderState } from '@datapadplusplus/shared-types'
import { Calculator } from 'lucide-react'
import { useState } from 'react'
import { canCountQueryBuilderState } from './query-builder-count'

interface QueryBuilderCountFooterProps {
  activeExecution: boolean
  builderState: QueryBuilderState
  onCount?(tabId: string, builderState: QueryBuilderState): Promise<void>
  tabId: string
  appearance?: 'builder' | 'toolbar'
}

export function QueryBuilderCountFooter({
  activeExecution,
  builderState,
  onCount,
  tabId,
}: QueryBuilderCountFooterProps) {
  return (
    <footer className="query-builder-count-footer">
      <QueryBuilderCountButton
        activeExecution={activeExecution}
        builderState={builderState}
        onCount={onCount}
        tabId={tabId}
      />
    </footer>
  )
}

export function QueryBuilderCountButton({
  activeExecution,
  builderState,
  onCount,
  tabId,
  appearance = 'builder',
}: QueryBuilderCountFooterProps) {
  const [counting, setCounting] = useState(false)
  const disabled = counting || activeExecution || !onCount || !canCountQueryBuilderState(builderState)

  const runCount = async () => {
    if (disabled || !onCount) {
      return
    }
    setCounting(true)
    try {
      await onCount(tabId, builderState)
    } finally {
      setCounting(false)
    }
  }

  return (
    <button
      type="button"
      className={appearance === 'toolbar' ? 'toolbar-icon-action toolbar-action--count' : 'query-builder-count-button'}
      disabled={disabled}
      aria-busy={counting}
      aria-label={counting ? 'Counting...' : 'Count'}
      title="Count all records matching the current builder filters"
      onClick={() => void runCount()}
    >
      {counting ? (
        <span className="connection-metadata-spinner" aria-hidden="true" />
      ) : (
        <Calculator size={14} aria-hidden="true" />
      )}
      {appearance !== 'toolbar' && <span>{counting ? 'Counting...' : 'Count'}</span>}
    </button>
  )
}
