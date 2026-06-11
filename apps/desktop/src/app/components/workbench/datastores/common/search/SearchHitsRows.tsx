import type { DocumentEditContext } from '../../../results/document-edit-context'
import { JsonTreeView } from '../../../results/JsonTreeView'
import {
  searchHitId,
  searchHitIndex,
  searchHitScore,
  searchHitSource,
  type SearchHit,
} from '../../../results/search-hit-edit-requests'
import { stringifySearchHitSource } from '../../../results/search-hit-json'

interface SearchHitsRowsProps {
  canEdit: boolean
  editContext?: DocumentEditContext
  expandedHits: Set<number>
  hits: SearchHit[]
  onBeginUpdate(hitIndex: number, source: Record<string, unknown>): void
  onOpenContextMenu(hitIndex: number, x: number, y: number): void
  onToggleExpanded(hitIndex: number): void
}

export function SearchHitsRows({
  canEdit,
  editContext,
  expandedHits,
  hits,
  onBeginUpdate,
  onOpenContextMenu,
  onToggleExpanded,
}: SearchHitsRowsProps) {
  return (
    <>
      {hits.map((hit, hitIndex) => {
        const documentId = searchHitId(hit) ?? `hit-${hitIndex + 1}`
        const index = searchHitIndex(hit, editContext) ?? '<index>'
        const score = searchHitScore(hit)
        const source = searchHitSource(hit)
        const sourceText = stringifySearchHitSource(source)
        const expanded = expandedHits.has(hitIndex)

        return (
          <div
            key={`${index}:${documentId}:${hitIndex}`}
            className="search-hit-entry"
            onContextMenu={(event) => {
              event.preventDefault()
              onOpenContextMenu(hitIndex, event.clientX, event.clientY)
            }}
          >
            <div className="search-hit-row" role="row">
              <button
                type="button"
                className="keyvalue-expand-button"
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${documentId}`}
                onClick={() => onToggleExpanded(hitIndex)}
              >
                {expanded ? 'v' : '>'}
              </button>
              <span className="search-hit-index">{index}</span>
              <button
                type="button"
                className="search-hit-id"
                title="Right-click for document actions"
                onDoubleClick={() => canEdit && onBeginUpdate(hitIndex, source)}
              >
                {documentId}
              </button>
              <span className="document-type-badge is-number">
                {score === undefined ? 'n/a' : score}
              </span>
              <button
                type="button"
                className={`search-hit-source${canEdit ? ' is-editable' : ''}`}
                title={canEdit ? 'Double-click to update source JSON' : sourceText}
                onDoubleClick={() => canEdit && onBeginUpdate(hitIndex, source)}
              >
                {sourceText}
              </button>
            </div>
            {expanded ? (
              <div className="search-hit-detail">
                <JsonTreeView value={source} label={documentId} />
              </div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
