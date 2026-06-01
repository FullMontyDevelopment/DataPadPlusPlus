import type { ReactNode } from 'react'
import type { ResultPayload } from '@datapadplusplus/shared-types'

type BatchPayload = Extract<ResultPayload, { renderer: 'batch' }>
type SinglePayload = BatchPayload['sections'][number]['payloads'][number]

interface BatchResultsViewProps {
  payload: BatchPayload
  renderPayload(payload: SinglePayload, sectionIndex: number): ReactNode
}

export function BatchResultsView({ payload, renderPayload }: BatchResultsViewProps) {
  const sections = Array.isArray(payload.sections) ? payload.sections : []

  if (sections.length === 0) {
    return <p className="panel-footnote">No batch results were returned.</p>
  }

  return (
    <div className="batch-results-view" aria-label="Batch results">
      {sections.map((section, index) => {
        const primaryPayload = primarySectionPayload(section)

        return (
          <section
            key={section.id || `${section.label}-${index}`}
            className={`batch-result-section batch-result-section--${section.status} batch-result-section--renderer-${primaryPayload?.renderer ?? 'empty'}`}
          >
            <header className="batch-result-header">
              <div>
                <strong>{section.label || `Result ${index + 1}`}</strong>
                {section.statement ? <code>{previewStatement(section.statement)}</code> : null}
              </div>
              <div className="batch-result-meta">
                <span>{section.status}</span>
                {typeof section.rowCount === 'number' ? (
                  <span>{section.rowCount} row(s)</span>
                ) : null}
                {typeof section.durationMs === 'number' ? (
                  <span>{section.durationMs} ms</span>
                ) : null}
              </div>
            </header>
            {section.notices?.length ? (
              <div className="batch-result-notices">
                {section.notices.map((notice) => (
                  <span key={`${notice.code}:${notice.message}`} className={`is-${notice.level}`}>
                    {notice.message}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="batch-result-body">
              {primaryPayload
                ? renderPayload(primaryPayload, index)
                : <p className="panel-footnote">No payload returned for this command.</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function primarySectionPayload(section: BatchPayload['sections'][number]) {
  return (
    section.payloads.find((payload) => payload.renderer === section.defaultRenderer) ??
    section.payloads[0]
  )
}

function previewStatement(statement: string) {
  const normalized = statement.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
}
