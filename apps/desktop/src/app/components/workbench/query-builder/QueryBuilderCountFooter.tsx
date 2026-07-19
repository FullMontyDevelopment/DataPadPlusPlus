import type { QueryBuilderState } from '@datapadplusplus/shared-types'
import { Calculator } from 'lucide-react'
import { useState } from 'react'
import { canCountQueryBuilderState } from './query-builder-count'

interface QueryBuilderCountFooterProps {
  activeExecution: boolean
  builderState: QueryBuilderState
  onCount?(tabId: string, builderState: QueryBuilderState): Promise<void>
  tabId: string
}

export function QueryBuilderCountFooter({
  activeExecution,
  builderState,
  onCount,
  tabId,
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
    <footer className="query-builder-count-footer">
      <button
        type="button"
        className="query-builder-count-button"
        disabled={disabled}
        aria-busy={counting}
        title="Count all records matching the current builder filters"
        onClick={() => void runCount()}
      >
        {counting ? (
          <span className="connection-metadata-spinner" aria-hidden="true" />
        ) : (
          <Calculator size={14} aria-hidden="true" />
        )}
        <span>{counting ? 'Counting...' : 'Count'}</span>
      </button>
    </footer>
  )
}
