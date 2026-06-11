import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { ObjectSearchIcon, PlayIcon } from '../../icons'
import { PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'
import { mongoPipelineStageRows } from './MongoPipelineView.helpers'

type JsonRecord = Record<string, unknown>

export function MongoPipelineView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : []
  const stageRows = mongoPipelineStageRows(pipeline)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSearchIcon} title={descriptor.title} unit={`${pipeline.length} stage(s)`} />
      {pipeline.length ? (
        <div className="mongo-pipeline-stage-list" role="group" aria-label="MongoDB view pipeline stages">
          {stageRows.map((stage, index) => (
            <article className="mongo-pipeline-stage" key={`${stage.operator}:${index}`}>
              <div className="mongo-pipeline-stage-order">{index + 1}</div>
              <div className="mongo-pipeline-stage-body">
                <div className="mongo-pipeline-stage-title">
                  <strong>{stage.operator}</strong>
                  <span>{stage.summary}</span>
                </div>
                {stage.details.length ? (
                  <div className="mongo-pipeline-stage-tags">
                    {stage.details.map((detail) => <span key={detail}>{detail}</span>)}
                  </div>
                ) : null}
                <details className="mongo-pipeline-stage-json">
                  <summary>View stage document</summary>
                  <pre className="object-view-code">{prettyJson(stage.value)}</pre>
                </details>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Open Results Preview'}
        </button>
      ) : null}
    </div>
  )
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
